import { z } from 'zod';
import { InvalidInputError } from '@nemo/core';
import { errorResponse, json } from '@/lib/api';
import { requireStaffActor } from '@/lib/auth/require-session';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Флажок направления обмена.
 *
 * Состав справочника здесь не меняется: заводит направления скрипт
 * развёртывания — под каждым из них стоит канал выплаты, который сам
 * собой не появится. Отсюда администратор гасит то, на котором цена
 * разошлась с рынком: курс безналичной заявки сервис фиксирует при
 * подаче, и закрывать такое направление надо за секунды.
 *
 * Право администратора проверяет операция, а не маршрут: правило,
 * повторённое здесь, когда-нибудь разошлось бы с ядром.
 */
const schema = z.object({
  directionId: z.string().uuid(),
  isActive: z.boolean(),
});

export async function POST(request: Request): Promise<Response> {
  try {
    const actor = await requireStaffActor();
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      throw new InvalidInputError('Направление не распознано');
    }

    const direction = await getCore().setDirectionActive(
      actor,
      parsed.data.directionId,
      parsed.data.isActive,
    );
    return json({ direction });
  } catch (error) {
    return errorResponse(error);
  }
}
