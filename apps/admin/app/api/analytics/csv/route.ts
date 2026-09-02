import { cookies } from 'next/headers';
import { errorResponse } from '@/lib/api';
import { requireStaffActor } from '@/lib/auth/require-session';
import { getCore } from '@/lib/core';
import { toCsv } from '@/lib/csv';
import { formatAmount } from '@/lib/format';
import { TZ_COOKIE, readTzOffset, resolvePeriod } from '@/lib/period';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Выгрузка разреза аналитики в CSV.
 *
 * Тот же разрез, что на экране, с теми же правилами: дни по местному
 * времени, деньги по валютам раздельно — в файле у каждой валюты свой
 * столбец, потому что суммировать их нельзя и в таблице.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const actor = await requireStaffActor();
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
    const kind = params.get('kind') === 'manager' ? 'manager' : 'day';
    const { byDay, byManager } = await getCore().breakdownExchangeRequests(actor, period, {
      offsetMinutes: offset,
    });

    const currencies = [
      ...new Set(
        (kind === 'day' ? byDay.map((row) => row.turnover) : byManager.map((row) => row.income))
          .flat()
          .map((line) => line.code),
      ),
    ].sort();
    const moneyColumns = (lines: readonly { code: string; amount: string }[]) =>
      currencies.map((code) => {
        const line = lines.find((one) => one.code === code);
        return line ? formatAmount(line.amount) : '';
      });

    const rows =
      kind === 'day'
        ? [
            ['День', 'Подано', 'Исполнено', 'Отменено', ...currencies.map((c) => `Оборот, ${c}`)],
            ...byDay.map((row) => [
              row.day,
              row.submitted,
              row.completed,
              row.cancelled,
              ...moneyColumns(row.turnover),
            ]),
          ]
        : [
            [
              'Сотрудник',
              'Исполнил',
              'Отменил',
              'Ведёт сейчас',
              ...currencies.map((c) => `Доход, ${c}`),
            ],
            ...byManager.map((row) => [
              row.displayName,
              row.completed,
              row.cancelled,
              row.open,
              ...moneyColumns(row.income),
            ]),
          ];

    const from = period.from.toISOString().slice(0, 10);
    const to = new Date(period.to.getTime() - 1).toISOString().slice(0, 10);
    const name = `${kind === 'day' ? 'po-dnyam' : 'po-sotrudnikam'}-${from}-${to}.csv`;
    return new Response(toCsv(rows), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${name}"`,
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
