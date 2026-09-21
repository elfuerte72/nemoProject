import type { Core, ExchangeTermsView, QuoteView } from '@nemo/core';
import { rateLine, type Amount, type ExchangeKind, type Quote } from '@nemo/types';

/**
 * Справочник направлений с курсом каждого — то, что показывают табло
 * «Курсов», поток его обновлений, POS-терминал и `GET /api/v1/rates`.
 *
 * Одним списком на всех: они отвечают на один вопрос, и два обхода
 * справочника разошлись бы на первой правке — например, в том, для
 * какой суммы называется курс. Курс — для наименьшей суммы направления
 * (`referenceRate`); точную цену на свою сумму считает экран сам, той
 * же арифметикой, что и ядро. Котировки лежат снимками в кэше, и наружу
 * за ними здесь никто не идёт.
 */
/**
 * Курс направления — для наименьшей суммы, с которой сервис по нему
 * работает: без сетки курс один на любую сумму; со ступенями он зависит
 * от суммы, и один курс на направление назвать нечем — называется курс
 * на минимуме направления, а без него на общем минимуме сервиса. То же
 * правило, что у черты курса до набора суммы (`rateLine`).
 */
export function referenceRate(quote: QuoteView, serviceMinUsd: Amount): Amount | null {
  const line = rateLine(quote, null, serviceMinUsd);
  return line.kind === 'rate' ? line.rate : null;
}

export interface DirectionRate {
  readonly fromCode: string;
  readonly toCode: string;
  /** Пусто, когда источник котировки молчит: курс назовёт менеджер. */
  readonly rate: Amount | null;
  /**
   * Котировка целиком — курс, знак валюты выдачи и, у направления со
   * ступенчатой сеткой, оба звена пути. Нужна затем, чтобы табло
   * считало сумму на экране той же арифметикой, что и ядро: со
   * ступенями курс зависит от суммы, и круг по сети на каждую набранную
   * цифру означал бы секунду ожидания.
   */
  readonly quote: Quote | null;
  /**
   * Когда котировка снята — строкой, а не `Date`: тем же видом она
   * уходит в поток обновлений, и два представления одного числа
   * разошлись бы на первой правке.
   */
  readonly quotedAt: string | null;
  /** Свой минимум направления в долларах, если владелец его задал. */
  readonly minAmountUsd: Amount | null;
}

/**
 * Что из котировки едет к экрану. Не `QuoteView` целиком: там наценка
 * сервиса, и ей на табло мерчанта делать нечего.
 */
function toQuote(view: QuoteView): Quote {
  return {
    rate: view.rate,
    payoutDecimals: view.payoutDecimals,
    ...(view.fee ? { fee: view.fee } : {}),
  };
}

/**
 * Направления одного вида сделки с курсом каждого.
 *
 * Вид спрашивается, а не выводится: наличными и переводом сервис
 * торгует разными списками, и цена у наличной выдачи своя — сетка
 * заводится отдельно, потому что касса, встреча и риск стоят сервису
 * другого. Курс наличного направления считается тем же ядром, ему лишь
 * называется способ выдачи.
 */
export async function listDirectionRates(
  core: Core,
  kind: ExchangeKind = 'electronic',
): Promise<{ readonly directions: readonly DirectionRate[]; readonly terms: ExchangeTermsView }> {
  const terms = await core.getExchangeTerms();
  const pairs = terms.pairs.filter((pair) => pair.kind === kind);

  const directions = await Promise.all(
    pairs.map(async ({ fromCode, toCode }): Promise<DirectionRate> => {
      const quote = await core.getQuote({
        fromCode,
        toCode,
        fromAmount: '1',
        ...(kind === 'cash' ? { payoutMethod: 'cash' as const } : {}),
      });
      return {
        fromCode,
        toCode,
        rate: quote ? referenceRate(quote, terms.minAmount) : null,
        quote: quote ? toQuote(quote) : null,
        quotedAt: quote?.asOf.toISOString() ?? null,
        minAmountUsd: quote?.fee?.minUsd ?? null,
      };
    }),
  );

  return { directions, terms };
}
