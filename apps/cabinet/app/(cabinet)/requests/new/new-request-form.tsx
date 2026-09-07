'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  currencyName,
  describeRequisites,
  payoutMethodOf,
  payoutOf,
  rateLine,
  requisiteKindsFor,
  sortCurrencies,
  type Amount,
  type PayoutMethod,
  type Quote,
  type RequisiteInput,
} from '@nemo/types';
import { Icon } from '@nemo/ui';
import { formatAmount, formatMoney, formatRate } from '@nemo/ui/format';
import {
  describeRecipientInput,
  normalizeTyped,
  obstacleOf,
  sidesOf,
  type Side,
} from '@/lib/new-request';
import type { RecipientRow } from '@/lib/recipient-rows';
import { EMPTY_DRAFT, RecipientFields, type RecipientDraft } from '@/app/ui/recipient-fields';
import { send } from '@/app/ui/send';

/**
 * Новая заявка руками: что отдаю, что получаю, кому.
 *
 * Тот же экран обмена, что у клиента в Mini App, — и те же правила: курс
 * приходит с сервера, суммы считает экран той же арифметикой, что ядро
 * (`@nemo/types`); считается любая из двух сторон; черта курса не
 * пустует и нуля не называет; перед подачей — сводка снимком чисел, и
 * заявка уходит ровно по нему, вместе с отметкой показанного курса
 * (docs/adr/0006).
 *
 * Своё у мерчанта — получатель: сохранённый или названный прямо здесь.
 * Новый по умолчанию в список не попадает — у мерчанта покупателей
 * много, и запись на каждого засоряла бы «Получателей»; отметка
 * «запомнить» сначала сохраняет запись, потом подаёт по ней.
 */

/** Как часто перечитывается курс, пока форма открыта. */
const QUOTE_REFRESH_MS = 30_000;

/** С чего открывается форма, если такое направление заведено. */
const PREFERRED_FROM = 'USDT';
const PREFERRED_TO = 'RUB';

/** Ответ о курсе, как он приезжает по сети: отметка времени — строкой. */
interface QuoteReply extends Quote {
  readonly asOf: string;
}

export interface NewRequestTerms {
  readonly minAmount: Amount;
  readonly minAmountCode: string;
  readonly unpaidTtlMinutes: number;
}

/** Сводка перед подачей — снимок того, что мерчант в ней прочёл. */
interface Summary {
  readonly give: Amount;
  readonly payout: Amount | null;
  readonly quote: QuoteReply | null;
  readonly fromCode: string;
  readonly toCode: string;
  readonly recipientLine: string;
  readonly recipient:
    | { readonly kind: 'saved'; readonly id: string }
    | { readonly kind: 'new'; readonly input: RequisiteInput; readonly remember: boolean };
  readonly reference: string;
  /** Ключ повтора — на этот снимок: второе нажатие вернёт ту же заявку. */
  readonly idempotencyKey: string;
}

function newKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function NewRequestForm({
  pairs,
  terms,
  recipients,
  networks,
  lastUsed,
  canSubmit,
}: {
  /** Безналичные направления: наличные из кабинета не подаются. */
  readonly pairs: readonly { readonly fromCode: string; readonly toCode: string }[];
  readonly terms: NewRequestTerms;
  readonly recipients: readonly RecipientRow[];
  readonly networks: readonly string[];
  /** Какая запись шла в последней заявке в эту валюту: ею и открываемся. */
  readonly lastUsed: Readonly<Record<string, string>>;
  /** Ложь у отключённого: подача отказала бы, и кнопка об этом говорит заранее. */
  readonly canSubmit: boolean;
}) {
  const router = useRouter();

  const fromCodes = useMemo(
    () => sortCurrencies([...new Set(pairs.map((pair) => pair.fromCode))]),
    [pairs],
  );
  const [fromCode, setFromCode] = useState(
    () => (fromCodes.includes(PREFERRED_FROM) ? PREFERRED_FROM : fromCodes[0]) ?? '',
  );
  const toCodes = useMemo(
    () =>
      sortCurrencies([
        ...new Set(pairs.filter((pair) => pair.fromCode === fromCode).map((p) => p.toCode)),
      ]),
    [pairs, fromCode],
  );
  const [toCode, setToCode] = useState(
    () => (toCodes.includes(PREFERRED_TO) ? PREFERRED_TO : toCodes[0]) ?? '',
  );
  useEffect(() => {
    if (toCodes.length > 0 && !toCodes.includes(toCode)) setToCode(toCodes[0]!);
  }, [toCodes, toCode]);

  /**
   * В какое поле вводят. Второе считается по курсу: вопросов у
   * мерчанта два — «сколько дадут за мои сто USDT» и «сколько USDT
   * нужно, чтобы вышло ровно пятьдесят тысяч».
   */
  const [side, setSide] = useState<Side>('give');
  const [typed, setTyped] = useState('');
  const [reference, setReference] = useState('');

  /* Получатель: сохранённый или новый прямо здесь. */
  const suitableKinds = useMemo(() => requisiteKindsFor(toCode), [toCode]);
  const suitable = useMemo(
    () => recipients.filter((one) => suitableKinds.includes(one.kind) && one.isAvailable),
    [recipients, suitableKinds],
  );
  const [mode, setMode] = useState<'saved' | 'new'>('saved');
  const [selectedId, setSelectedId] = useState<string>();
  const [draft, setDraft] = useState<RecipientDraft>(EMPTY_DRAFT);
  const [remember, setRemember] = useState(false);

  useEffect(() => {
    // Открываемся на записи из последней заявки в эту валюту: обычная
    // повторная заявка не должна требовать выбора. Нет сохранённых —
    // сразу форма нового получателя, выбирать не из чего.
    if (suitable.length === 0) {
      setMode('new');
      setSelectedId(undefined);
      return;
    }
    setMode((current) => (current === 'new' && selectedId === undefined ? 'saved' : current));
    setSelectedId((current) =>
      current && suitable.some((one) => one.id === current)
        ? current
        : (suitable.find((one) => one.id === lastUsed[toCode])?.id ?? suitable[0]?.id),
    );
    // Только на смене валюты и списка: выбор мерчанта переопределять нельзя.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suitable, toCode]);

  const chosen = mode === 'saved' ? suitable.find((one) => one.id === selectedId) : undefined;

  /**
   * Каким способом уйдут деньги — банком или кошельком. Ставка у них
   * разная, поэтому от него зависит и показанная цена; решает запись,
   * на которую придут деньги, а не мерчант.
   */
  const payoutMethod: PayoutMethod | undefined =
    mode === 'saved' ? (chosen ? payoutMethodOf(chosen) : undefined) : draft.payoutMethod;

  /* Курс — на направление, не на сумму; перечитывается по кругу. */
  const pairKey = `${fromCode}/${toCode}/${payoutMethod ?? ''}`;
  const [quote, setQuote] = useState<{ pair: string; view: QuoteReply | null }>();
  const rate = quote?.pair === pairKey ? quote.view : undefined;

  useEffect(() => {
    if (!fromCode || !toCode) {
      setQuote({ pair: pairKey, view: null });
      return;
    }
    let cancelled = false;
    const ask = () => {
      if (document.visibilityState !== 'visible') return;
      const params = new URLSearchParams({
        from: fromCode,
        to: toCode,
        ...(payoutMethod ? { payoutMethod } : {}),
      });
      void fetch(`/api/quote?${params.toString()}`)
        .then(async (response) => {
          if (!response.ok) throw new Error(String(response.status));
          return (await response.json()) as { quote: QuoteReply | null };
        })
        .then((reply) => {
          if (!cancelled) setQuote({ pair: pairKey, view: reply.quote });
        })
        .catch(() => {
          // Отсутствие курса — не ошибка формы: заявку можно подать и
          // без него, и сказать надо то же самое, что при молчащем
          // источнике.
          if (!cancelled) setQuote({ pair: pairKey, view: null });
        });
    };
    ask();
    const timer = setInterval(ask, QUOTE_REFRESH_MS);
    document.addEventListener('visibilitychange', ask);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', ask);
    };
  }, [fromCode, toCode, pairKey, payoutMethod]);

  const sides = useMemo(() => sidesOf(typed, side, rate), [typed, side, rate]);
  const payout = rate && sides.give ? payoutOf(sides.give, rate) : null;
  const line = rate ? rateLine(rate, sides.give, terms.minAmount) : { kind: 'none' as const };

  useEffect(() => {
    // Курс ушёл из-под набранного «получаю»: считать обратно нечем, и
    // поле должно сохранить смысл, а не цифру.
    if (side === 'get' && rate === null) {
      setSide('give');
      setTyped(sides.give ? formatAmount(sides.give) : '');
    }
  }, [side, rate, sides.give]);

  function shown(which: Side): string {
    if (side === which) return typed;
    const value = sides[which];
    return value ? formatAmount(value) : '';
  }

  const recipientState =
    suitableKinds.length === 0
      ? ('unsupported' as const)
      : mode === 'saved'
        ? chosen
          ? ('chosen' as const)
          : ('missing' as const)
        : draft.input
          ? ('chosen' as const)
          : ('missing' as const);

  const obstacle = obstacleOf({
    terms,
    fromCode,
    toCode,
    sides,
    quote: rate,
    recipient: recipientState,
  });

  const canSwap = pairs.some((pair) => pair.fromCode === toCode && pair.toCode === fromCode);
  function swap() {
    if (!canSwap) return;
    setFromCode(toCode);
    setToCode(fromCode);
  }
  function pickFrom(code: string) {
    if (code === toCode) {
      swap();
      return;
    }
    setFromCode(code);
  }

  const [summary, setSummary] = useState<Summary>();
  const [busy, setBusy] = useState(false);
  const [complaint, setComplaint] = useState<string>();

  const ready =
    canSubmit &&
    !busy &&
    Boolean(fromCode) &&
    Boolean(toCode) &&
    sides.give !== null &&
    sides.give !== '0' &&
    // Пока ответ о курсе не пришёл, подавать нечего: заявка ушла бы без
    // отметки — по курсу, которого мерчант не видел. Отсутствие курса
    // (`null`) — рабочее состояние, и по нему подаётся.
    rate !== undefined &&
    obstacle === undefined;

  function openSummary() {
    if (!sides.give) return;
    const recipientLine = chosen
      ? describeRequisites(chosen)
      : draft.input
        ? describeRecipientInput(draft.input)
        : '';
    const recipient: Summary['recipient'] | undefined = chosen
      ? { kind: 'saved', id: chosen.id }
      : draft.input
        ? { kind: 'new', input: draft.input, remember }
        : undefined;
    if (!recipient) return;
    setComplaint(undefined);
    // Снимок берётся здесь: дальше он не меняется, что бы ни пришло с
    // сервера, — и по нему же уходит заявка.
    setSummary({
      give: sides.give,
      payout,
      quote: rate ?? null,
      fromCode,
      toCode,
      recipientLine,
      recipient,
      reference: reference.trim(),
      idempotencyKey: newKey(),
    });
  }

  async function submit(snapshot: Summary) {
    setBusy(true);
    setComplaint(undefined);

    let recipient = snapshot.recipient;
    // «Запомнить» — сначала запись, потом заявка по ней: заявка с
    // получателем в теле архивирует запись сразу, и в списке её бы не
    // было.
    if (recipient.kind === 'new' && recipient.remember) {
      const saved = await send('/api/requisites', recipient.input);
      if (!saved.ok) {
        setComplaint(saved.complaint);
        setBusy(false);
        return;
      }
      const { requisites } = saved.data as { requisites: RecipientRow };
      recipient = { kind: 'saved', id: requisites.id };
      // Дальше — по сохранённой: повтор после отказа не заведёт вторую.
      setSummary({ ...snapshot, recipient });
    }

    // Тем же телом, что и API v1: сумма — со стороны отдачи, обратный
    // счёт форма уже сделала той же арифметикой, что и ядро, и в сводке
    // мерчант подтвердил именно эти числа.
    const result = await send('/api/requests', {
      from: snapshot.fromCode,
      to: snapshot.toCode,
      amount: snapshot.give,
      side: 'from',
      ...(snapshot.quote ? { quotedAt: snapshot.quote.asOf } : {}),
      ...(snapshot.reference ? { reference: snapshot.reference } : {}),
      ...(recipient.kind === 'saved'
        ? { requisitesId: recipient.id }
        : { payout: recipient.input }),
      idempotencyKey: snapshot.idempotencyKey,
    });
    if (!result.ok) {
      setComplaint(result.complaint);
      setBusy(false);
      return;
    }
    const { request } = result.data as { request: { id: string } };
    router.push(`/requests/${request.id}`);
  }

  /**
   * Курс в сводке — тот же, что стоял на черте для этой суммы: со
   * ступенчатой сеткой он выводится из посчитанной выдачи, и правило
   * одно (`rateLine`), а не второе деление рядом.
   */
  const summaryLine = summary?.quote
    ? rateLine(summary.quote, summary.give, terms.minAmount)
    : undefined;
  const summaryRate = summaryLine?.kind === 'rate' ? summaryLine.rate : undefined;

  if (pairs.length === 0) {
    return (
      <section className="card">
        <p className="muted">
          Направления обмена ещё не заведены. Загляните позже или напишите в поддержку.
        </p>
      </section>
    );
  }

  return (
    <>
      <section className="card">
        <div className="calc">
          <label className="field calc__side">
            <span className="label">Отдаю</span>
            <span className="calc__amount">
              <input
                className="input calc__input"
                value={shown('give')}
                onChange={(event) => {
                  setSide('give');
                  setTyped(event.target.value);
                }}
                onBlur={() => {
                  if (side === 'give') setTyped(normalizeTyped(typed));
                }}
                inputMode="decimal"
                placeholder="0"
                aria-label="Сумма к обмену"
              />
              <select
                className="input calc__pick"
                value={fromCode}
                onChange={(event) => pickFrom(event.target.value)}
                aria-label="Что отдаёте"
              >
                {fromCodes.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </span>
            <span className="cell__note">{currencyName(fromCode)}</span>
          </label>

          <button
            type="button"
            className="calc__swap"
            onClick={swap}
            disabled={!canSwap}
            aria-label={canSwap ? 'Поменять направление' : 'Обратное направление не меняется'}
            title={canSwap ? 'Поменять направление' : 'Обратное направление не меняется'}
          >
            <Icon name="exchange" size={18} />
          </button>

          <label className="field calc__side">
            <span className="label">Получаю</span>
            <span className="calc__amount">
              {/*
                Тоже поле ввода: сумму получения называют так же часто, как
                отданную, — по счёту, по брони. Пока курса нет, считать
                обратно нечем, и поле только показывает.
              */}
              <input
                className="input calc__input"
                value={shown('get')}
                onChange={(event) => {
                  setSide('get');
                  setTyped(event.target.value);
                }}
                onBlur={() => {
                  if (side === 'get') setTyped(normalizeTyped(typed));
                }}
                readOnly={!rate}
                inputMode="decimal"
                placeholder="0"
                aria-label="Сумма к получению"
              />
              <select
                className="input calc__pick"
                value={toCode}
                onChange={(event) => setToCode(event.target.value)}
                aria-label="Что хотите получить"
              >
                {toCodes.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </span>
            <span className="cell__note">{currencyName(toCode)}</span>
          </label>
        </div>

        {/*
          Курс стоит между отданным и полученным — там, где он и
          действует. Пока ответа нет, строки нет вовсе: мигнувшее
          «недоступен» между сменой валюты и ответом пугало бы на ровном
          месте.
        */}
        <p className="calc__rate" aria-live="polite">
          {line.kind === 'rate'
            ? `Курс ${formatRate(line.rate, fromCode, toCode)}`
            : line.kind === 'from'
              ? `Заявка от ${formatMoney(line.giveAtLeast, fromCode)}`
              : rate === null
                ? 'Курс сейчас недоступен: его назовёт менеджер, когда возьмёт заявку.'
                : ' '}
        </p>

        <p className="muted">
          {rate === undefined
            ? ''
            : rate === null
              ? 'Заявку можно подать и без курса: менеджер назовёт его до того, как вы заплатите. '
              : `Курс фиксируется при подаче и держится ${terms.unpaidTtlMinutes} мин после выдачи реквизитов. `}
          Минимальная сумма обмена — {formatMoney(terms.minAmount, terms.minAmountCode)}.
          {rate?.fee?.minUsd
            ? ` Минимальная сумма направления — ${formatMoney(rate.fee.minUsd, '$')}.`
            : ''}
        </p>
      </section>

      <section className="card">
        <div className="card__head">
          <h2 className="card__title">Получатель</h2>
          {suitable.length > 0 ? (
            <div className="chips" role="group" aria-label="Откуда получатель">
              <button
                type="button"
                className={mode === 'saved' ? 'chip chip--on' : 'chip'}
                aria-pressed={mode === 'saved'}
                onClick={() => setMode('saved')}
              >
                Из сохранённых
              </button>
              <button
                type="button"
                className={mode === 'new' ? 'chip chip--on' : 'chip'}
                aria-pressed={mode === 'new'}
                onClick={() => setMode('new')}
              >
                Новый
              </button>
            </div>
          ) : undefined}
        </div>

        {suitableKinds.length === 0 ? (
          <p className="muted">
            Получение {toCode} переводом пока в разработке: реквизиты для этой валюты сервис
            ещё не принимает.
          </p>
        ) : mode === 'saved' ? (
          <ul className="rows rows--tight">
            {suitable.map((one) => (
              <li key={one.id} className="row">
                <label className="check recipient__pick">
                  <input
                    type="radio"
                    name="recipient"
                    checked={selectedId === one.id}
                    onChange={() => setSelectedId(one.id)}
                  />
                  <span className="row__main">
                    <span className="row__title">{describeRequisites(one)}</span>
                    {one.holderName ? (
                      <span className="row__meta">{one.holderName}</span>
                    ) : undefined}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <>
            <RecipientFields
              key={toCode}
              currency={toCode}
              networks={networks}
              disabled={busy}
              onChange={setDraft}
            />
            <label className="check">
              <input
                type="checkbox"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
              />
              Запомнить в «Получателях»
              <span className="muted"> — для своих реквизитов, не для покупателей</span>
            </label>
          </>
        )}
        {suitable.length > 0 && mode === 'saved' ? (
          <p className="card__note">
            Нужный получатель не здесь — <Link href="/recipients">в разделе «Получатели»</Link>{' '}
            можно завести новую запись.
          </p>
        ) : undefined}
      </section>

      <section className="card">
        <div className="form-row">
          <label className="field">
            <span className="label">Свой номер сделки</span>
            <input
              className="input"
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              maxLength={200}
              placeholder="booking-1024"
              autoComplete="off"
            />
            <span className="cell__note">
              Номер брони, счёта или заказа — виден менеджеру рядом с заявкой. Необязательно.
            </span>
          </label>
        </div>

        {obstacle ? <p className="error">{obstacle}</p> : undefined}

        <div className="row__actions">
          <button
            type="button"
            className="btn btn--gold"
            disabled={!ready}
            onClick={openSummary}
          >
            Проверить и подать
          </button>
          {!canSubmit ? (
            <span className="muted">Доступ отключён: новые заявки не принимаются.</span>
          ) : undefined}
        </div>
      </section>

      {summary
        ? createPortal(
            <div
              className="sheet"
              role="presentation"
              onMouseDown={() => {
                if (!busy) setSummary(undefined);
              }}
            >
              <div
                className="sheet__box"
                role="dialog"
                aria-modal
                aria-labelledby="summary-title"
                onMouseDown={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  if (event.key === 'Escape' && !busy) setSummary(undefined);
                }}
              >
                <div className="sheet__head">
                  <h2 id="summary-title" className="card__title">
                    Проверьте заявку
                  </h2>
                  <p className="card__note">
                    {summary.quote
                      ? 'Курс уже зафиксирован. Менеджер возьмёт заявку и выдаст реквизиты для оплаты.'
                      : 'Менеджер возьмёт заявку, назовёт курс и выдаст реквизиты для оплаты.'}
                  </p>
                </div>

                <dl className="summary">
                  <div className="summary__row">
                    <dt>Отдаю</dt>
                    <dd className="summary__strong">
                      {formatMoney(summary.give, summary.fromCode)}
                    </dd>
                  </div>
                  <div className="summary__row">
                    <dt>Получаю</dt>
                    <dd className="summary__strong">
                      {summary.payout
                        ? formatMoney(summary.payout, summary.toCode)
                        : `${summary.toCode} — назовёт менеджер`}
                    </dd>
                  </div>
                  {summaryRate ? (
                    <div className="summary__row">
                      <dt>Курс</dt>
                      <dd>{formatRate(summaryRate, summary.fromCode, summary.toCode)}</dd>
                    </div>
                  ) : undefined}
                  <div className="summary__row">
                    <dt>Деньги придут на</dt>
                    <dd>{summary.recipientLine}</dd>
                  </div>
                  {summary.reference ? (
                    <div className="summary__row">
                      <dt>Свой номер</dt>
                      <dd>{summary.reference}</dd>
                    </div>
                  ) : undefined}
                </dl>

                {complaint ? <p className="error">{complaint}</p> : undefined}

                <div className="sheet__actions">
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => setSummary(undefined)}
                    disabled={busy}
                  >
                    Изменить
                  </button>
                  <button
                    type="button"
                    className="btn btn--gold"
                    onClick={() => void submit(summary)}
                    aria-busy={busy}
                    disabled={busy}
                  >
                    {busy ? 'Подаём…' : 'Подтвердить'}
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

