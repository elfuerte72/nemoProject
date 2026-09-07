import { InvalidInputError } from '@nemo/core';
import { requisiteInputSchema } from '@nemo/types';
import { errorResponse, json, requireInitData } from '@/lib/api';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Реквизиты клиента.
 *
 * Номер карты, адрес кошелька, номер счёта и содержимое QR уходят сюда
 * открытыми и дальше в ответах не появляются никогда: наружу
 * возвращаются последние четыре цифры, края адреса и хвост QR.
 * Логировать тело этого запроса нельзя — здесь единственное место во
 * всём клиентском приложении, где реквизит вообще виден.
 *
 * Схема — общая с API мерчанта (`requisiteInputSchema` в `@nemo/types`):
 * путь через API не должен быть ни слабее, ни другим.
 */
const saveSchema = requisiteInputSchema;

export async function GET(request: Request): Promise<Response> {
  try {
    const initData = requireInitData(request);
    const requisites = await getCore().listRequisites({
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
      throw new InvalidInputError('Реквизиты заполнены не полностью');
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
