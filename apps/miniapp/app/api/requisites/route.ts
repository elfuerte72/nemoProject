import { z } from 'zod';
import { InvalidInputError } from '@nemo/core';
import { errorResponse, json, requireInitData } from '@/lib/api';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Реквизиты клиента.
 *
 * Номер карты уходит сюда открытым и дальше в ответах не появляется
 * никогда: наружу возвращаются только последние четыре цифры. Логировать
 * тело этого запроса нельзя — здесь единственное место во всём
 * клиентском приложении, где номер вообще виден.
 */

const saveSchema = z.object({
  bankName: z.string().max(100).optional(),
  phone: z.string().max(32).optional(),
  cardNumber: z.string().max(40).optional(),
});

export async function GET(request: Request): Promise<Response> {
  try {
    const initData = requireInitData(request);
    const requisites = await getCore().getRequisites({
      type: 'client',
      telegramUserId: initData.telegramUserId,
    });
    return json({ requisites });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const initData = requireInitData(request);
    const parsed = saveSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new InvalidInputError('Реквизиты заполнены неверно');
    }

    const requisites = await getCore().saveRequisites(
      { type: 'client', telegramUserId: initData.telegramUserId },
      parsed.data,
    );
    return json({ requisites }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
