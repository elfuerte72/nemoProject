'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import {
  COLUMN_LABELS,
  DEFAULT_PREFS,
  TABLE_PREFS_COOKIE,
  optionalColumns,
  pageSizes,
  serializeTablePrefs,
  toggleHidden,
  type TablePrefs,
} from '@/lib/table-prefs';

/**
 * «Поля»: что показывать в таблице стола.
 *
 * Настройка личная и пишется в куку с идентификатором сотрудника —
 * коллег на том же ноутбуке она не касается. После «Готово» страница
 * перечитывается: предел выборки живёт на сервере, и число строк на
 * странице должно доехать до него.
 */
export function TablePrefsSheet({ prefs, staffId }: { prefs: TablePrefs; staffId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<TablePrefs>(prefs);

  const start = () => {
    setDraft(prefs);
    setOpen(true);
  };

  const done = () => {
    const year = 60 * 60 * 24 * 365;
    document.cookie = `${TABLE_PREFS_COOKIE}=${serializeTablePrefs(draft, staffId)}; path=/; max-age=${year}; samesite=lax`;
    setOpen(false);
    router.refresh();
  };

  return (
    <>
      <button type="button" className="btn btn--ghost btn--tiny" onClick={start}>
        Поля
      </button>
      {open
        ? createPortal(
            <div className="sheet" role="presentation" onMouseDown={() => setOpen(false)}>
              <div
                className="sheet__box"
                role="dialog"
                aria-modal
                aria-labelledby="table-prefs-title"
                onMouseDown={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setOpen(false);
                }}
              >
                <div className="sheet__head">
                  <h2 id="table-prefs-title" className="card__title">
                    Что показывать в таблице
                  </h2>
                  <p className="card__note">
                    Настройка личная: хранится в этом браузере и коллег не касается.
                  </p>
                </div>

                <fieldset className="sheet__group">
                  <legend className="label">Колонки</legend>
                  <div className="sheet__checks">
                    {optionalColumns.map((column) => (
                      <label key={column} className="check">
                        <input
                          type="checkbox"
                          checked={!draft.hidden.includes(column)}
                          onChange={() => setDraft(toggleHidden(draft, column))}
                        />
                        {COLUMN_LABELS[column]}
                      </label>
                    ))}
                  </div>
                  <p className="card__note">Обмен и состояние выключить нельзя.</p>
                </fieldset>

                <fieldset className="sheet__group">
                  <legend className="label">Вид</legend>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={draft.dense}
                      onChange={(event) => setDraft({ ...draft, dense: event.target.checked })}
                    />
                    Плотная таблица — больше строк на экране
                  </label>
                  <label className="field field--narrow">
                    <span className="label">Строк на странице</span>
                    <select
                      className="input"
                      value={draft.pageSize}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          pageSize: Number(event.target.value) as TablePrefs['pageSize'],
                        })
                      }
                    >
                      {pageSizes.map((size) => (
                        <option key={size} value={size}>
                          {size} строк
                        </option>
                      ))}
                    </select>
                  </label>
                </fieldset>

                <div className="sheet__actions">
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => setDraft(DEFAULT_PREFS)}
                  >
                    Вернуть по умолчанию
                  </button>
                  <button type="button" className="btn btn--gold" onClick={done}>
                    Готово
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : undefined}
    </>
  );
}
