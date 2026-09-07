import {
  InvalidInputError,
  UnavailableError,
  type Actor,
  type Core,
  type QuoteView,
} from '@nemo/core';
import {
  Money,
  parsePromptPay,
  payoutAfterFee,
  payoutMethodOf,
  usdForPayout,
  type Amount,
  type PayoutMethod,
  type RequisiteInput,
} from '@nemo/types';
import type { QuoteSide } from './schemas';

/**
 * Котировка для API: обе стороны сделки, курс и отметка времени.
 *
 * Вопросов у мерчанта два, как у клиента: «сколько дадут за мои сто
 * USDT» и «сколько USDT нужно, чтобы вышло ровно пятьдесят тысяч».
 * Второй считается так же, как на экране Mini App: делением вверх до
 * восьми знаков — отброшенный вниз хвост возвращался бы умножением как
 * недостача, — а со ступенчатой сеткой перебором ступеней той же
 * `usdForPayout`, что и ядро. Найденная сумма отдачи котируется
 * заново на ту же отметку: в ответе стоит то число, которое ядро
 * запишет в заявку, а не обратное умножение.
 */

/** До скольких знаков делится обратный счёт — как на экране Mini App. */
const REVERSE_DIGITS = 8;

export interface ApiQuote {
  readonly from: { readonly currency: string; readonly amount: string };
  readonly to: { readonly currency: string; readonly amount: string };
  readonly rate: string;
  /** Отметка курса: подача с ней в пять минут идёт по этому курсу. */
  readonly quotedAt: string;
  readonly payoutDecimals: number;
}

/** Что котируется: направление, сумма и сторона, способ выдачи, отметка. */
export interface QuoteRequest {
  readonly from: string;
  readonly to: string;
  readonly amount: string;
  readonly side: QuoteSide;
  /** Куда уйдут деньги: у бата и юаня от этого зависит ставка. */
  readonly payoutMethod?: PayoutMethod | undefined;
  /**
   * Отметка курса, который мерчант уже видел. Обратный счёт обязан
   * идти по тому же снимку, по которому уйдёт заявка, — иначе
   * «ровно 50 000» посчитается по одному курсу, а запишется по другому.
   */
  readonly asOf?: Date | undefined;
}

export async function quoteFor(core: Core, request: QuoteRequest): Promise<ApiQuote> {
  const terms = await core.getExchangeTerms();
  const open = terms.pairs.some(
    (pair) =>
      pair.kind === 'electronic' && pair.fromCode === request.from && pair.toCode === request.to,
  );
  if (!open) {
    throw new InvalidInputError(
      `Направление ${request.from} → ${request.to} не открыто: список — в GET /api/v1/rates`,
    );
  }

  const common = {
    fromCode: request.from,
    toCode: request.to,
    ...(request.payoutMethod === undefined ? {} : { payoutMethod: request.payoutMethod }),
    ...(request.asOf === undefined ? {} : { asOf: request.asOf }),
  };

  if (request.side === 'from') {
    const quote = await core.getQuote({ ...common, fromAmount: request.amount });
    if (!quote || quote.toAmount === null) throw unavailable();
    return toApiQuote(request, request.amount, quote);
  }

  // Обратный счёт: сначала звенья пути на пробной единице, потом
  // сумма отдачи, потом та же котировка на найденную сумму — и на ту
  // же отметку, что и проба.
  const probe = await core.getQuote({ ...common, fromAmount: '1' });
  if (!probe) throw unavailable();

  const target = Money.toAmount(request.amount);
  const give = giveFor(target, probe);
  if (give === null) {
    throw new InvalidInputError(
      'Такую сумму к выдаче не собрать по этому направлению: назовите сумму отдачи (side: "from")',
    );
  }

  const quote = await core.getQuote({ ...common, fromAmount: give, asOf: probe.asOf });
  if (!quote || quote.toAmount === null) throw unavailable();
  return toApiQuote(request, give, quote);
}

/**
 * Способ выдачи — от получателя, а не из запроса: ставка у перевода в
 * банк и в кошелёк разная, и позволить назвать её самому значило бы
 * позволить выбрать цену. Так же его выводит ядро при подаче
 * (`payoutMethodOfInput` и запись по `requisitesId`); здесь то же
 * правило нужно раньше — обратному счёту, который идёт до подачи.
 * Не нашлось — пусто: ядро откажет при подаче своими словами.
 */
export async function recipientPayoutMethod(
  core: Core,
  actor: Actor,
  recipient: { readonly payout?: RequisiteInput | undefined; readonly requisitesId?: string | undefined },
): Promise<PayoutMethod | undefined> {
  if (recipient.payout !== undefined) {
    const input = recipient.payout;
    if (input.kind !== 'promptpay') {
      return payoutMethodOf({ kind: input.kind, promptpayIdType: null });
    }
    const parsed = parsePromptPay(input.qr);
    return parsed.ok ? payoutMethodOf({ kind: 'promptpay', promptpayIdType: parsed.idType }) : undefined;
  }
  if (recipient.requisitesId !== undefined) {
    const saved = (await core.listRequisites(actor)).find(
      (one) => one.id === recipient.requisitesId,
    );
    return saved ? payoutMethodOf(saved) : undefined;
  }
  return undefined;
}

function giveFor(target: Amount, probe: QuoteView): Amount | null {
  if (probe.fee) {
    const { toBaseRate, fromBaseRate, tiers, thresholdInclusive } = probe.fee;
    if (Money.isZero(fromBaseRate) || Money.isZero(toBaseRate)) return null;
    const neededUsd = usdForPayout(target, fromBaseRate, tiers, { thresholdInclusive });
    return neededUsd === null ? null : Money.divideCeil(neededUsd, toBaseRate, REVERSE_DIGITS);
  }
  if (Money.isZero(probe.rate)) return null;
  return Money.divideCeil(target, probe.rate, REVERSE_DIGITS);
}

function toApiQuote(request: QuoteRequest, fromAmount: string, quote: QuoteView): ApiQuote {
  return {
    from: { currency: request.from, amount: fromAmount },
    to: { currency: request.to, amount: quote.toAmount! },
    rate: quote.rate,
    quotedAt: quote.asOf.toISOString(),
    payoutDecimals: quote.payoutDecimals,
  };
}

function unavailable(): UnavailableError {
  return new UnavailableError(
    'Курс сейчас недоступен: источник котировок молчит. Заявку подать можно — курс ей назовёт менеджер',
  );
}

/**
 * Курс направления для списка `/rates` — для наименьшей суммы, с которой
 * сервис по нему работает.
 *
 * То же правило, что у черты курса в Mini App до набора суммы
 * (`apps/miniapp/lib/rate-line.ts`): без сетки курс один на любую
 * сумму; со ступенями он зависит от суммы, и один курс на направление
 * назвать нечем — называется курс на минимуме направления, а без него на
 * общем минимуме сервиса. Это ориентир, а не обещание на любую сумму,
 * и с ростом суммы он только лучше.
 */
export function referenceRate(quote: QuoteView, serviceMinUsd: Amount): Amount | null {
  if (!quote.fee) return Money.isZero(quote.rate) ? null : quote.rate;

  const { toBaseRate, fromBaseRate, tiers, minUsd, thresholdInclusive } = quote.fee;
  if (Money.isZero(toBaseRate) || Money.isNegative(toBaseRate)) return null;

  const reference = minUsd ?? serviceMinUsd;
  const giveAtReference = Money.divide(reference, toBaseRate);
  const payout = Money.roundTo(
    payoutAfterFee(reference, fromBaseRate, tiers, { thresholdInclusive }),
    quote.payoutDecimals,
  );
  if (Money.isZero(payout) || Money.isZero(giveAtReference)) return null;
  return Money.divide(payout, giveAtReference);
}
