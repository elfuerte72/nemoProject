'use client';

import { useEffect, useRef, useState } from 'react';
import { CopyValue, EmptyState, Moment } from '@nemo/ui';
import { CALLS_PAGE, isOk, type CallRow } from '@/lib/call-rows';

/**
 * Таблица вызовов с дочитыванием по курсору «время и номер» — тем же
 * правилом, что список заявок: первая страница с сервера, хвост
 * дописывается сюда без дублей.
 *
 * Строка открывает карточку вызова — как у Love&Pay, но без тел
 * запроса и ответа: в них реквизиты получателей, а открытым текстом
 * клиентский контур их не держит (ADR-0002). Путь в строке — настоящая
 * кнопка, чтобы карточка открывалась и с клавиатуры; щелчок по
 * остальной строке — удобство мыши.
 */
export function CallsTable({
  rows,
  total,
  query,
  narrowed,
}: {
  readonly rows: readonly CallRow[];
  readonly total: number;
  /** Отбор в виде строки адреса — им же дочитывается хвост. */
  readonly query: string;
  /** Сужен ли список: пустой сужённый — «таких нет», а не «ещё не звали». */
  readonly narrowed: boolean;
}) {
  const [extra, setExtra] = useState<readonly CallRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [opened, setOpened] = useState<CallRow>();

  const seen = new Set(rows.map((row) => row.id));
  const shown = [...rows, ...extra.filter((row) => !seen.has(row.id))];

  useEffect(() => {
    setExtra((current) => current.filter((row) => !rows.some((one) => one.id === row.id)));
  }, [rows]);

  useEffect(() => {
    setExtra([]);
  }, [query]);

  if (shown.length === 0) {
    return (
      <EmptyState
        icon="log"
        title="Вызовов пока нет"
        text={
          narrowed
            ? 'Таких вызовов за тридцать дней не было.'
            : 'Первый же запрос с вашим ключом встанет сюда — и удачный, и отвергнутый.'
        }
      />
    );
  }

  const remaining = Math.max(total - shown.length, 0);

  const more = async () => {
    const last = shown[shown.length - 1];
    if (!last) return;

    setLoading(true);
    setFailed(false);
    try {
      const params = new URLSearchParams(query);
      params.set('after', last.at);
      params.set('afterId', last.id);
      const response = await fetch(`/api/calls?${params.toString()}`);
      if (!response.ok) throw new Error(String(response.status));
      const body = (await response.json()) as { rows: CallRow[] };
      setExtra((current) => {
        const known = new Set([...rows, ...current].map((row) => row.id));
        return [...current, ...body.rows.filter((row) => !known.has(row.id))];
      });
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <ul className="table table--calls">
        <li className="table__head" aria-hidden>
          <span>Когда</span>
          <span>Метод</span>
          <span>Путь и ответ</span>
          <span>Код</span>
          <span>Время</span>
          <span>Ключ</span>
          <span>Адрес клиента</span>
        </li>
        {shown.map((call) => (
          <li key={call.id} className={isOk(call.status) ? 'table__item' : 'table__item call--failed'}>
            <div className="table__row call__row" onClick={() => setOpened(call)}>
              <span className="cell">
                <span className="cell__label">Когда</span>
                <span className="cell__value">
                  <Moment at={call.at} />
                </span>
              </span>
              <span className="cell">
                <span className="cell__label">Метод</span>
                <span className="cell__value mono">{call.method}</span>
              </span>
              <span className="cell">
                <span className="cell__label">Путь и ответ</span>
                <span className="cell__value">
                  <button
                    type="button"
                    className="call__open mono"
                    onClick={(event) => {
                      event.stopPropagation();
                      setOpened(call);
                    }}
                  >
                    {call.path}
                  </button>
                  {call.error ? (
                    <span className="call__error">
                      {call.errorCode ? <span className="mono">[{call.errorCode}] </span> : undefined}
                      {call.error}
                    </span>
                  ) : undefined}
                </span>
              </span>
              <span className="cell">
                <span className="cell__label">Код</span>
                <span className={isOk(call.status) ? 'pill pill--done' : 'pill pill--wait'}>
                  {call.status}
                </span>
              </span>
              <span className="cell cell--num">
                <span className="cell__label">Время</span>
                <span className="cell__value">{call.durationMs} мс</span>
              </span>
              <span className="cell">
                <span className="cell__label">Ключ</span>
                <span className="cell__value">
                  {call.keyLabel} <span className="muted mono">{call.keyHint}</span>
                </span>
              </span>
              <span className="cell">
                <span className="cell__label">Адрес клиента</span>
                <span className="cell__value mono call__address">
                  {call.address ?? <span className="muted">—</span>}
                </span>
              </span>
            </div>
          </li>
        ))}
      </ul>

      {remaining > 0 || failed ? (
        <div className="table__foot">
          <span>
            Показаны {shown.length} из {total}
            {failed ? ' · дочитать не удалось, попробуйте ещё раз' : ''}
          </span>
          <div className="table__foot-actions">
            <button
              type="button"
              className="btn btn--ghost btn--tiny"
              onClick={() => void more()}
              aria-busy={loading}
            >
              {loading ? 'Дочитываю…' : `Показать ещё ${Math.min(remaining, CALLS_PAGE)}`}
            </button>
          </div>
        </div>
      ) : undefined}

      <CallCard call={opened} onClose={() => setOpened(undefined)} />
    </>
  );
}

/**
 * Карточка вызова — нативным `<dialog>`: фокус внутри, Esc и возврат
 * фокуса на строку браузер делает сам, и делает правильно.
 */
function CallCard({ call, onClose }: { readonly call: CallRow | undefined; readonly onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (call && !node.open) node.showModal();
    if (!call && node.open) node.close();
  }, [call]);

  return (
    <dialog
      ref={dialog}
      className="call-card"
      aria-labelledby="call-card-title"
      onClose={onClose}
      // Щелчок по затемнению вокруг карточки закрывает её: мимо карточки
      // попадает только сам `<dialog>`, его содержимое — нет.
      onClick={(event) => {
        if (event.target === event.currentTarget) event.currentTarget.close();
      }}
    >
      {call ? (
        <div className="call-card__body">
          <h2 className="call-card__title mono" id="call-card-title">
            {call.method} {call.path}
          </h2>

          <dl className="kv">
            <Pair name="Ответ">
              <span className={isOk(call.status) ? 'pill pill--done' : 'pill pill--wait'}>
                {call.status}
              </span>
              {call.errorCode ? <span className="mono"> {call.errorCode}</span> : undefined}
            </Pair>
            <Pair name="Время ответа">{call.durationMs} мс</Pair>
            <Pair name="Когда">
              <Moment at={call.at} />
            </Pair>
            <Pair name="Адрес клиента">{call.address ?? '—'}</Pair>
            <Pair name="Ключ">
              {call.keyLabel} <span className="muted">{call.keyHint}</span>
            </Pair>
          </dl>

          {call.error ? <p className="call-card__error">{call.error}</p> : undefined}

          <div className="call-card__block">
            <h3 className="call-card__label">Идентификатор запроса</h3>
            {call.requestId ? (
              <CopyValue value={call.requestId} />
            ) : (
              <p className="muted">Вызов до 24 сентября 2026 — идентификатор тогда не выдавали.</p>
            )}
          </div>

          <p className="card__note">
            Тела запроса и ответа журнал не хранит: в них реквизиты получателей. Что ушло в
            ответе, ваш сервер видел сам — сверяйтесь по идентификатору запроса.
          </p>

          <div className="call-card__actions">
            <button type="button" className="btn btn--soft" onClick={() => dialog.current?.close()}>
              Закрыть
            </button>
          </div>
        </div>
      ) : undefined}
    </dialog>
  );
}

function Pair({ name, children }: { readonly name: string; readonly children: React.ReactNode }) {
  return (
    <div className="kv__row">
      <dt className="kv__name">{name}</dt>
      <dd className="kv__value">{children}</dd>
    </div>
  );
}
