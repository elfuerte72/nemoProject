import { cookies } from 'next/headers';
import { toCsv } from '@nemo/ui/csv';
import { TZ_COOKIE, readTzOffset, type PeriodKey } from '@nemo/ui/period';
import { errorResponse } from '@/lib/api';
import { requireActor } from '@/lib/auth';
import {
  INVOICE_COLUMN_LABELS,
  INVOICE_EXPORT_COLUMNS,
  invoiceCell,
  invoiceMarks,
  invoiceStatuses,
  narrowInvoices,
  type InvoiceStatus,
} from '@/lib/invoice-rows';
import { listInvoices, listRefunds } from '@/lib/mock/store';
import { pickPeriod } from '@/lib/request-rows';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Те же чипы периода, что на странице: ссылка «Выгрузить» несёт их адрес. */
const INVOICE_PERIOD_KEYS: readonly PeriodKey[] = ['today', '7d', '30d'];

/**
 * Выгрузка счетов. Колонки те же, что на экране, и берутся оттуда же —
 * файл, разошедшийся с экраном, обнаруживается уже после того, как
 * числу поверили. В файле все колонки, а не выбранные: личный набор —
 * про то, что тесно на экране, а не про то, чего не должно быть в
 * выгрузке. Кнопки «Открыть» в файле нет — это не данные.
 *
 * Отбор тот же, что у списка: поиск, период, «только мои» и таб. Сверх
 * него — `ids`, отмеченные строки: «выгрузить выбранные» берёт их из
 * того же отбора, и чужой или спрятанный отбором счёт в файл не попадёт,
 * какой бы идентификатор ни пришёл в адресе.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const actor = await requireActor();
    const params = new URL(request.url).searchParams;
    // Дни в файле — местные, те же, что на экране: смещение пояса
    // кладёт в куку шапка. Иначе у мерчанта из Бангкока файл называл
    // бы вчерашний день у ночного счёта.
    const offset = readTzOffset((await cookies()).get(TZ_COOKIE)?.value);
    const now = new Date();
    const picked = pickPeriod(
      {
        period: params.get('period') ?? undefined,
        from: params.get('from') ?? undefined,
        to: params.get('to') ?? undefined,
      },
      now,
      offset,
      INVOICE_PERIOD_KEYS,
    );
    const found = narrowInvoices(listInvoices(actor.merchantId, now), {
      query: params.get('q') ?? undefined,
      from: picked?.period.from,
      to: picked?.period.to,
      authorId: params.get('mine') === '1' ? (actor.userId ?? undefined) : undefined,
    });
    /*
     * Незнакомое состояние — весь список, как и на самой странице:
     * файл с одной шапкой читается как «счетов не было», а не как
     * «в адресе опечатка».
     */
    const asked = params.get('tab');
    const tab = (invoiceStatuses as readonly string[]).includes(asked ?? '')
      ? (asked as InvoiceStatus)
      : undefined;
    const ids = new Set((params.get('ids') ?? '').split(',').filter(Boolean));
    const rows = found.filter(
      (one) => (tab === undefined || one.status === tab) && (ids.size === 0 || ids.has(one.id)),
    );
    const refunds = listRefunds(actor.merchantId);

    const table = [
      INVOICE_EXPORT_COLUMNS.map((column) => INVOICE_COLUMN_LABELS[column]),
      ...rows.map((one) => {
        const marks = invoiceMarks(one, refunds);
        return INVOICE_EXPORT_COLUMNS.map((column) => {
          const cell = invoiceCell(one, column, offset, marks);
          return cell.meta ? `${cell.text} (${cell.meta})` : cell.text;
        });
      }),
    ];

    return new Response(toCsv(table), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="scheta.csv"',
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
