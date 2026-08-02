'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  CurrencyPairView,
  ExchangeRequestView,
  PreliminaryQuoteView,
  RequisitesView,
} from '@nemo/core';
import type { ExchangeKind, ExchangeRequestStatus } from '@nemo/types';
import { ApiError, get, post } from '@/lib/client-api';
import {
  KIND_LABELS,
  REQUEST_STEPS,
  STEP_LABELS,
  STEP_NOTES,
  type RequestStep,
} from '@/lib/exchange-request-labels';
import {
  formatAmount,
  formatDate,
  formatMoney,
  formatRate,
  normalizeTyped,
  parseAmount,
  shortId,
} from '@/lib/format';
import type { BonusIntent } from './client-app';
import { RatesPanel } from './rates-panel';
import { RequisitesForm } from './requisites-section';
import {
  CardIcon,
  ChevronDown,
  ChevronRight,
  ExchangeIcon,
  InviteIcon,
  SwapIcon,
  WithdrawIcon,
} from './ui/icons';
import { NoticeSheet, Sheet } from './ui/sheet';

/**
 * Экран обмена: что отдаю, что получаю, сколько.
 *
 * По электронному переводу показывается предварительный курс — с явной
 * пометкой, что он справочный. У наличных курса нет вовсе: там
 * финальный курс называет менеджер, и обещать его в приложении означало
 * бы обещать то, чем сервис не управляет.
 */

/** Пауза перед запросом курса: иначе он уходит на каждое нажатие клавиши. */
const QUOTE_DEBOUNCE_MS = 400;

const SUBMITTED = {
  title: 'Заявка принята',
  body: 'Менеджер возьмёт её в ближайшие минуты. Бот напишет на каждом шаге — приложение можно закрыть.',
};

/** Выбор валюты и ввод реквизитов уводятся в лист: на экране им места нет. */
type SheetState =
  | { readonly kind: 'from' }
  | { readonly kind: 'to' }
  | { readonly kind: 'requisites' }
  | { readonly kind: 'notice'; readonly title: string; readonly body: string };

export function ExchangeScreen({ onBonus }: { readonly onBonus: (intent: BonusIntent) => void }) {
  const [pairs, setPairs] = useState<CurrencyPairView[]>([]);
  const [requests, setRequests] = useState<ExchangeRequestView[]>([]);
  const [requisites, setRequisites] = useState<RequisitesView | null>(null);
  const [fromCode, setFromCode] = useState('');
  const [toCode, setToCode] = useState('');
  const [kind, setKind] = useState<ExchangeKind>('electronic');
  const [amount, setAmount] = useState('');
  const [quote, setQuote] = useState<PreliminaryQuoteView | null>(null);
  const [sheet, setSheet] = useState<SheetState>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  /** Счётчик разворотов: им же заводятся анимации обеих строк и поворот кнопки. */
  const [swaps, setSwaps] = useState(0);
  const amountField = useRef<HTMLInputElement>(null);

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
        setLoading(false);
      }
    })();
  }, []);

  const fromCodes = useMemo(() => [...new Set(pairs.map((pair) => pair.fromCode))], [pairs]);
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
    // У наличных курса нет: там финальный курс называет менеджер, и
    // спрашивать провайдера незачем.
    if (kind !== 'electronic' || !fromCode || !toCode) {
      setQuote(null);
      return;
    }

    const params = new URLSearchParams({ fromCode, toCode });
    const parsed = parseAmount(amount);
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

  /** Развернуть направление можно, только если обратное вообще меняют. */
  const canSwap = pairs.some((pair) => pair.fromCode === toCode && pair.toCode === fromCode);

  function swap() {
    if (!canSwap) return;
    setFromCode(toCode);
    setToCode(fromCode);
    setSwaps(swaps + 1);
  }

  async function submit() {
    setError(undefined);
    setBusy(true);
    try {
      const created = await post<{ request: ExchangeRequestView }>('/api/exchange-requests', {
        kind,
        fromCode,
        toCode,
        fromAmount: parseAmount(amount),
        // Наличные клиент получает на руки: реквизиты для перевода при
        // этом способе не нужны и не запрашиваются.
        ...(kind === 'electronic' && requisites ? { requisitesId: requisites.id } : {}),
      });
      setRequests((current) => [created.request, ...current]);
      setAmount('');
      setSheet({ kind: 'notice', ...SUBMITTED });
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
        current.map((request) => (request.id === requestId ? cancelled.request : request)),
      );
    } catch (failure) {
      setError(
        failure instanceof ApiError ? failure.message : 'Не удалось отменить заявку на обмен',
      );
    } finally {
      setBusy(false);
    }
  }

  // Заявок в работе может быть несколько; карточкой показывается свежая,
  // остальные остаются в истории. Две карточки подряд спорили бы за то,
  // какая из них «та самая».
  const active = requests.find((request) => isOpen(request));
  const history = requests.filter((request) => request !== active);

  /** Что клиент может сделать с заявкой прямо сейчас — и ничего сверх того. */
  const actions: { readonly label: string; readonly run: () => void }[] = [];
  if (active) {
    // Реквизиты для оплаты живут в самой заявке, а не только в сообщении
    // бота: клиент возвращается сюда через день и не должен искать их в
    // переписке.
    const instructions = active.paymentInstructions;
    if (instructions) {
      actions.push({
        label: 'Реквизиты для оплаты',
        run: () => setSheet({ kind: 'notice', title: 'Реквизиты для оплаты', body: instructions }),
      });
    }
    // Отменить можно, только пока заявку не взяли: дальше в работе
    // участвует менеджер, и бросить её на полпути клиент уже не может.
    if (active.status === 'new') {
      const id = active.id;
      actions.push({ label: 'Отменить', run: () => void cancel(id) });
    }
  }

  const electronic = kind === 'electronic';
  const ready =
    !busy &&
    Boolean(fromCode) &&
    Boolean(toCode) &&
    Boolean(amount.trim()) &&
    // Электронный перевод без реквизитов отправлять некуда, а наличные
    // клиент получает на руки — там их и не спрашивают.
    (!electronic || requisites !== null);

  const requisitesLine = requisites ? describe(requisites) : 'Укажите, куда отправить деньги';

  if (loading) {
    return <p className="empty">Загружаем направления обмена…</p>;
  }

  return (
    <>
      {pairs.length > 0 ? (
        <RatesPanel fromCode={fromCode} toCode={toCode} quote={quote} pairs={pairs} />
      ) : undefined}

      <div className="quick-row">
        {/* Без направлений обменивать нечего, и кнопка вела бы к полю,
            которого на экране нет. */}
        {pairs.length > 0 ? (
          <button
            type="button"
            onClick={() => {
              amountField.current?.focus();
              amountField.current?.select();
            }}
            className="quick"
          >
            <span className="quick__circle">
              <ExchangeIcon />
            </span>
            <span className="quick__label">Обменять</span>
          </button>
        ) : undefined}
        <button type="button" onClick={() => onBonus('withdraw')} className="quick">
          <span className="quick__circle">
            <WithdrawIcon />
          </span>
          <span className="quick__label">Вывести</span>
        </button>
        <button type="button" onClick={() => onBonus('invite')} className="quick">
          <span className="quick__circle">
            <InviteIcon />
          </span>
          <span className="quick__label">Пригласить</span>
        </button>
      </div>

      {pairs.length === 0 ? (
        <p className="empty">
          Направления обмена ещё не заведены. Загляните позже или напишите менеджеру.
        </p>
      ) : (
        <>
          <div className="calc">
            <div className="calc__give">
              <div className="eyebrow">Отдаю</div>
              <div key={`give-${swaps}`} className={swaps ? 'calc__line calc__line--give' : 'calc__line'}>
                <input
                  ref={amountField}
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  // Разряды расставляются, когда человек закончил
                  // набирать: делать это на каждый символ значит гонять
                  // курсор по строке под пальцем.
                  onBlur={() => setAmount(normalizeTyped(amount))}
                  inputMode="decimal"
                  placeholder="0"
                  aria-label="Сумма к обмену"
                  className="calc__amount"
                />
                <button
                  type="button"
                  onClick={() => setSheet({ kind: 'from' })}
                  disabled={fromCodes.length < 2}
                  className="chip"
                  aria-label={
                    fromCodes.length > 1 ? `Отдаю ${fromCode}. Выбрать другую валюту` : `Отдаю ${fromCode}`
                  }
                >
                  {fromCode}
                  {fromCodes.length > 1 ? <ChevronDown /> : undefined}
                </button>
              </div>
            </div>

            <div className="calc__divider">
              <button
                type="button"
                onClick={swap}
                disabled={!canSwap}
                className="swap"
                aria-label={canSwap ? 'Поменять направление' : 'Обратное направление не меняется'}
              >
                <span className="swap__icon" style={{ transform: `rotate(${swaps * 180}deg)` }}>
                  <SwapIcon />
                </span>
              </button>
              <span className="calc__rule" />
            </div>

            <div className="calc__get">
              <div className="eyebrow">Получаю</div>
              <div key={`get-${swaps}`} className={swaps ? 'calc__line calc__line--get' : 'calc__line'}>
                <div
                  className={quote?.toAmount ? 'calc__amount' : 'calc__amount calc__amount--empty'}
                >
                  {quote?.toAmount ? formatAmount(quote.toAmount) : '0'}
                </div>
                <button
                  type="button"
                  onClick={() => setSheet({ kind: 'to' })}
                  disabled={toCodes.length < 2}
                  className="chip"
                  aria-label={
                    toCodes.length > 1 ? `Получаю ${toCode}. Выбрать другую валюту` : `Получаю ${toCode}`
                  }
                >
                  {toCode}
                  {toCodes.length > 1 ? <ChevronDown /> : undefined}
                </button>
              </div>
            </div>
          </div>

          {/*
            Переключатель показывается, только когда выбирать есть из
            чего: у направления может быть заведён один способ, и кнопка
            без альтернативы обещала бы выбор, которого нет.
          */}
          {kinds.length > 1 ? (
            <div className="segment">
              <button
                type="button"
                onClick={() => setKind('electronic')}
                aria-pressed={electronic}
                className="segment__item"
              >
                {KIND_LABELS.electronic}
              </button>
              <button
                type="button"
                onClick={() => setKind('cash')}
                aria-pressed={!electronic}
                className="segment__item"
              >
                {KIND_LABELS.cash}
              </button>
            </div>
          ) : undefined}

          {electronic ? (
            <button
              type="button"
              onClick={() => setSheet({ kind: 'requisites' })}
              className="tile exchange__requisites"
            >
              <span className="tile__icon">
                <CardIcon />
              </span>
              <span className="tile__body">
                <span className="tile__label">Деньги придут на</span>
                <span className="tile__value">{requisitesLine}</span>
              </span>
              <ChevronRight />
            </button>
          ) : undefined}

          <button
            type="button"
            onClick={() => void submit()}
            disabled={!ready}
            className="btn btn--gold exchange__submit"
          >
            {electronic ? 'Обменять' : 'Заказать наличные'}
          </button>

          <p className="hint">
            {electronic
              ? quote
                ? 'Курс предварительный — финальный подтвердит менеджер.'
                : 'Курс сейчас недоступен — его назовёт менеджер после подачи заявки.'
              : 'Курс по наличным называет менеджер.'}
            {electronic && !requisites
              ? ' Чтобы подать заявку, укажите реквизиты: без них деньги некуда отправить.'
              : ''}
          </p>
        </>
      )}

      {error ? <p className="error">{error}</p> : undefined}

      {active ? (
        <div className="card panel">
          <div className="active__head">
            <span className="active__state">
              <span className="active__dot" />
              {STEP_LABELS[stepOf(active.status)]}
            </span>
            <span className="active__id">{shortId(active.id)}</span>
          </div>

          <div className="active__sum">
            {formatMoney(active.fromAmount, active.fromCode)} →{' '}
            {active.toAmount ? formatMoney(active.toAmount, active.toCode) : active.toCode}
          </div>

          <div className="progress">
            {REQUEST_STEPS.map((step, index) => (
              <span
                key={step}
                className={
                  index <= REQUEST_STEPS.indexOf(stepOf(active.status))
                    ? 'progress__bar progress__bar--done'
                    : 'progress__bar'
                }
              />
            ))}
          </div>

          <div className="active__step">
            <span className="active__step-title">{STEP_NOTES[stepOf(active.status)]}</span>
            <span className="active__step-count">
              {REQUEST_STEPS.indexOf(stepOf(active.status)) + 1} из {REQUEST_STEPS.length}
            </span>
          </div>

          {active.finalRate ? (
            <p className="active__note">
              {formatRate(active.finalRate, active.fromCode, active.toCode)}
            </p>
          ) : undefined}

          {actions.length > 0 ? (
            <div className="active__actions">
              {actions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  onClick={action.run}
                  disabled={busy}
                  className="btn btn--soft"
                >
                  {action.label}
                </button>
              ))}
            </div>
          ) : undefined}
        </div>
      ) : undefined}

      <div className="section-title">История</div>
      {history.length === 0 ? (
        <p className="empty">Заявок на обмен пока нет.</p>
      ) : (
        <ul className="rows">
          {history.map((request) => (
            <li key={request.id} className="row">
              <span className="row__body">
                <span
                  className={
                    request.status === 'cancelled' ? 'row__title row__title--dim' : 'row__title'
                  }
                >
                  {formatMoney(request.fromAmount, request.fromCode)} →{' '}
                  {request.toAmount ? formatMoney(request.toAmount, request.toCode) : request.toCode}
                </span>
                <span className="row__sub">
                  {KIND_LABELS[request.kind]} · {formatDate(request.createdAt)}
                  {request.cancelReason ? ` · ${request.cancelReason}` : ''}
                </span>
              </span>
              <span className="row__state">{outcomeOf(request.status)}</span>
            </li>
          ))}
        </ul>
      )}

      {sheet?.kind === 'from' ? (
        <CodeSheet
          title="Что отдаёте"
          codes={fromCodes}
          selected={fromCode}
          onPick={(code) => {
            setFromCode(code);
            setSheet(undefined);
          }}
          onClose={() => setSheet(undefined)}
        />
      ) : undefined}

      {sheet?.kind === 'to' ? (
        <CodeSheet
          title="Что хотите получить"
          codes={toCodes}
          selected={toCode}
          onPick={(code) => {
            setToCode(code);
            setSheet(undefined);
          }}
          onClose={() => setSheet(undefined)}
        />
      ) : undefined}

      {sheet?.kind === 'requisites' ? (
        <Sheet title="Куда отправить деньги" onClose={() => setSheet(undefined)}>
          <RequisitesForm
            current={requisites}
            onSaved={(saved) => {
              setRequisites(saved);
              setSheet(undefined);
            }}
          />
        </Sheet>
      ) : undefined}

      {sheet?.kind === 'notice' ? (
        <NoticeSheet title={sheet.title} body={sheet.body} onClose={() => setSheet(undefined)} />
      ) : undefined}
    </>
  );
}

/** Список валют одного направления. */
function CodeSheet({
  title,
  codes,
  selected,
  onPick,
  onClose,
}: {
  readonly title: string;
  readonly codes: readonly string[];
  readonly selected: string;
  readonly onPick: (code: string) => void;
  readonly onClose: () => void;
}) {
  return (
    <Sheet title={title} onClose={onClose}>
      <div className="options">
        {codes.map((code) => (
          <button
            key={code}
            type="button"
            onClick={() => onPick(code)}
            aria-pressed={code === selected}
            className="option"
          >
            {code}
            {code === selected ? <span className="option__note">выбрано</span> : undefined}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

/**
 * Реквизиты одной строкой. От карты клиенту видны четыре цифры, и по
 * ним он свою карту узнаёт; полный номер расшифровывает только
 * админ-панель (docs/adr/0002).
 */
function describe(requisites: RequisitesView): string {
  const card = requisites.cardLast4 ? `карта •••• ${requisites.cardLast4}` : requisites.phone;
  return [requisites.bankName, card].filter(Boolean).join(' · ') || 'Реквизиты сохранены';
}

/** Заявка ещё в пути: показывается карточкой, а не строкой истории. */
function isOpen(request: ExchangeRequestView): boolean {
  return request.status !== 'completed' && request.status !== 'cancelled';
}

/**
 * Шаг на полосе прогресса. Отмены на ней нет — это не шаг вперёд, а
 * выход, и карточкой отменённая заявка уже не показывается.
 */
function stepOf(status: ExchangeRequestStatus): RequestStep {
  return status === 'cancelled' ? 'new' : status;
}

/** Состояние строки в истории: там отмена — такой же исход, как исполнение. */
function outcomeOf(status: ExchangeRequestStatus): string {
  return status === 'cancelled' ? 'Отменена' : STEP_LABELS[stepOf(status)];
}
