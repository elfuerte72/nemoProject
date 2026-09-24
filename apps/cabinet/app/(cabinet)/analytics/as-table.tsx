import { CurrencyFlag } from '@nemo/flags';
import type { Cell } from '@/lib/analytics-rows';

/** Таблица разреза — то, что строит `analyticsTables`. */
export interface TableView {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly Cell[])[];
  readonly marks?: readonly (readonly string[])[];
}

/**
 * Таблица разреза на экране: первая колонка — имя строки, остальные —
 * числа, прижатые вправо, чтобы разряды стояли столбиком. Значки валют
 * встают перед именем строки там, где разрез их знает: у валют и у
 * направлений.
 *
 * Строка, где все числа — нули, приглушена: у часа или дня без единой
 * заявки место в таблице есть, а спорить за внимание с непустыми ему
 * незачем.
 */
export function DataTable({
  table,
  render,
}: {
  readonly table: TableView;
  /** Своя ячейка там, где текста мало: «да» у нового получателя — пилюлей. */
  readonly render?: (column: number, cell: Cell) => React.ReactNode;
}) {
  return (
    <div className="scroll-x">
      <table className="datatable">
        <thead>
          <tr>
            {table.columns.map((column, index) => (
              <th key={column} className={index === 0 ? undefined : 'num'}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, at) => {
            const marks = table.marks?.[at];
            return (
              <tr
                /*
                 * Ключ — место строки, а не её первая ячейка: у двух
                 * получателей в одном банке с одинаковым хвостом номера
                 * подписи совпадают. Порядок строк задаёт сервер.
                 */
                key={at}
                className={
                  row.every((cell) => typeof cell !== 'number' || cell === 0)
                    ? 'datatable__row--empty'
                    : undefined
                }
              >
                {row.map((cell, index) => (
                  <td key={table.columns[index] ?? index} className={index === 0 ? undefined : 'num'}>
                    {index === 0 && marks ? (
                      <span className="money-cell">
                        {/*
                          Пара — внахлёст, как на «Курсах»; одиночный
                          значок — без обоймы: у неё второй знак
                          заезжает на первый, а заезжать ему не на что.
                        */}
                        {marks.length > 1 ? (
                          <span className="pair__marks">
                            {marks.map((code) => (
                              <CurrencyFlag key={code} code={code} size={18} />
                            ))}
                          </span>
                        ) : (
                          marks.map((code) => <CurrencyFlag key={code} code={code} size={18} />)
                        )}
                        {cell}
                      </span>
                    ) : render ? (
                      render(index, cell)
                    ) : (
                      <Wrapped cell={cell} />
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Деньги по валютам переносятся только между валютами: «238 000 RUB ·
 * 6 200 USDT» в узкой колонке рвалось между числом и кодом, и «USDT»
 * на второй строке читалось как отдельная сумма.
 */
function Wrapped({ cell }: { readonly cell: Cell }) {
  if (typeof cell !== 'string' || !cell.includes(' · ')) return <>{cell}</>;
  const parts = cell.split(' · ');
  return (
    <>
      {parts.map((part, index) => (
        <span key={index} className="nowrap">
          {part}
          {index < parts.length - 1 ? ' · ' : ''}
        </span>
      ))}
    </>
  );
}

/**
 * Двойник графика таблицей — свёрнутым под ним. График читают глазами,
 * а тот, кто не водит указателем, получает те же числа строками: правило
 * скилла `dataviz` — у всякого графика есть таблица.
 */
export function AsTable({ table }: { readonly table: TableView }) {
  return (
    <details className="astable">
      <summary className="astable__summary">Таблицей</summary>
      <DataTable table={table} />
    </details>
  );
}
