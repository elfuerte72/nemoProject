import { z } from 'zod';
import { InvalidInputError } from '@nemo/core';
import { botToken, deliverBroadcast } from '@nemo/telegram';
import { errorResponse, json } from '@/lib/api';
import { requireStaffActor } from '@/lib/auth/require-session';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Ручная рассылка.
 *
 * Список получателей отдаёт операция, отправку с оглядкой на
 * ограничение Telegram по частоте выполняет `@nemo/telegram`, результат
 * возвращается в ядро. Отказ по одному получателю не прерывает
 * остальных: заблокировавший бота — обычное дело, а не повод оборвать
 * рассылку на нём.
 *
 * Запрос несёт ключ повтора черновика. Отправка идёт минутами, и этот
 * запрос рвётся по таймауту раньше, чем она закончится; повтор с тем же
 * ключом операция узнаёт и отдаёт первую рассылку с пустым списком —
 * второй раз никому ничего не уходит.
 */
const broadcastSchema = z.object({
  body: z.string().min(1).max(4000),
  idempotencyKey: z.string().default(''),
});

export async function POST(request: Request): Promise<Response> {
  try {
    const actor = await requireStaffActor();
    const parsed = broadcastSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new InvalidInputError('Рассылка без текста никому ничего не сообщит');
    }

    // Токен — до того, как рассылка заведена: без него она осталась бы
    // строкой с ключом, не ушедшей никому, и повтор после исправления
    // настройки назвал бы её уже отправленной.
    const token = botToken();
    const core = getCore();
    const { broadcast, recipients, repeated } = await core.startBroadcast(actor, parsed.data);
    if (repeated) {
      return json({ broadcast, repeated: true });
    }

    // Счётчики сохраняются по ходу отправки: на большом списке она идёт
    // минутами, и этот запрос может оборваться по таймауту раньше, чем
    // она закончится. Тогда рассылка останется незавершённой, но видно
    // будет, сколько успело уйти, — а не нули без объяснений.
    const result = await deliverBroadcast(recipients, broadcast.body, {
      botToken: token,
      onProgress: async (progress) => {
        await core.recordBroadcastProgress(actor, broadcast.id, progress);
      },
    });

    return json({
      broadcast: await core.finishBroadcast(actor, broadcast.id, result),
      repeated: false,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
