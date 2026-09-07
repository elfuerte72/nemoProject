import { json } from '@nemo/http';
import { getCore } from '@/lib/core';
import { listDirectionRates } from '@/lib/direction-rates';
import { v1 } from '@/lib/v1/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Направления и курс каждого — то же, что бот показывает по кнопке
 * «Курс» и кабинет в разделе «Курсы», и минимум со сроком оплаты
 * рядом: мерчант должен узнать их до подачи, а не из отказа.
 *
 * Только безналичные направления: наличные по API не подаются. Курс —
 * для наименьшей суммы направления (`listDirectionRates`); точную цену
 * на свою сумму даёт `POST /quote`.
 */
export const GET = v1(async () => {
  const { directions, terms } = await listDirectionRates(getCore());

  return json({
    pairs: directions.map((one) => ({
      from: one.fromCode,
      to: one.toCode,
      rate: one.rate,
      quotedAt: one.quotedAt?.toISOString() ?? null,
      minAmountUsd: one.minAmountUsd,
    })),
    minAmount: terms.minAmount,
    minAmountCurrency: terms.minAmountCode,
    payWithinMinutes: terms.unpaidTtlMinutes,
  });
});
