import { json } from '@nemo/http';
import { getCore } from '@/lib/core';
import { referenceRate } from '@/lib/v1/quote';
import { v1 } from '@/lib/v1/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Направления и курс каждого — то же, что бот показывает по кнопке
 * «Курс», и минимум со сроком оплаты рядом: мерчант должен узнать их до
 * подачи, а не из отказа.
 *
 * Только безналичные направления: наличные по API не подаются. Курс —
 * для наименьшей суммы направления (см. `referenceRate`); точную цену
 * на свою сумму даёт `POST /quote`. Котировки лежат снимками в кэше, и
 * наружу за ними здесь никто не идёт.
 */
export const GET = v1(async () => {
  const core = getCore();
  const terms = await core.getExchangeTerms();
  const electronic = terms.pairs.filter((pair) => pair.kind === 'electronic');

  const pairs = await Promise.all(
    electronic.map(async ({ fromCode, toCode }) => {
      const quote = await core.getQuote({ fromCode, toCode, fromAmount: '1' });
      return {
        from: fromCode,
        to: toCode,
        rate: quote ? referenceRate(quote, terms.minAmount) : null,
        quotedAt: quote?.asOf.toISOString() ?? null,
        /** Свой минимум направления в долларах, если владелец его задал. */
        minAmountUsd: quote?.fee?.minUsd ?? null,
      };
    }),
  );

  return json({
    pairs,
    minAmount: terms.minAmount,
    minAmountCurrency: terms.minAmountCode,
    payWithinMinutes: terms.unpaidTtlMinutes,
  });
});
