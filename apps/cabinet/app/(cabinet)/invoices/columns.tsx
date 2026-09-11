'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  INVOICE_COLUMN_LABELS,
  invoiceColumns,
  REQUIRED_INVOICE_COLUMNS,
  type InvoiceColumn,
} from '@/lib/invoice-rows';
import { INVOICE_PREFS_COOKIE, serializeInvoiceColumns } from '@/lib/invoice-prefs';

/**
 * «Поля»: какие колонки показывать. Настройка личная и живёт в куке —
 * читает её сервер, который список и рисует.
 *
 * Номер, сумму и состояние выключить нельзя, и кнопки у них нет вовсе:
 * погашенная кнопка обещает действие, которого не будет.
 */
export function Columns({
  shown,
  merchantId,
}: {
  readonly shown: readonly InvoiceColumn[];
  readonly merchantId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  function toggle(column: InvoiceColumn): void {
    const next = shown.includes(column)
      ? shown.filter((one) => one !== column)
      : invoiceColumns.filter((one) => shown.includes(one) || one === column);
    // Год — чтобы набор пережил закрытую вкладку; не `httpOnly`: куку
    // пишет сама страница.
    document.cookie = `${INVOICE_PREFS_COOKIE}=${serializeInvoiceColumns(next, merchantId)}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }

  const optional = invoiceColumns.filter(
    (one) => !(REQUIRED_INVOICE_COLUMNS as readonly string[]).includes(one),
  );

  return (
    <div className="fields">
      <button
        type="button"
        className="btn btn--ghost btn--tiny"
        onClick={() => setOpen((one) => !one)}
        aria-expanded={open}
      >
        Поля
      </button>
      {open ? (
        <div className="fields__list">
          {optional.map((column) => (
            <label key={column} className="fields__item">
              <input
                type="checkbox"
                checked={shown.includes(column)}
                onChange={() => toggle(column)}
              />
              {INVOICE_COLUMN_LABELS[column]}
            </label>
          ))}
        </div>
      ) : undefined}
    </div>
  );
}
