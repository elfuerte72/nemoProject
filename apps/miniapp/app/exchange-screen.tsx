'use client';

import { useEffect, useMemo, useState } from 'react';
import type {
  CurrencyPairView,
  ExchangeRequestView,
  PreliminaryQuoteView,
  RequisitesView,
} from '@nemo/core';
import type { ExchangeKind } from '@nemo/types';
import { ApiError, get, post } from '@/lib/client-api';
import { KIND_LABELS, STATUS_LABELS } from '@/lib/exchange-request-labels';
import { RequisitesSection } from './requisites-section';

/**
 * Экран обмена: что отдаю, что получаю, сколько.
 *
 * По электронному переводу показывается предварительный курс — с явной
 * пометкой, что он справочный. У наличных курса нет вовсе: там ставку
 * называет менеджер, и обещать её в приложении означало бы обещать то,
 * чем сервис не управляет.
 */

/** Пауза перед запросом курса: иначе он уходит на каждое нажатие клавиши. */
const QUOTE_DEBOUNCE_MS = 400;

export function ExchangeScreen() {
  const [pairs, setPairs] = useState<CurrencyPairView[]>([]);
  const [requests, setRequests] = useState<ExchangeRequestView[]>([]);
  const [requisites, setRequisites] = useState<RequisitesView | null>(null);
  const [fromCode, setFromCode] = useState('');
  const [toCode, setToCode] = useState('');
  const [kind, setKind] = useState<ExchangeKind>('electronic');
  const [amount, setAmount] = useState('');
  const [quote, setQuote] = useState<PreliminaryQuoteView | null>(null);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const [directions, mine, saved] = await Promise.all([
          get<{ pairs: CurrencyPairView[] }>('/api/currency-pairs'),
          get<{ requests: ExchangeRequestView[] }>('/api/exchange-requests'),
          get<{ requisites: RequisitesView | null }>('/api/requisites'),
        ]);
        setPairs(directions.pairs);
        setRequests(mine.requests);
        setRequisites(saved.requisites);
        setFromCode(directions.pairs[0]?.fromCode ?? '');
      } catch (failure) {
        setError(failure instanceof ApiError ? failure.message : 'Не удалось загрузить данные');
      } finally {
        setBusy(false);
      }
    })();
  }, []);

  const fromCodes = useMemo(
    () => [...new Set(pairs.map((pair) => pair.fromCode))],
    [pairs],
  );
  const toCodes = useMemo(
    () => [...new Set(pairs.filter((pair) => pair.fromCode === fromCode).map((p) => p.toCode))],
    [pairs, fromCode],
  );
  const kinds = useMemo(
    () =>
      pairs
        .filter((pair) => pair.fromCode === fromCode && pair.toCode === toCode)
        .map((pair) => pair.kind),
    [pairs, fromCode, toCode],
  );

  useEffect(() => {
    if (toCodes.length > 0 && !toCodes.includes(toCode)) setToCode(toCodes[0]!);
  }, [toCodes, toCode]);

  useEffect(() => {
    if (kinds.length > 0 && !kinds.includes(kind)) setKind(kinds[0]!);
  }, [kinds, kind]);

  useEffect(() => {
    // У наличных курса нет: там ставку называет менеджер, и спрашивать
    // провайдера незачем.
    if (kind !== 'electronic' || !fromCode || !toCode) {
      setQuote(null);
      return;
    }

    const params = new URLSearchParams({ fromCode, toCode });
    const parsed = amount.replace(',', '.').trim();
    if (parsed) params.set('fromAmount', parsed);

    let cancelled = false;
    const timer = setTimeout(() => {
      void get<{ quote: PreliminaryQuoteView | null }>(`/api/quote?${params.toString()}`)
        .then((result) => {
          if (!cancelled) setQuote(result.quote);
        })
        // Отсутствие курса — не ошибка экрана: заявку можно подать и
        // без него, а сказать клиенту нужно то же самое, что при
        // наличных.
        .catch(() => {
          if (!cancelled) setQuote(null);
        });
    }, QUOTE_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [kind, fromCode, toCode, amount]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);
    setNotice(undefined);
    setBusy(true);
    try {
      const created = await post<{ request: ExchangeRequestView }>('/api/exchange-requests', {
        kind,
        fromCode,
        toCode,
        fromAmount: amount.replace(',', '.').trim(),
        // Наличные клиент получает на руки: реквизиты для перевода при
        // этом способе не нужны и не запрашиваются.
        ...(kind === 'electronic' && requisites ? { requisitesId: requisites.id } : {}),
      });
      setRequests((current) => [created.request, ...current]);
      setAmount('');
      setNotice('Заявка на обмен принята. Её возьмёт менеджер — бот сообщит о каждом шаге.');
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Не удалось подать заявку на обмен');
    } finally {
      setBusy(false);
    }
  }

  async function cancel(requestId: string) {
    setError(undefined);
    setBusy(true);
    try {
      const cancelled = await post<{ request: ExchangeRequestView }>(
        `/api/exchange-requests/${requestId}/cancel`,
      );
      setRequests((current) =>
        current.map((request) =>
          request.id === requestId ? cancelled.request : request,
        ),
      );
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Не удалось отменить заявку на обмен');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 style={styles.heading}>Обмен валют</h1>

      {pairs.length === 0 && !busy ? (
        <p style={styles.muted}>
          Направления обмена ещё не заведены. Загляните позже или напишите менеджеру.
        </p>
      ) : (
        <form onSubmit={submit} style={styles.form}>
          <label style={styles.field}>
            <span style={styles.label}>Отдаю</span>
            <div style={styles.row}>
              <select
                value={fromCode}
                onChange={(event) => setFromCode(event.target.value)}
                style={styles.select}
              >
                {fromCodes.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
              <input
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="decimal"
                placeholder="Сумма"
                style={styles.input}
              />
            </div>
          </label>

          <label style={styles.field}>
            <span style={styles.label}>Получаю</span>
            <select
              value={toCode}
              onChange={(event) => setToCode(event.target.value)}
              style={styles.select}
            >
              {toCodes.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </label>

          <fieldset style={styles.fieldset}>
            <legend style={styles.label}>Как получить</legend>
            {kinds.map((available) => (
              <label key={available} style={styles.radio}>
                <input
                  type="radio"
                  name="kind"
                  value={available}
                  checked={kind === available}
                  onChange={() => setKind(available)}
                />
                {KIND_LABELS[available]}
              </label>
            ))}
          </fieldset>

          {kind === 'electronic' ? (
            <RequisitesSection current={requisites} onSaved={setRequisites} />
          ) : undefined}

          {/*
            Предварительный курс — справочный, и пометка об этом стоит
            рядом с самим числом, а не внизу экрана: клиент читает
            цифру, а не абзац под ней.
          */}
          {quote ? (
            <div style={styles.quote}>
              <div>
                Предварительно: 1 {fromCode} ≈ {quote.rate} {toCode}
              </div>
              {quote.toAmount ? (
                <div style={styles.quoteAmount}>
                  Вы получите ≈ {quote.toAmount} {toCode}
                </div>
              ) : undefined}
              <div style={styles.muted}>
                Курс предварительный: финальный подтвердит менеджер после подачи заявки.
              </div>
            </div>
          ) : (
            <p style={styles.muted}>
              {kind === 'cash'
                ? 'По наличным ставку называет менеджер после подачи заявки.'
                : 'Курс сейчас недоступен — его назовёт менеджер после подачи заявки.'}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || !fromCode || !toCode || (kind === 'electronic' && !requisites)}
            style={styles.button}
          >
            Подать заявку на обмен
          </button>
          {kind === 'electronic' && !requisites ? (
            <p style={styles.muted}>
              Чтобы подать заявку, сохраните реквизиты: без них деньги некуда отправить.
            </p>
          ) : undefined}
        </form>
      )}

      {error ? <p style={styles.error}>{error}</p> : undefined}
      {notice ? <p style={styles.notice}>{notice}</p> : undefined}

      <section style={styles.section}>
        <h2 style={styles.subheading}>Мои заявки на обмен</h2>
        {requests.length === 0 ? (
          <p style={styles.muted}>Заявок на обмен пока нет.</p>
        ) : (
          <ul style={styles.list}>
            {requests.map((request) => (
              <li key={request.id} style={styles.item}>
                <div>
                  {request.fromAmount} {request.fromCode} → {request.toCode}
                </div>
                <div style={styles.muted}>
                  {STATUS_LABELS[request.status]}
                  {request.cancelReason ? ` — ${request.cancelReason}` : ''}
                </div>
                {request.finalRate ? (
                  <div style={styles.muted}>Финальный курс {request.finalRate}</div>
                ) : undefined}
                {/*
                  Реквизиты для оплаты живут в самой заявке, а не только
                  в сообщении бота: клиент возвращается сюда через день и
                  не должен искать их в переписке.
                */}
                {request.paymentInstructions ? (
                  <div style={styles.muted}>
                    Реквизиты для оплаты: {request.paymentInstructions}
                  </div>
                ) : undefined}
                {/*
                  Отменить можно, только пока заявку не взяли: дальше в
                  работе участвует менеджер, и бросить её на полпути
                  клиент уже не может.
                */}
                {request.status === 'new' ? (
                  <button
                    type="button"
                    onClick={() => cancel(request.id)}
                    disabled={busy}
                    style={styles.cancel}
                  >
                    Отменить
                  </button>
                ) : undefined}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

const styles = {
  heading: { fontSize: '1.25rem', marginBottom: '1rem' },
  quote: {
    border: '1px solid rgba(128,128,128,0.35)',
    padding: '0.7rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.3rem',
    fontSize: '0.95rem',
  },
  quoteAmount: { fontWeight: 600 },
  subheading: { fontSize: '1rem', marginBottom: '0.5rem' },
  form: { display: 'flex', flexDirection: 'column', gap: '1rem' },
  field: { display: 'flex', flexDirection: 'column', gap: '0.35rem' },
  fieldset: { border: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '0.35rem' },
  label: { fontSize: '0.8rem', opacity: 0.7 },
  row: { display: 'flex', gap: '0.5rem' },
  select: { flex: '0 0 8rem', padding: '0.6rem', fontSize: '1rem' },
  input: { flex: 1, padding: '0.6rem', fontSize: '1rem', minWidth: 0 },
  radio: { display: 'flex', alignItems: 'center', gap: '0.5rem' },
  button: { padding: '0.75rem', fontSize: '1rem', fontWeight: 600 },
  muted: { opacity: 0.7, fontSize: '0.85rem', lineHeight: 1.45 },
  error: { color: '#c0392b', fontSize: '0.9rem' },
  notice: { fontSize: '0.9rem' },
  section: { marginTop: '2rem' },
  list: { listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '0.75rem' },
  item: { borderTop: '1px solid rgba(128,128,128,0.25)', paddingTop: '0.6rem' },
  cancel: {
    background: 'none',
    border: 'none',
    padding: '0.3rem 0 0',
    fontSize: '0.8rem',
    textDecoration: 'underline',
    cursor: 'pointer',
    color: 'inherit',
  },
} satisfies Record<string, React.CSSProperties>;
