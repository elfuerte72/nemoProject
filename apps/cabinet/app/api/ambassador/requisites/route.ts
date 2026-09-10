import { InvalidInputError } from '@nemo/core';
import { requisiteInputSchema } from '@nemo/types';
import { errorResponse, json } from '@/lib/api';
import { requireAmbassador } from '@/lib/ambassador';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Реквизиты амбассадора — те же записи клиента, что заводит Mini App.
 *
 * Номер карты и адрес кошелька уходят сюда открытыми и в ответах не
 * появляются никогда: наружу возвращаются последние цифры и края
 * адреса. Логировать тело этого запроса нельзя. Шифрует их кабинет —
 * так же, как получателей мерчанта.
 *
 * Схема общая с Mini App и API (`requisiteInputSchema`): путь через
 * кабинет не должен быть ни слабее, ни другим.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const { actor } = await requireAmbassador();
    const parsed = requisiteInputSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new InvalidInputError('Реквизиты заполнены не полностью');
    }
    const saved = await getCore().saveRequisites(actor, parsed.data);
    return json({ requisites: { id: saved.id } }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
