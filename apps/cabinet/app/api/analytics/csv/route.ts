import { cookies } from 'next/headers';
import { toCsv } from '@nemo/ui/csv';
import { TZ_COOKIE, readTzOffset } from '@nemo/ui/period';
import { errorResponse } from '@/lib/api';
import { requireActor } from '@/lib/auth';
import { getCore } from '@/lib/core';
import { analyticsTables, reportRows, summaryTable } from '@/lib/analytics-rows';
import { readAnalyticsQuery } from '@/lib/analytics-query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Выгрузка разреза за период — или всего отчёта (`kind=report`).
 *
 * Шапка и строки — те же, что на экране (`analyticsTables`), и адрес
 * разбирается тем же `readAnalyticsQuery`: файл, разошедшийся с экраном
 * в колонках, шаге или отборе «только мои», обнаруживается уже после
 * того, как числу поверили.
 *
 * Незнакомый разрез — «не найден», а не пустой файл: пустой читается
 * как «за период ничего не было».
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const actor = await requireActor();
    const params = new URL(request.url).searchParams;
    const offset = readTzOffset((await cookies()).get(TZ_COOKIE)?.value);
    const query = readAnalyticsQuery(
      (name) => params.get(name) ?? undefined,
      actor,
      new Date(),
      offset,
    );

    const narrowed = query.submittedBy ? { submittedBy: query.submittedBy } : {};
    const wanted = params.get('kind');
    // Сводка нужна только показателям и отчёту целиком: файл одного
    // разреза ради неё ходил бы в базу шесть раз впустую.
    const needsSummary = wanted === 'summary' || wanted === 'report';
    const [stats, cut] = await Promise.all([
      needsSummary
        ? getCore().summarizeMerchant(actor, actor.merchantId, query.period, {
            offsetMinutes: offset,
            ...narrowed,
          })
        : null,
      getCore().breakdownMerchant(actor, actor.merchantId, query.period, {
        offsetMinutes: offset,
        step: query.step,
        ...narrowed,
      }),
    ]);
    // Показатели — первым разделом: плитки, сроки и рекорды; за ними
    // разрезы в порядке страницы.
    const tables = [
      ...(stats
        ? [summaryTable(stats, cut, { days: query.days, paceDays: query.paceDays, mine: query.mine })]
        : []),
      ...analyticsTables(cut, { offsetMinutes: offset }),
    ];
    const { from, to } = query.base;

    if (wanted === 'report') {
      const heading = [
        query.mine ? 'Аналитика — только мои заявки' : 'Аналитика',
        `${from} — ${to}`,
      ];
      return csvResponse(toCsv(reportRows(tables, heading)), `report-${from}-${to}.csv`);
    }

    const table = tables.find((one) => one.key === wanted);
    if (!table) {
      return new Response('Такого разреза нет', { status: 404, headers: { 'cache-control': 'no-store' } });
    }
    return csvResponse(toCsv([table.columns, ...table.rows]), `${table.key}-${from}-${to}.csv`);
  } catch (error) {
    return errorResponse(error);
  }
}

function csvResponse(body: string, filename: string): Response {
  return new Response(body, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  });
}
