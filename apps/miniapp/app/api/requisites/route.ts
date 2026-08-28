import { z } from 'zod';
import { InvalidInputError } from '@nemo/core';
import { MAX_HOLDER_NAME, networkCodeSchema } from '@nemo/types';
import { errorResponse, json, requireInitData } from '@/lib/api';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Реквизиты клиента.
 *
 * Номер карты, адрес кошелька, номер счёта и содержимое QR уходят сюда
 * открытыми и дальше в ответах не появляются никогда: наружу
 * возвращаются последние четыре цифры, края адреса и хвост QR. Логировать тело этого запроса нельзя — здесь единственное
 * место во всём клиентском приложении, где реквизит вообще виден.
 *
 * Схема разобрана по способу получения, а не собрана из необязательных
 * полей: сеть у карты должна отвергаться уже разбором запроса, а не
 * доходить до ограничения базы.
 */
const saveSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('phone'),
    bankName: z.string().min(1).max(100),
    phone: z.string().min(1).max(32),
  }),
  z.object({
    kind: z.literal('card'),
    bankName: z.string().min(1).max(100),
    cardNumber: z.string().min(1).max(40),
  }),
  z.object({
    kind: z.literal('wallet'),
    network: networkCodeSchema,
    address: z.string().min(1).max(120),
  }),
  z.object({
    kind: z.literal('account'),
    bankName: z.string().min(1).max(100),
    accountNumber: z.string().min(1).max(40),
    holderName: z.string().min(1).max(MAX_HOLDER_NAME),
  }),
  // QR приходит строкой: картинку клиент читает у себя на телефоне, и
  // сюда она не попадает никогда (docs/adr/0012).
  z.object({
    kind: z.literal('promptpay'),
    qr: z.string().min(1).max(1000),
    holderName: z.string().min(1).max(MAX_HOLDER_NAME),
  }),
  z.object({
    kind: z.literal('alipay'),
    account: z.string().min(1).max(120),
    holderName: z.string().min(1).max(MAX_HOLDER_NAME),
  }),
  z.object({
    kind: z.literal('alipay_qr'),
    qr: z.string().min(1).max(1000),
    holderName: z.string().min(1).max(MAX_HOLDER_NAME),
  }),
]);

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
