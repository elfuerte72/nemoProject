import { cookies } from 'next/headers';
import { toCsv } from '@nemo/ui/csv';
import { TZ_COOKIE, readTzOffset } from '@nemo/ui/period';
import { errorResponse } from '@/lib/api';
import { requireActor } from '@/lib/auth';
import { applyInvoiceFilter, readInvoiceFilter } from '@/lib/invoice-filter';
import {
  INVOICE_COLUMN_LABELS,
  INVOICE_EXPORT_COLUMNS,
  invoiceCell,
  invoiceMarks,
} from '@/lib/invoice-rows';
import { listInvoices, listRefunds } from '@/lib/mock/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Выгрузка счетов. Колонки те же, что на экране, и берутся оттуда же —
 * файл, разошедшийся с экраном, обнаруживается уже после того, как
 * числу поверили. В файле все колонки, а не выбранные: личный набор —
 * про то, что тесно на экране, а не про то, чего не должно быть в
 * выгрузке. Кнопки «Подробнее» в файле нет — это не данные.
 *
 * Отбор разбирается тем же правилом, что на странице
 * (`invoice-filter.ts`): поиск, период, «только мои» и таб. Сверх него —
 * `ids`, отмеченные строки: «CSV выбранных» берёт их из того же отбора,
 * и чужой или спрятанный отбором счёт в файл не попадёт, какой бы
 * идентификатор ни пришёл в адресе.
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
    const filter = readInvoiceFilter((key) => params.get(key) ?? undefined, now, offset);
    const { rows: shown } = applyInvoiceFilter(
      listInvoices(actor.merchantId, now),
      filter,
      actor.userId ?? null,
    );
    const ids = new Set((params.get('ids') ?? '').split(',').filter(Boolean));
    const rows = ids.size === 0 ? shown : shown.filter((one) => ids.has(one.id));
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
