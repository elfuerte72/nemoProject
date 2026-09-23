'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CurrencyFlag } from '@nemo/flags';
import { Moment } from '@nemo/ui';
import type { PillTone } from '@/lib/labels';
import type { InvoicePrefs } from '@/lib/invoice-prefs';
import { INVOICE_COLUMN_LABELS, type Cell, type InvoiceColumn } from '@/lib/invoice-rows';
import { send } from '@/app/ui/send';
import { Columns } from './columns';

/** Строка списка, уже разложенная сервером по ячейкам. */
export interface InvoiceRowView {
  readonly id: string;
  readonly tone: PillTone;
  readonly createdAt: string;
  readonly paidAt: string | null;
  /** Ждёт денег: его можно отметить оплаченным. */
  readonly payable: boolean;
  /** Денег по нему не было: его можно удалить. */
  readonly deletable: boolean;
  readonly cells: Readonly<Partial<Record<InvoiceColumn, Cell>>>;
}

type Bulk = 'paid' | 'delete';

/** «2 счёта», «5 счетов» — число в подтверждении читается словом рядом. */
function invoicesWord(count: number): string {
  const tail = count % 100;
  if (tail >= 11 && tail <= 14) return `${count} счетов`;
  if (count % 10 === 1) return `${count} счёт`;
  if (count % 10 >= 2 && count % 10 <= 4) return `${count} счёта`;
  return `${count} счетов`;
}

/**
 * Таблица счетов с выбором строк — по образцу: отмеченные уходят в файл
 * отдельной выгрузкой, отмечаются оплаченными или удаляются, а общий
 * «CSV» в шапке берёт весь отбор.
 *
 * Выбор живёт в странице, а не в адресе: это не отбор, а «вот эти три
 * покажу бухгалтеру», и пересылать его ссылкой незачем. Строка, ушедшая
 * со страницы, из выбора выпадает — уехавшая из виду, она ушла бы в файл
 * незамеченной, — а оставшиеся остаются отмеченными: список живой и
 * перечитывается по событиям терминала, и новый счёт коллеги не должен
 * молча снимать отмеченное.
 *
 * Действие считает только те отмеченные, к которым применимо, и число
 * стоит на кнопке: «Удалить (2)» при трёх отмеченных говорит, что
 * оплаченный третий не тронут, до нажатия, а не после. Какие применимы,
 * решает то же правило, что у маршрута (`bulkTargets`), — сервер кладёт
 * ответ в строку.
 */
export function InvoicesTable({
  rows,
  prefs,
  merchantId,
  exportHref,
  canAct,
}: {
  readonly rows: readonly InvoiceRowView[];
  readonly prefs: InvoicePrefs;
  readonly merchantId: string;
  /** Адрес выгрузки без выбора: к нему добавляются отмеченные. */
  readonly exportHref: string;
  /** Право POS-терминала: наблюдателю маршрут откажет, и кнопки вели бы в отказ. */
  readonly canAct: boolean;
}) {
  const router = useRouter();
  const { columns, dense } = prefs;
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [asking, setAsking] = useState<Bulk>();
  const [busy, setBusy] = useState(false);
  const [complaint, setComplaint] = useState<string>();
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
  const chosen = rows.filter((one) => picked.has(one.id));
  const payable = chosen.filter((one) => one.payable).map((one) => one.id);
  const deletable = chosen.filter((one) => one.deletable).map((one) => one.id);

  function flip(id: string): void {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
    setAsking(undefined);
  }

  async function act(action: Bulk, targets: readonly string[]): Promise<void> {
    // Кнопка нарочно не гаснет (погашенная теряет фокус), и второе
    // нажатие во время запроса отбрасывается здесь.
    if (busy) return;
    setComplaint(undefined);
    setBusy(true);
    const reply = await send('/api/pos/invoices/bulk', { action, ids: targets });
    setBusy(false);
    if (!reply.ok) {
      setComplaint(reply.complaint);
      return;
    }
    setAsking(undefined);
    setPicked(new Set());
    router.refresh();
  }

  const joiner = exportHref.includes('?') ? '&' : '?';

  return (
    <>
      {/*
        Строка над таблицей — её инструменты: слева что делать с
        отмеченным, справа вид самой таблицы. Стоит всегда, а не
        появляется с первой галочкой: иначе она сталкивала бы таблицу
        вниз, и второй щелчок по строке попадал бы в соседнюю.
      */}
      <div className="picked">
        <div className="picked__main" role="status">
          {picked.size > 0 ? (
            <>
              <span>Выбрано: {picked.size}</span>
              {canAct && payable.length > 0 ? (
                <button
                  type="button"
                  className={asking === 'paid' ? 'btn btn--soft btn--tiny' : 'btn btn--ghost btn--tiny'}
                  aria-expanded={asking === 'paid'}
                  onClick={() => setAsking(asking === 'paid' ? undefined : 'paid')}
                >
                  Отметить оплаченным ({payable.length})
                </button>
              ) : undefined}
              <a
                className="btn btn--ghost btn--tiny"
                href={`${exportHref}${joiner}ids=${encodeURIComponent([...picked].join(','))}`}
              >
                CSV выбранных ({picked.size})
              </a>
              {canAct && deletable.length > 0 ? (
                <button
                  type="button"
                  className={asking === 'delete' ? 'btn btn--soft btn--tiny' : 'btn btn--ghost btn--tiny'}
                  aria-expanded={asking === 'delete'}
                  onClick={() => setAsking(asking === 'delete' ? undefined : 'delete')}
                >
                  Удалить ({deletable.length})
                </button>
              ) : undefined}
              <button
                type="button"
                className="btn btn--ghost btn--tiny"
                onClick={() => {
                  setPicked(new Set());
                  setAsking(undefined);
                }}
              >
                Снять выбор
              </button>
            </>
          ) : (
            <span>Отметьте строки, чтобы выгрузить их, отметить оплаченными или удалить.</span>
          )}
        </div>
        <Columns prefs={prefs} merchantId={merchantId} />
      </div>

      {/*
        Подтверждение — раскрытием строки, как у действий в карточке
        счёта: необратимое спрашивают на месте, и кнопка при этом не
        гаснет. Пока идёт запрос, раскрытое не закрывается — закрытое на
        полпути, оно оставило бы без ответа, чем всё кончилось.
      */}
      {asking === 'paid' && payable.length > 0 ? (
        <div className="actions__ask picked__ask">
          <p className="muted">
            Отметить {invoicesWord(payable.length)} {payable.length === 1 ? 'оплаченным' : 'оплаченными'}?
            Это ваша отметка: деньги пришли мимо сервиса, наличными или переводом.
            {payable.length < picked.size ? ' Остальные отмеченные денег уже не ждут и останутся как есть.' : ''}
          </p>
          <button
            type="button"
            className="btn btn--gold btn--tiny"
            aria-busy={busy}
            onClick={() => void act('paid', payable)}
          >
            Да, отметить оплаченными
          </button>
          <button type="button" className="btn btn--ghost btn--tiny" onClick={() => setAsking(undefined)} disabled={busy}>
            Не сейчас
          </button>
        </div>
      ) : undefined}
      {asking === 'delete' && deletable.length > 0 ? (
        <div className="actions__ask picked__ask">
          <p className="muted">
            Удалить {invoicesWord(deletable.length)}? Удалённый счёт не вернуть.
            {deletable.some((id) => payable.includes(id))
              ? ' Ждущий оплаты перестанет приниматься: QR и ссылка по нему погаснут.'
              : ''}
            {deletable.length < picked.size
              ? ' Оплаченные и возвращённые не удаляются: по ним прошли деньги.'
              : ''}
          </p>
          <button
            type="button"
            className="btn btn--danger btn--tiny"
            aria-busy={busy}
            onClick={() => void act('delete', deletable)}
          >
            Да, удалить
          </button>
          <button type="button" className="btn btn--ghost btn--tiny" onClick={() => setAsking(undefined)} disabled={busy}>
            Не надо
          </button>
        </div>
      ) : undefined}
      {complaint ? <p className="error">{complaint}</p> : undefined}

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
                  onChange={() => {
                    setPicked(all ? new Set() : new Set(rows.map((one) => one.id)));
                    setAsking(undefined);
                  }}
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
                    className={
                      column === 'pays' || column === 'gets' || column === 'created' ? 'num' : undefined
                    }
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
                      ) : cell.flag ? (
                        // Сумма сделки — значком валюты и крупнее прочего:
                        // за ней в список и приходят.
                        <span className="money-cell">
                          <CurrencyFlag code={cell.flag} size={16} />
                          {cell.text}
                        </span>
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
