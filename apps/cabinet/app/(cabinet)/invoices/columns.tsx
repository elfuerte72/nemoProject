'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@nemo/ui';
import {
  INVOICE_COLUMN_LABELS,
  invoiceColumns,
  REQUIRED_INVOICE_COLUMNS,
  type InvoiceColumn,
} from '@/lib/invoice-rows';
import {
  DEFAULT_INVOICE_PREFS,
  INVOICE_PREFS_COOKIE,
  PER_PAGE_OPTIONS,
  serializeInvoicePrefs,
  type InvoicePrefs,
} from '@/lib/invoice-prefs';

/**
 * «Вид таблицы»: какие колонки показывать, насколько плотно и сколько строк на
 * странице. Настройка личная и живёт в куке — читает её сервер, который
 * список и рисует, и страницу режет тоже он.
 *
 * Номер, сумму и состояние выключить нельзя, и кнопки у них нет вовсе:
 * погашенная кнопка обещает действие, которого не будет.
 */
export function Columns({
  prefs,
  merchantId,
}: {
  readonly prefs: InvoicePrefs;
  readonly merchantId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // Закрывается клавишей выхода и нажатием мимо — как меню шапки.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onDown = (event: PointerEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  function save(next: InvoicePrefs): void {
    // Год — чтобы настройка пережила закрытую вкладку; не `httpOnly`:
    // куку пишет сама страница.
    document.cookie = `${INVOICE_PREFS_COOKIE}=${serializeInvoicePrefs(next, merchantId)}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }

  function toggle(column: InvoiceColumn): void {
    const columns = prefs.columns.includes(column)
      ? prefs.columns.filter((one) => one !== column)
      : invoiceColumns.filter((one) => prefs.columns.includes(one) || one === column);
    save({ ...prefs, columns });
  }

  const optional = invoiceColumns.filter(
    (one) => !(REQUIRED_INVOICE_COLUMNS as readonly string[]).includes(one),
  );

  return (
    <div className="fields" ref={box}>
      {/*
        «Вид таблицы», а не «Поля»: кнопка стоит у таблицы и говорит,
        что меняет, — колонки, плотность, число строк. Слово «Поля»
        понятно тому, кто уже открывал её в панели, а мерчант спрашивал,
        зачем она.
      */}
      <button
        type="button"
        className="btn btn--ghost btn--tiny"
        onClick={() => setOpen((one) => !one)}
        aria-expanded={open}
      >
        <Icon name="settings" size={14} />
        Вид таблицы
      </button>
      {open ? (
        <div className="fields__list" role="group" aria-label="Что показывать в таблице">
          <p className="fields__note">Настройка личная: она живёт в этом браузере и не видна коллегам.</p>
          <span className="fields__title">Колонки</span>
          {optional.map((column) => (
            <label key={column} className="fields__item">
              <input
                type="checkbox"
                checked={prefs.columns.includes(column)}
                onChange={() => toggle(column)}
              />
              {INVOICE_COLUMN_LABELS[column]}
            </label>
          ))}
          <span className="fields__title">Вид</span>
          <label className="fields__item">
            <input
              type="checkbox"
              checked={prefs.dense}
              onChange={() => save({ ...prefs, dense: !prefs.dense })}
            />
            Плотная таблица
          </label>
          <label className="fields__item">
            Строк на странице
            <select
              className="input fields__select"
              value={prefs.perPage}
              onChange={(event) => save({ ...prefs, perPage: Number(event.target.value) })}
            >
              {PER_PAGE_OPTIONS.map((one) => (
                <option key={one} value={one}>
                  {one}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn btn--ghost btn--tiny"
            onClick={() => save(DEFAULT_INVOICE_PREFS)}
          >
            Вернуть по умолчанию
          </button>
        </div>
      ) : undefined}
    </div>
  );
}
