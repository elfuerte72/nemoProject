import { InvalidInputError } from '@nemo/core';
import { requisiteInputSchema } from '@nemo/types';
import { errorResponse, json } from '@/lib/api';
import { requireActor } from '@/lib/auth';
import { getCore } from '@/lib/core';
import { toRecipientRow } from '@/lib/recipient-rows';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Получатели мерчанта из кабинета — те же записи, что по API.
 *
 * Номер карты, адрес кошелька, номер счёта и содержимое QR уходят сюда
 * открытыми и дальше в ответах не появляются никогда: наружу
 * возвращаются последние четыре цифры, края адреса и хвост QR.
 * Логировать тело этого запроса нельзя.
 *
 * Схема — общая с Mini App и API (`requisiteInputSchema`): путь из
 * кабинета не должен быть ни слабее, ни другим. Правдоподобие
 * проверяет ядро и отвечает словами из `REQUISITE_COMPLAINTS` — теми
 * же, что форма говорит до сохранения.
 */
export async function GET(): Promise<Response> {
  try {
    const actor = await requireActor();
    const rows = await getCore().listRequisites(actor);
    return json({ requisites: rows.map(toRecipientRow) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const actor = await requireActor();
    const parsed = requisiteInputSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new InvalidInputError('Реквизиты заполнены не полностью');
    }
    const saved = await getCore().saveRequisites(actor, parsed.data);
    return json({ requisites: toRecipientRow(saved) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
