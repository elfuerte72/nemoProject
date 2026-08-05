'use client';

import { useEffect, useMemo, useState } from 'react';
import type {
  ExchangeRequestView,
  ExchangeTermsView,
  QuoteView,
  RequisitesView,
} from '@nemo/core';
import {
  Money,
  requisiteKinds,
  requisiteKindSuits,
  type Amount,
  type ExchangeKind,
  type ExchangeRequestStatus,
} from '@nemo/types';
import { ApiError, get, post } from '@/lib/client-api';
import {
  KIND_LABELS,
  REQUEST_STEPS,
  STEP_LABELS,
  STEP_NOTES,
  type RequestStep,
} from '@/lib/exchange-request-labels';
import {
  describeRequisites,
  formatAmount,
  formatDate,
  formatMoney,
  formatRate,
  normalizeTyped,
  parseAmount,
  shortId,
} from '@/lib/format';
import { RequisitesSheet } from './requisites-section';
import { CurrencyPicker } from './ui/currency-picker';
import { sortCurrencies } from './ui/flags';
import { CardIcon, ChevronRight, SwapIcon } from './ui/icons';
import { Loading } from './ui/loading';
import { NoticeSheet, Sheet } from './ui/sheet';

/**
 * Экран обмена: что отдаю, что получаю, сколько.
 *
 * По электронному переводу курс называется сразу и дальше не меняется:
 * по какому курсу клиент нажал — по такому сервис и работает
 * (docs/adr/0006). Обязательство ограничено сроком оплаты, и экран
 * показывает, сколько его осталось.
 *
 * У наличных курса нет вовсе: там его называет менеджер, и обещать его
 * в приложении означало бы обещать то, чем сервис не управляет.
 */

/** С чего открывается экран, если такое направление заведено. */
const PREFERRED_FROM = 'USDT';

/**
 * И чем оно оканчивается. Валют выдачи девять, справочник отдаёт их по
 * алфавиту, и без этой строки экран открывался бы на юане — просто
 * потому, что «CNY» стоит в алфавите раньше «RUB».
 */
const PREFERRED_TO = 'RUB';

/**
 * Как часто перечитывается курс, пока экран открыт. Полминуты: чаще
 * незачем — курс целый и от мелких движений не меняется, а реже значит
 * дольше показывать число, которое сервис уже не назовёт.
 */
const QUOTE_REFRESH_MS = 30_000;

const SUBMITTED = {
  title: 'Заявка принята',
  body: 'Менеджер возьмёт её в ближайшие минуты. Бот напишет на каждом шаге — приложение можно закрыть.',
};

/** Ввод реквизитов и подтверждения уводятся в лист: на экране им места нет. */
type SheetState =
  | { readonly kind: 'requisites' }
  | { readonly kind: 'notice'; readonly title: string; readonly body: string };

/**
 * `onReady` зовётся, когда экран показал бы себя целиком. Оболочка
 * держит на нём заставку: без этого клиент видел бы её уход, а под ним —
 * строку «загружаем» вместо экрана, и приветствие оканчивалось бы тем,
 * от чего оно и прикрывает.
 */
export function ExchangeScreen({
  revisit,
  onReady,
}: {
  readonly revisit: number;
  readonly onReady?: () => void;
}) {
  const [terms, setTerms] = useState<ExchangeTermsView>();
  const [requests, setRequests] = useState<ExchangeRequestView[]>([]);
  const [requisites, setRequisites] = useState<RequisitesView[]>([]);
  /** Куда уйдут деньги по этой заявке. */
  const [selected, setSelected] = useState<string>();
  const [networks, setNetworks] = useState<string[]>([]);
  const [fromCode, setFromCode] = useState('');
  const [toCode, setToCode] = useState('');
  const [kind, setKind] = useState<ExchangeKind>('electronic');
  const [amount, setAmount] = useState('');
  /**
   * Ответ о курсе вместе с направлением, на которое его спрашивали.
   *
   * Направление хранится рядом с курсом, потому что между сменой валюты
   * и ответом сервера проходит вздох, и всё это время у экрана на руках
   * курс от прошлой пары. Пока валют было две, разница между ними была
   * незаметна; с батом на месте рубля клиент успел бы увидеть рублёвую
   * сумму, подписанную батами. Чужой курс к показу не допускается вовсе
   * — ни к сумме, ни к порогу, ни к подаче.
   */
  const [quote, setQuote] = useState<{
    readonly pair: string;
    readonly view: QuoteView | null;
  }>();
  const [sheet, setSheet] = useState<SheetState>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  /** Счётчик разворотов: им же заводятся анимации обеих строк и поворот кнопки. */
  const [swaps, setSwaps] = useState(0);
  /**
   * Отсечка для обратного отсчёта. Экран открыт минутами, а срок оплаты
   * идёт всё это время: посчитанное однажды число устареет молча, и
   * клиент увидит «остаётся 40 мин» тогда, когда их пять.
   */
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    void (async () => {
      try {
        const [conditions, mine, saved] = await Promise.all([
          get<{ terms: ExchangeTermsView }>('/api/exchange-terms'),
          get<{ requests: ExchangeRequestView[] }>('/api/exchange-requests'),
          get<{ requisites: RequisitesView[] }>('/api/requisites'),
        ]);
        setTerms(conditions.terms);
        setRequests(mine.requests);
        setRequisites(saved.requisites);
        // USDT — направление, за которым приходят чаще всего; открывать
        // экран на нём короче, чем перещёлкивать с того, что оказалось
        // первым в справочнике.
        const codes = conditions.terms.pairs.map((pair) => pair.fromCode);
        const from = codes.includes(PREFERRED_FROM) ? PREFERRED_FROM : (codes[0] ?? '');
        // Только пока направление не выбрано. Раздел остаётся в ряду и
        // перечитывает своё при каждом возвращении: поставленное здесь
        // заново стирало бы выбор клиента, отошедшего в соседний раздел
        // с уже набранной суммой.
        setFromCode((current) => current || from);
        // Встречная валюта ставится здесь же, а не отдельным проходом:
        // от неё зависит, показывать ли выбор валюты вообще, и лишний
        // кадр без неё мигнул бы списком там, где выбора нет.
        const counter = conditions.terms.pairs
          .filter((pair) => pair.fromCode === from)
          .map((pair) => pair.toCode);
        const to = counter.includes(PREFERRED_TO) ? PREFERRED_TO : (counter[0] ?? '');
        setToCode((current) => current || to);
      } catch (failure) {
        setError(failure instanceof ApiError ? failure.message : 'Не удалось загрузить данные');
      } finally {
        setLoading(false);
        // И на отказе тоже: оболочке важно, что экран досказал своё, а
        // не что он это сделал успешно. Иначе заставка осталась бы
        // висеть над сообщением об ошибке, которого никто не увидит.
        onReady?.();
      }
    })();
    // Заявки ведёт менеджер, и его шаг виден только по запросу.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revisit]);

  useEffect(() => {
    // Отдельным запросом, а не вместе с остальным: молчание справочника
    // сетей — не повод не открыть экран обмена. Без сетей нельзя завести
    // кошелёк, но рублёвая сторона работает как работала.
    void get<{ networks: string[] }>('/api/networks')
      .then((result) => setNetworks(result.networks))
      .catch(() => setNetworks([]));
  }, []);

  useEffect(() => {
    // Раз в полминуты: отсчёт показывается минутами, и чаще незачем.
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const pairs = useMemo(() => terms?.pairs ?? [], [terms]);

  /**
   * Валюты, между которыми есть выбор помимо кнопки-переворота.
   *
   * Встречная валюта из списка убирается: выбрать её значило бы
   * развернуть направление, а это и делает кнопка. Когда меняется одна
   * пара, после такой чистки остаётся один вариант — и вместо списка
   * показывается подпись. Появится третья валюта — выбор вернётся сам.
   */
  const fromCodes = useMemo(
    () =>
      sortCurrencies(
        [...new Set(pairs.map((pair) => pair.fromCode))].filter((code) => code !== toCode),
      ),
    [pairs, toCode],
  );
  const toCodes = useMemo(
    () =>
      sortCurrencies([
        ...new Set(pairs.filter((pair) => pair.fromCode === fromCode).map((p) => p.toCode)),
      ]),
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

  /**
   * Реквизиты, подходящие валюте получения: рубли приходят по телефону
   * или на карту, USDT — на кошелёк. Правило берётся из доменных типов,
   * а не пишется здесь заново: отказывает всё равно операция, и своя
   * копия правила разошлась бы с ней молча.
   */
  const toCurrency = useMemo(
    () => terms?.currencies.find((currency) => currency.code === toCode),
    [terms, toCode],
  );
  const suitableKinds = useMemo(
    () =>
      toCurrency ? requisiteKinds.filter((one) => requisiteKindSuits(one, toCurrency.kind)) : [],
    [toCurrency],
  );
  const suitable = useMemo(
    () =>
      toCurrency
        ? requisites.filter((one) => requisiteKindSuits(one.kind, toCurrency.kind))
        : [],
    [requisites, toCurrency],
  );
  /*
   * Кошелёк в погашенной сети из выбора уходит, а из списка — нет:
   * клиент видит, почему запись не предлагается, и может её удалить.
   * Подать по ней заявку всё равно нельзя — операция откажет.
   */
  const offered = useMemo(() => suitable.filter((one) => one.isAvailable), [suitable]);

  useEffect(() => {
    // Подставляется запись из последней заявки в ту же валюту: обычная
    // повторная заявка не должна требовать выбора. Заявки приходят от
    // новых к старым, поэтому первая найденная и есть последняя.
    if (selected !== undefined && offered.some((one) => one.id === selected)) return;
    const lastUsed = requests.find(
      (request) =>
        request.toCode === toCode &&
        request.requisitesId !== null &&
        offered.some((one) => one.id === request.requisitesId),
    )?.requisitesId;
    setSelected(lastUsed ?? offered[0]?.id);
  }, [offered, requests, toCode, selected]);

  /** Направление одной строкой: им помечается ответ о курсе. */
  const pairKey = `${fromCode}/${toCode}/${kind}`;

  /**
   * Курс этого направления — или его отсутствие. `undefined` означает
   * «ответ ещё не пришёл», и это не то же самое, что «курса нет»:
   * говорить клиенту, что курс недоступен, пока его просто не успели
   * спросить, — значит пугать его на ровном месте.
   */
  const rate = quote?.pair === pairKey ? quote.view : undefined;

  /*
   * Курс спрашивается на направление, а не на сумму.
   *
   * От суммы он не зависит: получаемое — это произведение суммы на
   * курс, и считать его на сервере значило бы гонять круг по сети ради
   * одного умножения. Умножение живёт ниже, на этом же экране, и берёт
   * ту же `Money` из общего пакета, что и ядро, — число сходится с тем,
   * которое запишется в заявку, потому что считается тем же кодом.
   *
   * Отсюда же исчезла пауза перед запросом: пока запрос уходил на
   * каждую цифру, без неё к серверу летел бы шквал; теперь дёргать
   * нечего.
   */
  useEffect(() => {
    // У наличных курса нет: там финальный курс называет менеджер, и
    // спрашивать провайдера незачем.
    if (kind !== 'electronic' || !fromCode || !toCode) {
      setQuote({ pair: pairKey, view: null });
      return;
    }

    let cancelled = false;
    const ask = () => {
      void get<{ quote: QuoteView | null }>(
        `/api/quote?${new URLSearchParams({ fromCode, toCode }).toString()}`,
      )
        .then((result) => {
          if (!cancelled) setQuote({ pair: pairKey, view: result.quote });
        })
        // Отсутствие курса — не ошибка экрана: заявку можно подать и без
        // него, а сказать клиенту нужно то же самое, что при наличных.
        .catch(() => {
          if (!cancelled) setQuote({ pair: pairKey, view: null });
        });
    };

    ask();
    /*
     * И дальше — по кругу, пока экран открыт.
     *
     * Курс на экране не может стоять вечно: заявка уходит по нему, а у
     * обязательства есть край — слишком старую котировку сервис не
     * назовёт вовсе, и заявка тогда молча уйдёт без курса. Обновление
     * дешёвое (сервер отвечает из памяти), а число целое и от мелких
     * движений рынка не дёргается.
     */
    const timer = setInterval(ask, QUOTE_REFRESH_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [kind, fromCode, toCode, pairKey]);

  /**
   * Сколько клиент получит. Считается здесь же, без обращения к
   * серверу: курс уже известен, а `Money` общая с ядром — значит и
   * округление, и точность те же самые.
   */
  const toAmount = useMemo(() => {
    if (!rate) return null;
    const parsed = Money.amountSchema.safeParse(parseAmount(amount));
    if (!parsed.success || Money.isNegative(parsed.data)) return null;
    /*
     * Вниз до целого — тем же правилом, что и `roundPayout` в ядре.
     * Своей копией, а не импортом: за `@nemo/core` в браузер приехал бы
     * драйвер базы. Разойтись они не должны, и проверяет это не типаж, а
     * то, что обе стороны считают одной и той же `Money`.
     */
    return Money.floor(Money.multiply(parsed.data, rate.rate));
  }, [rate, amount]);

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
        // Отметка курса, который клиент сейчас видит на экране: по нему
        // заявка и уйдёт. Без неё ядро спросило бы курс заново, и между
        // взглядом и нажатием он успел бы обновиться. Отметка чужого
        // направления сюда попасть не может — курс берётся только свой.
        ...(rate ? { quotedAt: rate.asOf } : {}),
        // Наличные клиент получает на руки: реквизиты для перевода при
        // этом способе не нужны и не запрашиваются.
        ...(kind === 'electronic' && selected ? { requisitesId: selected } : {}),
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

  /**
   * Действует ли минимальная сумма на эту заявку. Валюту порога клиент
   * либо отдаёт — тогда его сторона это введённая сумма, — либо
   * получает, и тогда её называет курс. Без курса стороны нет, и ядро
   * порога не проверяет; экран о нём тогда молчит, потому что число, ни
   * на что не влияющее, читается как обещание.
   */
  const minimumApplies = Boolean(
    terms &&
      (fromCode === terms.minAmountCode || (toCode === terms.minAmountCode && rate)),
  );
  const measured = terms
    ? thresholdSide(terms.minAmountCode, { fromCode, toCode }, amount, toAmount)
    : null;
  const belowMinimum = Boolean(
    terms && measured && Money.compare(measured, terms.minAmount) < 0,
  );

  const ready =
    !busy &&
    Boolean(fromCode) &&
    Boolean(toCode) &&
    Boolean(amount.trim()) &&
    !belowMinimum &&
    // Электронный перевод без реквизитов отправлять некуда, а наличные
    // клиент получает на руки — там их и не спрашивают.
    (!electronic || selected !== undefined);

  const paymentLeft =
    active && terms ? timeLeftToPay(active, terms.unpaidTtlMinutes, now) : undefined;

  const chosen = offered.find((one) => one.id === selected);
  const requisitesLine = chosen ? describeRequisites(chosen) : 'Укажите реквизиты';

  if (loading) {
    return <Loading />;
  }

  return (
    <>

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
                <CurrencyPicker
                  label="Что отдаёте"
                  codes={fromCodes}
                  selected={fromCode}
                  onPick={setFromCode}
                />
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
                  className={toAmount ? 'calc__amount' : 'calc__amount calc__amount--empty'}
                >
                  {toAmount ? formatAmount(toAmount) : '0'}
                </div>
                <CurrencyPicker
                  label="Что хотите получить"
                  codes={toCodes}
                  selected={toCode}
                  onPick={setToCode}
                />
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
            {/*
              Пока ответ о курсе не пришёл, строка остаётся прежней:
              между сменой валюты и ответом проходит вздох, и мигать за
              него «курс недоступен» значит пугать на ровном месте.
            */}
            {electronic
              ? rate === null
                ? 'Курс сейчас недоступен — его назовёт менеджер после подачи заявки.'
                : 'По этому курсу и обменяем: он фиксируется в заявке.'
              : 'Курс по наличным называет менеджер.'}
            {/*
              Минимум называется до подачи, а не в отказе после неё:
              заявку, которую сервис заведомо не примет, клиент не должен
              успеть подать.
            */}
            {terms && minimumApplies
              ? ` Минимальная сумма обмена — ${formatMoney(terms.minAmount, terms.minAmountCode)}.`
              : ''}
            {electronic && selected === undefined
              ? ` Чтобы подать заявку, укажите, как получить ${toCode}: без реквизитов деньги некуда отправить.`
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

          {/*
            Сколько осталось на оплату. Обязательство по курсу не
            бессрочно, и клиент должен видеть его край: заявку, не
            оплаченную вовремя, сервис отменяет сам.
          */}
          {paymentLeft ? <p className="active__note">{paymentLeft}</p> : undefined}

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

      {sheet?.kind === 'requisites' ? (
        <Sheet title="Куда отправить деньги" onClose={() => setSheet(undefined)}>
          <RequisitesSheet
            requisites={suitable}
            selectedId={selected}
            kinds={suitableKinds}
            networks={networks}
            onPick={(picked) => {
              setSelected(picked.id);
              setSheet(undefined);
            }}
            onSaved={(saved) => {
              setRequisites((current) => [saved, ...current]);
              setSelected(saved.id);
              setSheet(undefined);
            }}
            onRemoved={(removedId) => {
              setRequisites((current) => current.filter((one) => one.id !== removedId));
              // Выбор сбрасывается здесь же: подстановка вернёт
              // подходящую запись, а показывать удалённую как выбранную
              // нельзя — заявка по ней не подастся.
              setSelected((current) => (current === removedId ? undefined : current));
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


/**
 * Сторона заявки, с которой сравнивается минимальная сумма обмена, — та,
 * что выражена в валюте порога. Валюту называет сервер вместе с самим
 * порогом: она у него константа, но экран о ней догадываться не должен.
 *
 * Зеркалит правило ядра (`thresholdSideOf` в `exchange-requests.ts`):
 * отказывает всё равно операция, а экран лишь не даёт подать заявку,
 * про которую уже известно, что её отвергнут.
 */
function thresholdSide(
  thresholdCode: string,
  direction: { fromCode: string; toCode: string },
  amount: string,
  toAmount: Amount | null,
): Amount | null {
  if (direction.fromCode === thresholdCode) {
    // Введённое человеком проверяется той же схемой, что и на сервере:
    // до первой цифры и на полпути к ней в поле лежит не число.
    const typed = Money.amountSchema.safeParse(parseAmount(amount));
    return typed.success ? typed.data : null;
  }
  if (direction.toCode === thresholdCode) return toAmount;
  return null;
}

/**
 * Сколько времени у клиента осталось на оплату.
 *
 * Считается от момента выдачи реквизитов по сроку из условий обмена —
 * тому же, по которому отменяет ядро. Пусто, пока реквизитов не выдали:
 * до этого платить некуда, и отсчёт не идёт.
 *
 * Минуты, а не точное время: заявка живёт часами, и «до 14:37» просило
 * бы клиента считать разницу самому.
 */
function timeLeftToPay(
  request: ExchangeRequestView,
  ttlMinutes: number,
  now: number,
): string | undefined {
  if (request.status !== 'rate_confirmed' || !request.requisitesIssuedAt) return undefined;

  const issuedAt = new Date(request.requisitesIssuedAt).getTime();
  const left = issuedAt + ttlMinutes * 60_000 - now;
  if (left <= 0) {
    // Срок вышел, а заявка ещё в этом состоянии: отменяет её отдельный
    // прогон, и до него честнее сказать, что время кончилось, чем
    // показывать ноль минут.
    return 'Срок оплаты истёк — заявку вот-вот отменят.';
  }
  return `На оплату остаётся ${Math.ceil(left / 60_000)} мин: курс держится до конца срока.`;
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
