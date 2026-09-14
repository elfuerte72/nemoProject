import { cookies } from 'next/headers';
import { z } from 'zod';
import { InvalidInputError } from '@nemo/core';
import { Money } from '@nemo/types';
import { TZ_COOKIE, readTzOffset } from '@nemo/ui/period';
import { errorResponse, json } from '@/lib/api';
import { requireActor } from '@/lib/auth';
import { getCore } from '@/lib/core';
import { addInvoice, listInvoices } from '@/lib/mock/store';
import { makeInvoice, nextNumber, posSides } from '@/lib/pos';
import { requireActiveMerchant } from '@/lib/mock/guard';
import { viewer } from '@/lib/reads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Счёт из POS-терминала — запись макета в памяти процесса, а не строка в базе
 * (`backlog.md`, решение от 10 сентября 2026). Денег за ним нет: ни
 * покупателю, ни сервису ничего не уходит.
 *
 * Суммы всё равно считаются здесь, а не принимаются со слов экрана:
 * цена — это обещание, и подставить её запросом снаружи не должно
 * получаться даже у макета. Экран присылает направление и одну
 * сторону, курс спрашивается тут же, у того же источника, что и форма
 * заявки.
 */
const bodySchema = z.object({
  from: z.string().trim().min(1).max(16),
  to: z.string().trim().min(1).max(16),
  side: z.enum(['buy', 'pay']),
  amount: z.string().trim().min(1).max(40),
  purpose: z.string().trim().max(200).default(''),
  buyer: z.string().trim().max(200).default(''),
  /**
   * Отметка времени курса, который экран показал покупателю. По нему
   * счёт и считается: снимок котировки обновляется раз в минуту, и
   * спрошенный заново курс успевал бы уйти между словами «пять тысяч
   * рублей» и нажатием. Тем же способом закрепляется цена заявки.
   */
  quotedAt: z.coerce.date().optional(),
});

export async function POST(request: Request): Promise<Response> {
  try {
    const actor = await requireActor();
    const { session } = await viewer();
    requireActiveMerchant(session.status);
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new InvalidInputError('Счёт заполнен не полностью');
    }
    const body = parsed.data;

    const value = Money.amountSchema.safeParse(body.amount.replace(/\s/g, '').replace(',', '.'));
    if (!value.success || Money.isZero(value.data) || Money.isNegative(value.data)) {
      throw new InvalidInputError('Сумма должна быть больше нуля');
    }

    const quote = await getCore().getQuote({
      fromCode: body.from,
      toCode: body.to,
      fromAmount: '1',
      ...(body.quotedAt === undefined ? {} : { asOf: body.quotedAt }),
    });
    if (!quote) {
      throw new InvalidInputError('Курса сейчас нет: счёт по нему создать не получится');
    }

    /*
     * Обе стороны — тем же `posSides`, каким их считает экран: у
     * направления со ступенчатой сеткой цена выводится из тиров, а
     * `quote.rate` в котировке пуст, и умножение на него дало бы счёт
     * на ноль. Двух правд о цене быть не должно ни между экраном и
     * сервером, ни между сервером и ядром.
     */
    const { buy, pay } = posSides(value.data, body.side, quote);
    if (buy === null || pay === null) {
      throw new InvalidInputError(
        'На эту сумму счёт не создать: после комиссии покупателю ничего не остаётся',
      );
    }

    // День номера — местный, тот же, по которому считается смена.
    const offset = readTzOffset((await cookies()).get(TZ_COOKIE)?.value);
    const at = new Date();
    const invoice = makeInvoice({
      number: nextNumber(listInvoices(actor.merchantId), at, offset),
      purpose: body.purpose,
      buyer: body.buyer,
      author: session.name,
      code: body.to,
      amount: buy,
      payCode: body.from,
      payAmount: pay,
      /*
       * Курс счёта — тот, по которому он и посчитан: выдача, делённая
       * на оплату. У направления со ступенчатой сеткой другого курса
       * не существует — он выводится из посчитанной выдачи, — и
       * записать `quote.rate` значило бы положить в счёт ноль.
       */
      rate: Money.divide(buy, pay),
      at,
    });
    addInvoice(actor.merchantId, invoice);

    return json({ invoice }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
