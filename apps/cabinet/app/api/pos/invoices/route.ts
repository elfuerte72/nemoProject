import { cookies } from 'next/headers';
import { z } from 'zod';
import { InvalidInputError } from '@nemo/core';
import { Money } from '@nemo/types';
import { TZ_COOKIE, readTzOffset } from '@nemo/ui/period';
import { errorResponse, json } from '@/lib/api';
import { requireActor } from '@/lib/auth';
import { getCore } from '@/lib/core';
import { addInvoice, getPosSettings, listInvoices, replaceInvoice } from '@/lib/mock/store';
import { makeInvoice, nextNumber, payRounding, posSides } from '@/lib/pos';
import { acquirer } from '@/lib/pos/acquirer';
import { publishPos } from '@/lib/pos/bus';
import { requireTill } from '@/lib/mock/guard';
import { viewer } from '@/lib/reads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Счёт из POS-терминала — запись макета в памяти процесса, а не строка в базе
 * (`backlog.md`, решение от 10 сентября 2026). Денег за ним нет: платёж
 * принимает имитация провайдера (`lib/pos/acquirer.ts`), и оплатить его
 * может только кнопка на экране мерчанта.
 *
 * Суммы всё равно считаются здесь, а не принимаются со слов экрана:
 * цена — это обещание, и подставить её запросом снаружи не должно
 * получаться даже у макета. Экран присылает направление и одну
 * сторону, курс спрашивается тут же, у того же источника, что и форма
 * заявки; наценка мерчанта берётся из его настроек, а не из запроса.
 *
 * Срок счёта — тот же, что у неоплаченной заявки на обмен: одно
 * число сервиса на оба ожидания денег, и задаёт его администратор.
 */
const bodySchema = z.object({
  from: z.string().trim().min(1).max(16),
  to: z.string().trim().min(1).max(16),
  side: z.enum(['buy', 'pay']),
  amount: z.string().trim().min(1).max(40),
  /** Покупатель подтвердит личность у провайдера до оплаты. */
  kycRequired: z.boolean().default(false),
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
    requireTill(session);
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new InvalidInputError('Счёт заполнен не полностью');
    }
    const body = parsed.data;

    const value = Money.amountSchema.safeParse(body.amount.replace(/\s/g, '').replace(',', '.'));
    if (!value.success || Money.isZero(value.data) || Money.isNegative(value.data)) {
      throw new InvalidInputError('Сумма должна быть больше нуля');
    }

    const settings = getPosSettings(actor.merchantId);
    const core = getCore();
    const [quote, terms] = await Promise.all([
      core.getQuote({
        fromCode: body.from,
        toCode: body.to,
        fromAmount: '1',
        ...(body.quotedAt === undefined ? {} : { asOf: body.quotedAt }),
      }),
      core.getExchangeTerms(),
    ]);
    if (!quote) {
      throw new InvalidInputError('Курса сейчас нет: счёт по нему создать не получится');
    }

    /*
     * Обе стороны — тем же `posSides`, каким их считает экран, с той же
     * наценкой: у направления со ступенчатой сеткой цена выводится из
     * тиров, а `quote.rate` в котировке пуст, и умножение на него дало
     * бы счёт на ноль. Двух правд о цене быть не должно ни между экраном
     * и сервером, ни между сервером и ядром.
     */
    /*
     * Знак, до которого ровняется сумма к оплате, — тот же, каким её
     * посчитал экран: у рубля целая единица, у монеты её знак. Берётся
     * он из справочника валют, а не из котировки: котировка знает знак
     * только той валюты, которую выдают.
     */
    const payCurrency = terms.currencies.find((one) => one.code === body.from);
    const payDecimals = payCurrency ? payRounding(payCurrency) : 0;
    const { buy, pay } = posSides(
      value.data,
      body.side,
      quote,
      settings.markupBps,
      payDecimals,
    );
    if (buy === null || pay === null) {
      throw new InvalidInputError(
        'На эту сумму счёт не создать: после комиссии покупателю ничего не остаётся',
      );
    }

    // День номера — местный, тот же, по которому считается смена.
    const offset = readTzOffset((await cookies()).get(TZ_COOKIE)?.value);
    const at = new Date();
    const expiresAt = new Date(at.getTime() + terms.unpaidTtlMinutes * 60_000);
    const invoice = makeInvoice({
      number: nextNumber(listInvoices(actor.merchantId, at), at, offset),
      // Кто нажал, а не чей кабинет: людей у мерчанта несколько (тикет 17).
      author: session.userName,
      authorId: actor.userId,
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
      markupBps: settings.markupBps,
      kycRequired: body.kycRequired,
      at,
      expiresAt,
    });
    addInvoice(actor.merchantId, invoice);

    /*
     * Провайдеру платёж заявляется после записи счёта: у него появляется
     * ссылка, по которой потом просят QR, отмену и возврат. Отказ
     * провайдера — отказ и мерчанту: счёт без платежа никому не нужен.
     */
    const provider = acquirer();
    const issued = await provider.issue({
      merchantId: actor.merchantId,
      invoiceId: invoice.id,
      number: invoice.number,
      amount: pay,
      code: body.from,
      kycRequired: body.kycRequired,
      at,
      expiresAt,
    });
    const withPayment = {
      ...invoice,
      payment: { provider: provider.name, ref: issued.ref },
      events: [
        ...invoice.events,
        { at: at.toISOString(), what: `Платёж заявлен провайдеру «${provider.title}»` },
      ],
    };
    replaceInvoice(actor.merchantId, withPayment);
    publishPos(actor.merchantId, { kind: 'invoice', id: invoice.id });

    return json(
      { invoice: withPayment, qr: await provider.qr(issued.ref, at), now: at.toISOString() },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
