import type { Core, ExchangeTermsView, QuoteView } from '@nemo/core';
import { rateLine, type Amount } from '@nemo/types';

/**
 * Справочник безналичных направлений с курсом каждого — то, что
 * показывают раздел «Курсы» и `GET /api/v1/rates`.
 *
 * Одним списком на оба: страница и API отвечают на один вопрос, и два
 * обхода справочника разошлись бы на первой правке — например, в том,
 * для какой суммы называется курс. Курс — для наименьшей суммы
 * направления (`referenceRate`); точную цену на свою сумму даёт форма
 * новой заявки и `POST /quote`. Котировки лежат снимками в кэше, и
 * наружу за ними здесь никто не идёт.
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
  readonly quotedAt: Date | null;
  /** Свой минимум направления в долларах, если владелец его задал. */
  readonly minAmountUsd: Amount | null;
}

export async function listDirectionRates(
  core: Core,
): Promise<{ readonly directions: readonly DirectionRate[]; readonly terms: ExchangeTermsView }> {
  const terms = await core.getExchangeTerms();
  const electronic = terms.pairs.filter((pair) => pair.kind === 'electronic');

  const directions = await Promise.all(
    electronic.map(async ({ fromCode, toCode }): Promise<DirectionRate> => {
      const quote = await core.getQuote({ fromCode, toCode, fromAmount: '1' });
      return {
        fromCode,
        toCode,
        rate: quote ? referenceRate(quote, terms.minAmount) : null,
        quotedAt: quote?.asOf ?? null,
        minAmountUsd: quote?.fee?.minUsd ?? null,
      };
    }),
  );

  return { directions, terms };
}
