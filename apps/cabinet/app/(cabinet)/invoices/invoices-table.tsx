'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Moment } from '@nemo/ui';
import type { PillTone } from '@/lib/labels';
import type { InvoicePrefs } from '@/lib/invoice-prefs';
import { INVOICE_COLUMN_LABELS, type Cell, type InvoiceColumn } from '@/lib/invoice-rows';
import { Columns } from './columns';

/** Строка списка, уже разложенная сервером по ячейкам. */
export interface InvoiceRowView {
  readonly id: string;
  readonly tone: PillTone;
  readonly createdAt: string;
  readonly paidAt: string | null;
  readonly cells: Readonly<Partial<Record<InvoiceColumn, Cell>>>;
}

/**
 * Таблица счетов с выбором строк — по образцу: отмеченные уходят в файл
 * отдельной выгрузкой, а общий «CSV» в шапке берёт весь отбор.
 *
 * Выбор живёт в странице, а не в адресе: это не отбор, а «вот эти три
 * покажу бухгалтеру», и пересылать его ссылкой незачем. Строка, ушедшая
 * со страницы, из выбора выпадает — уехавшая из виду, она ушла бы в файл
 * незамеченной, — а оставшиеся остаются отмеченными: список живой и
 * перечитывается по событиям терминала, и новый счёт коллеги не должен
 * молча снимать отмеченное.
 */
export function InvoicesTable({
  rows,
  prefs,
  merchantId,
  exportHref,
}: {
  readonly rows: readonly InvoiceRowView[];
  readonly prefs: InvoicePrefs;
  readonly merchantId: string;
  /** Адрес выгрузки без выбора: к нему добавляются отмеченные. */
  readonly exportHref: string;
}) {
  const { columns, dense } = prefs;
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const ids = rows.map((one) => one.id).join(',');

  useEffect(() => {
    const here = new Set(ids.split(','));
    setPicked((was) => {
      const kept = [...was].filter((id) => here.has(id));
      return kept.length === was.size ? was : new Set(kept);
    });
  }, [ids]);

  const all = rows.length > 0 && rows.every((one) => picked.has(one.id));
  const some = !all && rows.some((one) => picked.has(one.id));

  function flip(id: string): void {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  }

  const joiner = exportHref.includes('?') ? '&' : '?';

  return (
    <>
      {/*
        Полоса стоит всегда, а не появляется с первой галочкой: иначе
        она сталкивала бы таблицу вниз, и второй щелчок по строке
        попадал бы в соседнюю.
      */}
      {/*
        Строка над таблицей — её инструменты: слева что делать с
        отмеченным, справа вид самой таблицы. «Поля» стояли в шапке
        страницы рядом с «Создать счёт» и читались как действие со
        счётом; это настройка таблицы, и место ей у таблицы.
      */}
      <div className="picked">
        <div className="picked__main" role="status">
          {picked.size > 0 ? (
            <>
              <span>Выбрано: {picked.size}</span>
              <a
                className="btn btn--soft btn--tiny"
                href={`${exportHref}${joiner}ids=${encodeURIComponent([...picked].join(','))}`}
              >
                CSV выбранных ({picked.size})
              </a>
              <button type="button" className="btn btn--ghost btn--tiny" onClick={() => setPicked(new Set())}>
                Снять выбор
              </button>
            </>
          ) : (
            <span>Отметьте строки, чтобы выгрузить только их.</span>
          )}
        </div>
        <Columns prefs={prefs} merchantId={merchantId} />
      </div>

      <div className="scroll-x">
        <table className={dense ? 'datatable datatable--dense' : 'datatable'}>
          <thead>
            <tr>
              <th className="datatable__pick">
                <input
                  type="checkbox"
                  aria-label="Выбрать все счета на странице"
                  checked={all}
                  ref={(node) => {
                    if (node) node.indeterminate = some;
                  }}
                  onChange={() => setPicked(all ? new Set() : new Set(rows.map((one) => one.id)))}
                />
              </th>
              {/*
                У колонки кнопок подписи на экране нет, но диктору она
                названа — атрибутом, а не скрытым текстом: `.sr-only`
                стоит вне потока и вылезал из прокрутки таблицы, раздвигая
                всю страницу на телефоне.
              */}
              {columns.map((column) =>
                column === 'open' ? (
                  <th key={column} aria-label={INVOICE_COLUMN_LABELS[column]} />
                ) : (
                  <th
                    key={column}
                    className={column === 'amount' || column === 'created' ? 'num' : undefined}
                  >
                    {INVOICE_COLUMN_LABELS[column]}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((one) => (
              <tr key={one.id} className={picked.has(one.id) ? 'datatable__row--picked' : undefined}>
                <td className="datatable__pick">
                  <input
                    type="checkbox"
                    aria-label={`Выбрать счёт ${one.cells.number?.text ?? ''}`}
                    checked={picked.has(one.id)}
                    onChange={() => flip(one.id)}
                  />
                </td>
                {columns.map((column) => {
                  const cell = one.cells[column];
                  if (!cell) return <td key={column} />;
                  return (
                    <td key={column} className={cell.numeric || column === 'open' ? 'num' : undefined}>
                      {column === 'number' ? (
                        <Link href={`/invoices/${one.id}`}>{cell.text}</Link>
                      ) : column === 'status' ? (
                        <span className={`pill pill--${one.tone}`}>{cell.text}</span>
                      ) : column === 'created' ? (
                        <Moment at={one.createdAt} />
                      ) : column === 'open' ? (
                        <Link className="btn btn--ghost btn--tiny" href={`/invoices/${one.id}`}>
                          {cell.text}
                        </Link>
                      ) : (
                        cell.text
                      )}
                      {column === 'created' && one.paidAt ? (
                        <span className="row__meta">
                          оплачен <Moment at={one.paidAt} />
                        </span>
                      ) : cell.meta && column !== 'created' ? (
                        <span className="row__meta">{cell.meta}</span>
                      ) : undefined}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
