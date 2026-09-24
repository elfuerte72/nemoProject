'use client';

import { useState } from 'react';
import { DataTable, type TableView } from './as-table';

/**
 * Разрезы с одинаковыми колонками — направления, способы выдачи,
 * источники — одной карточкой во всю ширину с переключателем.
 *
 * У образца это три блока в половину экрана, но там в таблице по три
 * колонки, а здесь по шесть: в половине ширины оборот обрезался, и
 * таблица уезжала в прокрутку вбок. Колонки у трёх разрезов одни и те
 * же, поэтому переключаются строки, а шапка остаётся на месте.
 *
 * Разрез выбирается на месте, без похода на сервер: все три уже
 * приехали со страницей. У выбранного своя выгрузка.
 */

export interface Slice {
  readonly key: string;
  readonly label: string;
  readonly note: string;
  readonly table: TableView;
  readonly csvHref: string;
}

export function Slices({ slices }: { readonly slices: readonly Slice[] }) {
  const [current, setCurrent] = useState(slices[0]?.key ?? '');
  const slice = slices.find((one) => one.key === current) ?? slices[0];
  if (!slice) return undefined;

  return (
    <section className="card">
      <div className="card__head">
        <div>
          <h2 className="card__title">Разрезы</h2>
          <p className="card__note">{slice.note}</p>
        </div>
        <div className="card__tools">
          <div className="seg" role="group" aria-label="Какой разрез показать">
            {slices.map((one) => (
              <button
                key={one.key}
                type="button"
                className={one.key === slice.key ? 'seg__item seg__item--on' : 'seg__item'}
                onClick={() => setCurrent(one.key)}
                aria-pressed={one.key === slice.key}
              >
                {one.label}
              </button>
            ))}
          </div>
          <a className="btn btn--ghost btn--tiny" href={slice.csvHref}>
            CSV
          </a>
        </div>
      </div>
      <DataTable table={slice.table} />
    </section>
  );
}
