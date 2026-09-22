import { cookies } from 'next/headers';
import type { ExchangeRequestView } from '@nemo/core';
import { toCsv } from '@nemo/ui/csv';
import { formatAmount } from '@nemo/ui/format';
import { TZ_COOKIE, dayOf, readTzOffset, resolvePeriod } from '@nemo/ui/period';
import { errorResponse } from '@/lib/api';
import { requireActor } from '@/lib/auth';
import { getCore } from '@/lib/core';
import { STATUS_LABELS } from '@/lib/labels';
import { boundsOf } from '@/lib/request-rows';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Столько строк просится за один заход; хвост дочитывается по курсору
 * до пустой страницы — а не до «короткой»: предел ядра может оказаться
 * ниже, и выгрузка оборвалась бы молча.
 */
const PAGE = 200;

/**
 * Выгрузка заявок за период в CSV — для сверки с собственным учётом
 * мерчанта. Те же границы, что у обзора: заявки по дате подачи, дни по
 * часам того, кто смотрит. Реквизитов в файле нет — только суммы,
 * курс, состояние и даты.
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

    const core = getCore();
    const rows: ExchangeRequestView[] = [];
    let after: { createdAt: Date; id: string } | undefined;
    for (;;) {
      const page = await core.listExchangeRequests(actor, {
        // Верхняя граница у своего списка включительная, у периода — нет:
        // перевод один на выгрузку, страницу заявок и её дочитывание.
        ...boundsOf({ period }),
        limit: PAGE,
        ...(after ? { after } : {}),
      });
      const last = page[page.length - 1];
      if (!last) break;
      rows.push(...page);
      after = { createdAt: last.createdAt, id: last.id };
    }

    const stamp = (date: Date | null) =>
      date ? new Date(date.getTime() + offset * 60_000).toISOString().slice(0, 16).replace('T', ' ') : '';
    const table = [
      ['Заявка', 'Свой номер', 'Состояние', 'Отдаю', 'Валюта', 'Получаю', 'Валюта', 'Курс', 'Подана', 'Исполнена'],
      ...rows.map((one) => [
        one.id,
        one.reference ?? '',
        STATUS_LABELS[one.status],
        formatAmount(one.fromAmount),
        one.fromCode,
        one.toAmount ? formatAmount(one.toAmount) : '',
        one.toCode,
        rateOf(one),
        stamp(one.createdAt),
        stamp(one.completedAt),
      ]),
    ];

    // Дни в имени — местные, как и границы периода.
    const from = dayOf(period.from, offset);
    const to = dayOf(new Date(period.to.getTime() - 1), offset);
    return new Response(toCsv(table), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="zayavki-${from}-${to}.csv"`,
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Курс заявки — обязательство сервиса; пусто, пока его не назвал менеджер. */
function rateOf(one: ExchangeRequestView): string {
  const rate = one.finalRate ?? one.requestRate;
  return rate ? formatAmount(rate) : '';
}
