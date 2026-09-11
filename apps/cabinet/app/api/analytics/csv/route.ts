import { cookies } from 'next/headers';
import { toCsv } from '@nemo/ui/csv';
import { TZ_COOKIE, dayOf, readTzOffset, resolvePeriod } from '@nemo/ui/period';
import { errorResponse } from '@/lib/api';
import { requireActor } from '@/lib/auth';
import { getCore } from '@/lib/core';
import { analyticsTables } from '@/lib/analytics-rows';
import { resolveStep } from '@/lib/analytics-texts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Выгрузка одного разреза за период.
 *
 * Шапка и строки — те же, что на экране (`analyticsTables`): файл,
 * разошедшийся с экраном в колонках, обнаруживается уже после того,
 * как числу поверили.
 *
 * Незнакомый разрез — «не найден», а не пустой файл: пустой читается
 * как «за период ничего не было».
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const actor = await requireActor();
    const params = new URL(request.url).searchParams;
    const offset = readTzOffset((await cookies()).get(TZ_COOKIE)?.value);
    const period = resolvePeriod(
      {
        period: params.get('period') ?? undefined,
        from: params.get('from') ?? undefined,
        to: params.get('to') ?? undefined,
      },
      new Date(),
      offset,
    );
    const step = resolveStep(params.get('step') ?? undefined);

    const cut = await getCore().breakdownMerchant(actor, actor.merchantId, period, {
      offsetMinutes: offset,
      step,
    });
    const wanted = params.get('kind');
    const table = analyticsTables(cut).find((one) => one.key === wanted);
    if (!table) {
      return new Response('Такого разреза нет', { status: 404, headers: { 'cache-control': 'no-store' } });
    }

    const from = dayOf(period.from, offset);
    const to = dayOf(new Date(period.to.getTime() - 1), offset);
    return new Response(toCsv([table.columns, ...table.rows]), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${table.key}-${from}-${to}.csv"`,
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
