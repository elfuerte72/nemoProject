import { z } from 'zod';
import { InvalidInputError } from '@nemo/core';
import { errorResponse, json } from '@/lib/api';
import { requireStaffActor } from '@/lib/auth/require-session';
import { getCore } from '@/lib/core';
import { deliverMail } from '@/lib/mail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Решения администратора о мерчанте (docs/adr/0017).
 *
 * Один маршрут на все четыре действия — по тому же правилу, что и у
 * заявки: какие переходы существуют и кому они разрешены, решает
 * операция, и разносить это решение ещё и по адресам значило бы
 * описывать его дважды. Менеджер получает здесь отказ ядра, а не
 * скрытую кнопку: скрытая кнопка — видимость разграничения.
 *
 * Письмо о решении уходит здесь же: одобрение открывает кабинет, отказ
 * называет причину, и узнать об этом мерчант должен не заходом «а вдруг
 * рассмотрели». Отключение письма не порождает — о нём говорит
 * владелец, а ключи API перестают работать сразу.
 */

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve') }),
  z.object({ action: z.literal('reject'), reason: z.string() }),
  z.object({ action: z.literal('disable') }),
  z.object({ action: z.literal('enable') }),
]);

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const actor = await requireStaffActor();
    const { id } = await context.params;

    const parsed = actionSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new InvalidInputError('Действие не распознано');
    }
    const input = parsed.data;
    const core = getCore();

    const decided = await (async () => {
      switch (input.action) {
        case 'approve':
          return core.approveMerchant(actor, id);
        case 'reject':
          return core.rejectMerchant(actor, id, { reason: input.reason });
        case 'disable':
          return { merchant: await core.setMerchantActive(actor, id, false), notifications: [] };
        case 'enable':
          return { merchant: await core.setMerchantActive(actor, id, true), notifications: [] };
      }
    })();

    await deliverMail(decided.notifications);
    return json({ merchant: decided.merchant });
  } catch (error) {
    return errorResponse(error);
  }
}
