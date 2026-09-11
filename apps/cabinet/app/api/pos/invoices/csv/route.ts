import { toCsv } from '@nemo/ui/csv';
import { errorResponse } from '@/lib/api';
import { requireActor } from '@/lib/auth';
import {
  INVOICE_COLUMN_LABELS,
  invoiceCell,
  invoiceColumns,
  searchInvoices,
  type InvoiceStatus,
} from '@/lib/invoice-rows';
import { listInvoices } from '@/lib/mock/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Выгрузка счетов. Колонки те же, что на экране, и берутся оттуда же —
 * файл, разошедшийся с экраном, обнаруживается уже после того, как
 * числу поверили. В файле все колонки, а не выбранные: личный набор —
 * про то, что тесно на экране, а не про то, чего не должно быть в
 * выгрузке.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const actor = await requireActor();
    const params = new URL(request.url).searchParams;
    const found = searchInvoices(listInvoices(actor.merchantId), params.get('q') ?? undefined);
    const tab = params.get('tab') as InvoiceStatus | null;
    const rows = tab ? found.filter((one) => one.status === tab) : found;

    const table = [
      invoiceColumns.map((column) => INVOICE_COLUMN_LABELS[column]),
      ...rows.map((one) =>
        invoiceColumns.map((column) => {
          const cell = invoiceCell(one, column);
          return cell.meta ? `${cell.text} (${cell.meta})` : cell.text;
        }),
      ),
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
