'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  ClientCardApplicationView,
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
} from '@nemo/types';
import { ApiError, get, post } from '@/lib/client-api';
import { haptic, openSupport, supportLink } from '@/lib/telegram/webapp';
import {
  isOpen,
  KIND_LABELS,
  REQUEST_STEPS,
  STEP_LABELS,
  STEP_NOTES,
  stepOf,
} from '@/lib/exchange-request-labels';
import { CARD_STATUS_LABELS } from '@/lib/labels';
import {
  describeRequisites,
  formatAmount,
  formatMoney,
  formatRate,
  MAX_FRACTION_DIGITS,
  normalizeTyped,
  parseAmount,
  shortId,
} from '@/lib/format';
import { CardSection } from './card-section';
import { InquirySheet, type InquiryTopic } from './inquiry-sheet';
import { RequisitesSheet } from './requisites-section';
import { CurrencyPicker } from './ui/currency-picker';
import { sortCurrencies } from './ui/flags';
import { CardIcon, CartIcon, ChevronRight, HotelIcon, SwapIcon } from './ui/icons';
import { Failure } from './ui/failure';
import { Loading } from './ui/loading';
import { ConfirmSheet, NoticeSheet, Sheet } from './ui/sheet';

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

/**
 * Как часто перечитывается заявка, пока она в работе.
 *
 * Ведёт её менеджер, и шаги идут минутами — но клиент, ждущий реквизиты
 * для оплаты, смотрит на экран непрерывно. Двадцать секунд: чаще значит
 * спрашивать сервер ни о чём, реже — держать перед клиентом состояние,
 * которого уже нет.
 */
const REQUESTS_REFRESH_MS = 20_000;

const SUBMITTED = {
  title: 'Заявка принята',
  body: 'Менеджер возьмёт её в ближайшие минуты. Бот напишет на каждом шаге — приложение можно закрыть.',
};

/** Ввод реквизитов и подтверждения уводятся в лист: на экране им места нет. */
type SheetState =
  | { readonly kind: 'requisites' }
  | { readonly kind: 'card' }
  /**
   * Подтверждение подачи — со снимком того, что клиент в нём прочёл.
   *
   * Живыми эти величины быть не могут: курс перечитывается каждые
   * полминуты, и лист, открытый на минуту, успевал бы поменять числа под
   * читающим. Подтверждают то, что видят, и заявка уходит по этому же
   * снимку — вплоть до отметки курса.
   */
  | {
      readonly kind: 'confirm';
      readonly give: Amount;
      readonly payout: Amount | null;
      readonly rate: QuoteView | null;
      readonly requisitesId: string | undefined;
      readonly requisitesLine: string | undefined;
      /*
       * Направление и способ — тоже часть снимка.
       *
       * Их меняет не только клиент: раздел перечитывает условия при
       * каждом возвращении, и если валюта или способ пропали из
       * справочника, экран подставляет первые уцелевшие сам. Лист
       * перехватывает нажатия, но не эти подстановки — и заявка ушла бы
       * с подтверждённой суммой по неподтверждённой паре.
       */
      readonly exchange: ExchangeKind;
      readonly fromCode: string;
      readonly toCode: string;
    }
  | { readonly kind: 'cancel' }
  /** Просьба оплатить бронь или покупку — уходит обращением к менеджеру. */
  | { readonly kind: 'inquiry'; readonly topic: InquiryTopic }
  | {
      readonly kind: 'notice';
      readonly title: string;
      readonly body: string;
      /** Реквизиты для оплаты: их переносят в банк, а не читают. */
      readonly copyable?: boolean;
    };

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
  /** Заявки на карту — ради состояния в «Дополнительно» и самого листа. */
  const [cards, setCards] = useState<readonly ClientCardApplicationView[]>([]);
  const [fromCode, setFromCode] = useState('');
  const [toCode, setToCode] = useState('');
  const [kind, setKind] = useState<ExchangeKind>('electronic');
  /**
   * В какое поле клиент вводит. Второе считается по курсу.
   *
   * Сторона нужна, потому что вопросов у клиента два и они не сводятся
   * друг к другу: «сколько дадут за мои сто USDT» и «сколько USDT нужно,
   * чтобы вышло ровно пятьдесят тысяч». Второй у обменника звучит не
   * реже первого — им приходят за суммой брони, счёта или билета.
   */
  const [side, setSide] = useState<'give' | 'get'>('give');
  /** Набранное клиентом — в том поле, которое он выбрал. */
  const [typed, setTyped] = useState('');
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
  /** Счётчик попыток: им же заводится повторное чтение после отказа. */
  const [attempt, setAttempt] = useState(0);
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
        // Прошлый отказ снимается: условия прочитаны.
        setError(undefined);
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
  }, [revisit, attempt]);

  useEffect(() => {
    // Отдельным запросом, а не вместе с остальным: молчание справочника
    // сетей — не повод не открыть экран обмена. Без сетей нельзя завести
    // кошелёк, но рублёвая сторона работает как работала.
    void get<{ networks: string[] }>('/api/networks')
      .then((result) => setNetworks(result.networks))
      .catch(() => setNetworks([]));
  }, []);

  useEffect(() => {
    // Тоже отдельно и по той же причине: карта — не обмен, и её
    // молчание не должно задерживать первый экран. Строка в
    // «Дополнительно» до ответа стоит без состояния, а не отсутствует:
    // пропасть и появиться она успела бы прямо под пальцем.
    void get<{ applications: ClientCardApplicationView[] }>('/api/card-applications')
      .then((result) => setCards(result.applications))
      .catch(() => setCards([]));
  }, [revisit]);

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
   * Обе стороны сделки числами. Считается та, в которую не вводят.
   *
   * Без обращения к серверу: курс уже известен, а `Money` общая с
   * ядром — значит и округление, и точность те же самые.
   */
  const sides = useMemo<{
    readonly give: Amount | null;
    readonly get: Amount | null;
  }>(() => {
    const parsed = Money.amountSchema.safeParse(parseAmount(typed));
    // Пока в поле не число — сторон нет ни одной: ни считать по нему,
    // ни подавать заявку нельзя.
    if (!parsed.success || Money.isNegative(parsed.data)) return { give: null, get: null };
    const value = parsed.data;

    if (side === 'give') {
      /*
       * Вниз до целого — тем же правилом, что и `roundPayout` в ядре.
       * Своей копией, а не импортом: за `@nemo/core` в браузер приехал
       * бы драйвер базы. Разойтись они не должны, и проверяет это не
       * типаж, а то, что обе стороны считают одной и той же `Money`.
       */
      return { give: value, get: rate ? Money.floor(Money.multiply(value, rate.rate)) : null };
    }

    /*
     * Обратный счёт округляется вверх, и притом до того же знака, до
     * какого сумма показывается. Отброшенный вниз хвост возвращается
     * умножением на курс как недостача: клиент просил пятьдесят тысяч,
     * а ядро, считая выдачу вниз до целого, записало бы 49 999.
     */
    if (!rate || Money.isZero(rate.rate)) return { give: null, get: value };
    return {
      give: Money.divideCeil(value, rate.rate, MAX_FRACTION_DIGITS),
      get: value,
    };
  }, [typed, side, rate]);

  /**
   * Сколько клиент получит на самом деле.
   *
   * Считается от отданной стороны — той, которой подаётся заявка, — а не
   * берётся из набранного. При обратном вводе они расходятся на хвост
   * округления: клиент назвал 50 000, деление вверх дало сумму, по
   * которой выйдет ровно столько же или на единицу больше. Показывать в
   * подтверждении надо то, что запишет ядро.
   */
  const payout = useMemo(
    () => (rate && sides.give ? Money.floor(Money.multiply(sides.give, rate.rate)) : null),
    [rate, sides.give],
  );

  /**
   * Последняя посчитанная отдаваемая сумма.
   *
   * Нужна на случай, когда курс уходит из-под уже набранного «получаю»:
   * клиент переключился на наличные или замолчал источник котировок.
   * Считать обратно тогда нечем, и поле должно сохранить смысл, а не
   * цифру — иначе «получаю 50 000 рублей» превратится в «отдаю 50 000
   * USDT».
   */
  const lastGive = useRef('');
  useEffect(() => {
    if (sides.give) lastGive.current = formatAmount(sides.give);
  }, [sides.give]);

  useEffect(() => {
    // Только на явном отсутствии курса: `undefined` значит «ответ ещё
    // не пришёл», и сбрасывать по нему сторону — значит отбирать поле у
    // клиента на каждой смене валюты.
    if (side === 'get' && rate === null) {
      setSide('give');
      setTyped(lastGive.current);
    }
  }, [side, rate]);

  /** Что показать в поле: набранное — как набрано, посчитанное — с разрядами. */
  function shown(which: 'give' | 'get'): string {
    if (side === which) return typed;
    const value = sides[which];
    return value ? formatAmount(value) : '';
  }

  /**
   * Набор строки суммы. Обратный счёт даёт восемь знаков после запятой,
   * и в тот же кегль, что «100», такое число не помещается — обрезанное
   * же оно говорит клиенту неправду о том, сколько отдавать.
   */
  function amountClass(value: string): string {
    if (value.length > 13) return 'calc__amount calc__amount--tiny';
    if (value.length > 9) return 'calc__amount calc__amount--small';
    return 'calc__amount';
  }

  /** Набор в поле делает его тем, по которому считают встречное. */
  function type(which: 'give' | 'get', value: string) {
    setSide(which);
    setTyped(value);
  }

  /** Разряды по окончании набора — только там, где набирали. */
  function settleTyped(which: 'give' | 'get') {
    if (side === which) setTyped(normalizeTyped(typed));
  }

  /** Развернуть направление можно, только если обратное вообще меняют. */
  const canSwap = pairs.some((pair) => pair.fromCode === toCode && pair.toCode === fromCode);

  function swap() {
    if (!canSwap) return;
    // Разворот меняет смысл обеих строк разом, и ничего, кроме самих
    // чисел, об этом не сообщает: толчок отмечает, что нажатие
    // сработало, раньше, чем глаз дочитает новые суммы.
    haptic('light');
    setFromCode(toCode);
    setToCode(fromCode);
    setSwaps(swaps + 1);
  }

  /**
   * Подать заявку ровно по тому снимку, который клиент подтвердил.
   *
   * Не по живым величинам экрана: пока лист открыт, курс успевает
   * обновиться, а вместе с ним — и сумма получения. Заявка должна уйти
   * по прочитанному, иначе подтверждение перестаёт что-либо значить.
   */
  async function submit(confirmed: Extract<SheetState, { kind: 'confirm' }>) {
    setError(undefined);
    setBusy(true);
    try {
      const created = await post<{ request: ExchangeRequestView }>('/api/exchange-requests', {
        kind: confirmed.exchange,
        fromCode: confirmed.fromCode,
        toCode: confirmed.toCode,
        fromAmount: confirmed.give,
        // Отметка курса, который клиент видел в подтверждении: по нему
        // заявка и уйдёт. Без неё ядро спросило бы курс заново, и между
        // взглядом и нажатием он успел бы обновиться. Отметка чужого
        // направления сюда попасть не может — курс берётся только свой.
        ...(confirmed.rate ? { quotedAt: confirmed.rate.asOf } : {}),
        // Наличные клиент получает на руки: реквизиты для перевода при
        // этом способе не нужны и не запрашиваются.
        ...(confirmed.exchange === 'electronic' && confirmed.requisitesId
          ? { requisitesId: confirmed.requisitesId }
          : {}),
      });
      setRequests((current) => [created.request, ...current]);
      setSide('give');
      setTyped('');
      // Заявка ушла — единственный момент во всей сделке, когда сервис
      // берёт на себя обязательство. Отклик здесь не украшение: он
      // говорит то же, что и лист поверх экрана, но раньше него.
      haptic('success');
      setSheet({ kind: 'notice', ...SUBMITTED });
    } catch (failure) {
      haptic('error');
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
      setSheet(undefined);
    } catch (failure) {
      setError(
        failure instanceof ApiError ? failure.message : 'Не удалось отменить заявку на обмен',
      );
    } finally {
      setBusy(false);
    }
  }

  // Заявок в работе может быть несколько; карточкой показывается свежая,
  // остальные видны в истории. Две карточки подряд спорили бы за то,
  // какая из них «та самая».
  const active = requests.find((request) => isOpen(request.status));

  /*
   * Пока заявка в работе, экран перечитывает её сам.
   *
   * Ведёт её менеджер: он берёт её в работу, выдаёт реквизиты,
   * подтверждает оплату — и ни одно из этих событий не приходит в
   * приложение само. Раньше экран узнавал о них только при возвращении в
   * раздел, и клиент, ждущий реквизиты на открытой главной, смотрел на
   * состояние получасовой давности. Бот при этом писал ему — то есть
   * приложение оказывалось последним, кто знает о заявке.
   *
   * Заведён на номер заявки, а не на неё саму: перечитанная, она
   * приезжает новым объектом, и эффект пересоздавался бы после каждого
   * своего же запроса.
   */
  const activeId = active?.id;
  useEffect(() => {
    if (!activeId) return;

    let cancelled = false;
    const reread = () => {
      // Спрятанное приложение не спрашивает ни о чём: свёрнутый в
      // Telegram Mini App живёт часами, и всё это время он тикал бы
      // впустую. Вернувшись, клиент получает свежее состояние сразу —
      // тем же обработчиком.
      if (document.visibilityState !== 'visible') return;
      void get<{ requests: ExchangeRequestView[] }>('/api/exchange-requests')
        .then((mine) => {
          if (!cancelled) setRequests(mine.requests);
        })
        .catch(() => {
          // Молчание сети — не повод показывать отказ поверх работающего
          // экрана: следующий заход через двадцать секунд.
        });
    };

    const timer = setInterval(reread, REQUESTS_REFRESH_MS);
    document.addEventListener('visibilitychange', reread);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', reread);
    };
  }, [activeId]);

  /**
   * Что написано под «Иностранной картой». Состояние — только у живой
   * заявки: у отозванной и отклонённой оно уже ничего клиенту не
   * говорит, а строка снова зовёт подать.
   */
  const card = cards[0];
  const cardLine =
    card && card.status !== 'cancelled' && card.status !== 'rejected'
      ? CARD_STATUS_LABELS[card.status]
      : undefined;

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
        run: () =>
          setSheet({
            kind: 'notice',
            title: 'Реквизиты для оплаты',
            body: instructions,
            copyable: true,
          }),
      });
    }
    // Отменить можно, только пока заявку не взяли: дальше в работе
    // участвует менеджер, и бросить её на полпути клиент уже не может.
    if (active.status === 'new') {
      actions.push({
        label: 'Отменить',
        run: () => {
          // Как и у подачи: отказ прошлой попытки к новой не относится.
          setError(undefined);
          setSheet({ kind: 'cancel' });
        },
      });
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
    ? thresholdSide(terms.minAmountCode, { fromCode, toCode }, sides)
    : null;
  const belowMinimum = Boolean(
    terms && measured && Money.compare(measured, terms.minAmount) < 0,
  );

  const ready =
    !busy &&
    Boolean(fromCode) &&
    Boolean(toCode) &&
    // Отданная сторона посчитана — значит в поле число, а не набранный
    // по дороге мусор: заявка, которую сервер отвергнет разбором, не
    // должна доходить до отправки.
    sides.give !== null &&
    !Money.isZero(sides.give) &&
    !belowMinimum &&
    // Пока ответ о курсе не пришёл, подавать нечего: на экране в этот
    // момент нет ни курса, ни суммы получения, а заявка ушла бы без
    // отметки — то есть по курсу, который ядро спросит заново и которого
    // клиент не видел. Отсутствие курса (`null`) — другое дело: это
    // рабочее состояние, и заявка по нему подаётся.
    (!electronic || rate !== undefined) &&
    // Электронный перевод без реквизитов отправлять некуда, а наличные
    // клиент получает на руки — там их и не спрашивают.
    (!electronic || selected !== undefined);

  const paymentLeft =
    active && terms ? timeLeftToPay(active, terms.unpaidTtlMinutes, now) : undefined;

  /**
   * Что мешает подать заявку — то самое, из-за чего не горит кнопка.
   *
   * Только названное словами: пустое поле и не пришедший ещё курс сюда
   * не идут — первое клиент видит сам, второе живёт полвздоха, и строка
   * под кнопкой мигала бы на каждой смене валюты.
   */
  const obstacle =
    belowMinimum && terms
      ? `Меньше минимальной суммы обмена — ${formatMoney(terms.minAmount, terms.minAmountCode)}.`
      : electronic && selected === undefined
        ? `Укажите, как получить ${toCode}: без реквизитов деньги некуда отправить.`
        : undefined;

  const chosen = offered.find((one) => one.id === selected);
  const requisitesLine = chosen ? describeRequisites(chosen) : 'Укажите реквизиты';
  const support = supportLink();

  if (loading) {
    return <Loading />;
  }

  /*
   * Условий нет — значит запрос не дошёл, и сказать надо именно это.
   * Раньше на этом месте стояло «направления обмена ещё не заведены»:
   * при отказе сети справочник тоже пуст, и клиент читал о решении
   * сервиса вместо сообщения о связи.
   */
  if (!terms) {
    return (
      <Failure
        message={error ?? 'Не удалось загрузить условия обмена'}
        onRetry={() => {
          // Ожидание поднимается здесь: раздел показывает талисмана
          // вместо отказа, и вид с кнопкой уходит вместе с первым
          // нажатием — второго по нему уже не сделать.
          setLoading(true);
          setAttempt((was) => was + 1);
        }}
      />
    );
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
              {/*
                Анимация разворота заводится чередованием имени, а не
                пересборкой строки. Пересобранная, она уносила с собой
                поле ввода: фокус слетал, клавиатура закрывалась, и
                клиент, развернувший направление посреди набора,
                возвращался к нему заново.
              */}
              <div className={swapClass('give', swaps)}>
                <input
                  value={shown('give')}
                  onChange={(event) => type('give', event.target.value)}
                  // Разряды расставляются, когда человек закончил
                  // набирать: делать это на каждый символ значит гонять
                  // курсор по строке под пальцем. И только в том поле,
                  // где набирают: второе уже показано посчитанным.
                  onBlur={() => settleTyped('give')}
                  inputMode="decimal"
                  placeholder="0"
                  aria-label="Сумма к обмену"
                  className={amountClass(shown('give'))}
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
              {/*
                Курс стоит между отданным и полученным — там, где он и
                действует. Сервис называет его до подачи, потому что по
                нему сделку и сравнивают с соседним обменником: сумма
                получения одна отвечает «сколько мне дадут», но не
                «дорого ли это».

                Пока ответа о курсе нет, строки нет вовсе — не пустой
                прочерк, а ничего: мигнувшее «недоступен» между сменой
                валюты и ответом пугало бы на ровном месте. Черта в этот
                момент занимает всю ширину, и её длина — единственное,
                что выдаёт ожидание.
              */}
              <span
                className={
                  rate ? 'calc__rate' : 'calc__rate calc__rate--absent'
                }
              >
                {rate
                  ? formatRate(rate.rate, fromCode, toCode)
                  : rate === null
                    ? 'Курс назовёт менеджер'
                    : ''}
              </span>
              <span className="calc__rule" />
            </div>

            <div className="calc__get">
              <div className="eyebrow">Получаю</div>
              <div className={swapClass('get', swaps)}>
                {/*
                  Тоже поле ввода, а не подпись: сумму получения называют
                  так же часто, как отданную, — по счёту за отель, по
                  цене билета, по броне. Пока курса нет, считать обратно
                  нечем, и поле только показывает: набирать в нём
                  означало бы обещать пересчёт, которого не будет.
                */}
                <input
                  value={shown('get')}
                  onChange={(event) => type('get', event.target.value)}
                  onBlur={() => settleTyped('get')}
                  readOnly={!rate}
                  inputMode="decimal"
                  placeholder="0"
                  aria-label="Сумма к получению"
                  className={amountClass(shown('get'))}
                />
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

          {/*
            Кнопка ведёт к подтверждению, а не подаёт заявку сразу.
            Реквизит для перевода подставляется сам — из прошлой заявки в
            ту же валюту, — и клиент, вернувшийся через месяц с новой
            картой, отправлял бы деньги на старую, не увидев её ни разу.
            Сверить условия сделки до подачи стоит одного нажатия;
            перевод не туда не возвращается.
          */}
          <button
            type="button"
            onClick={() => {
              if (!sides.give) return;
              // Отказ прошлой попытки к новой не относится: лист
              // открылся бы с чужим сообщением под кнопкой подачи.
              setError(undefined);
              // Снимок берётся здесь: дальше он не меняется, что бы ни
              // пришло с сервера, — и по нему же уходит заявка.
              setSheet({
                kind: 'confirm',
                give: sides.give,
                payout,
                rate: rate ?? null,
                requisitesId: electronic ? selected : undefined,
                requisitesLine: electronic && chosen ? describeRequisites(chosen) : undefined,
                exchange: kind,
                fromCode,
                toCode,
              });
            }}
            disabled={!ready}
            className="btn btn--gold exchange__submit"
          >
            {electronic ? 'Обменять' : 'Заказать наличные'}
          </button>

          {/*
            Что мешает подать заявку прямо сейчас — отдельной строкой и
            в цвет. Погашенная кнопка сама по себе не объясняет ничего:
            причин у неё несколько, и клиент, набравший слишком мало,
            видел ровно то же, что клиент без реквизитов.
          */}
          {obstacle ? <p className="notice">{obstacle}</p> : undefined}

          <p className="hint">
            {/*
              Сам курс называет строка на черте калькулятора, и повторять
              его здесь незачем: подсказка объясняет последствие — что с
              этим курсом будет дальше и можно ли подавать заявку без
              него.
            */}
            {electronic
              ? rate === null
                ? 'Заявку можно подать и без курса: менеджер назовёт его, когда возьмёт её в работу.'
                : // Без указания на курс: пока ответ не пришёл, строка над
                  // подсказкой пуста, и «по этому курсу» показывало бы на
                  // пустое место. Обещание при этом то же самое — оно
                  // относится к курсу заявки, а не к числу на экране.
                  'Курс фиксируется в заявке: по нему и обменяем.'
              : 'Наличные считает менеджер: курс и сумму он назовёт, когда возьмёт заявку.'}
            {/*
              Минимум называется заранее — как справка, а не как упрёк.
              Нарушенный, он уходит наверх отдельной строкой: там он
              отвечает на вопрос «почему не нажимается», и повторять его
              здесь значило бы сказать одно и то же дважды.
            */}
            {terms && minimumApplies && !belowMinimum
              ? ` Минимальная сумма обмена — ${formatMoney(terms.minAmount, terms.minAmountCode)}.`
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

          {/*
            Дорога к менеджеру от заявки, а не только из профиля: вопрос
            о ней возникает здесь — где заявка стоит третий час и
            непонятно, ждать ли дальше. Строкой, а не кнопкой в ряду:
            кнопок там уже две, и третья с длинной подписью ломала бы
            их в столбик — а по весу это и не действие над заявкой, а
            выход из приложения в чат.
          */}
          {support ? (
            <button
              type="button"
              onClick={openSupport}
              className="link active__support"
            >
              Написать менеджеру
            </button>
          ) : undefined}
        </div>
      ) : undefined}

      {/*
        Что сервис делает, когда российская карта за границей не
        работает. Общий знаменатель у всех трёх пунктов один, и назван
        он местом, а не порядком: «Дополнительно» говорило о положении
        блока в списке, а не о том, зачем сюда заходят.

        Сеткой, а не строками: строк было бы три по семьдесят пикселей,
        и блок уезжал бы за нижний край под карточкой заявки. В плитке
        только название и состояние там, где оно есть, — подписи вроде
        «оформит менеджер» повторяют то, что и так верно про всё здесь.
      */}
      <div className="section-title">За границей</div>
      <div className="abroad">
        <button type="button" onClick={() => setSheet({ kind: 'card' })} className="abroad__item">
          <span className="abroad__icon">
            <CardIcon />
          </span>
          <span className="abroad__label">Иностранная карта</span>
          {cardLine ? <span className="abroad__state">{cardLine}</span> : undefined}
        </button>
        <button
          type="button"
          onClick={() => setSheet({ kind: 'inquiry', topic: 'hotel' })}
          className="abroad__item"
        >
          <span className="abroad__icon">
            <HotelIcon />
          </span>
          <span className="abroad__label">Оплатить отель</span>
        </button>
        <button
          type="button"
          onClick={() => setSheet({ kind: 'inquiry', topic: 'purchase' })}
          className="abroad__item"
        >
          <span className="abroad__icon">
            <CartIcon />
          </span>
          <span className="abroad__label">Оплатить покупку</span>
        </button>
      </div>

      {/*
        Подтверждение перед подачей. Показывает то, что запишет ядро, а
        не то, что набрано: при обратном вводе сумма получения считается
        от отданной стороны и может разойтись с названной на хвост
        округления.
      */}
      {sheet?.kind === 'confirm' ? (
        <Sheet title="Проверьте заявку" onClose={() => setSheet(undefined)}>
          <p className="sheet__body">
            {sheet.exchange === 'electronic'
              ? 'Менеджер возьмёт заявку и выдаст реквизиты для оплаты. Курс уже зафиксирован.'
              : 'Курс и сумму по наличным менеджер назовёт, когда возьмёт заявку.'}
          </p>

          <div className="summary">
            <div className="summary__row">
              <span className="summary__label">Отдаю</span>
              <span className="summary__value summary__value--strong">
                {formatMoney(sheet.give, sheet.fromCode)}
              </span>
            </div>
            <div className="summary__row">
              <span className="summary__label">Получаю</span>
              <span className="summary__value summary__value--strong">
                {sheet.payout
                  ? formatMoney(sheet.payout, sheet.toCode)
                  : `${sheet.toCode} — назовёт менеджер`}
              </span>
            </div>
            {sheet.rate ? (
              <div className="summary__row">
                <span className="summary__label">Курс</span>
                <span className="summary__value">
                  {formatRate(sheet.rate.rate, sheet.fromCode, sheet.toCode)}
                </span>
              </div>
            ) : undefined}
            <div className="summary__row">
              <span className="summary__label">Способ</span>
              <span className="summary__value">{KIND_LABELS[sheet.exchange]}</span>
            </div>
            {sheet.requisitesLine ? (
              <div className="summary__row">
                <span className="summary__label">Деньги придут на</span>
                <span className="summary__value">{sheet.requisitesLine}</span>
              </div>
            ) : undefined}
          </div>

          {/*
            Отказ показывается здесь же: лист закрывает собой экран, и
            сообщение под ним клиент увидел бы только закрыв лист — то
            есть решив, что заявка подана.
          */}
          {error ? <p className="error">{error}</p> : undefined}

          <div className="sheet__actions">
            <button
              type="button"
              onClick={() => void submit(sheet)}
              disabled={busy}
              className="btn btn--gold"
            >
              {busy ? 'Подаём…' : 'Подтвердить'}
            </button>
            <button
              type="button"
              onClick={() => setSheet(undefined)}
              disabled={busy}
              className="btn btn--soft"
            >
              Изменить
            </button>
          </div>
        </Sheet>
      ) : undefined}

      {sheet?.kind === 'cancel' && active ? (
        <ConfirmSheet
          title="Отменить заявку?"
          body="Отменённую не вернуть — придётся подать новую, а курс к тому времени будет другим. Если передумали менять прямо сейчас, заявку можно просто оставить: она ждёт менеджера."
          confirm={busy ? 'Отменяем…' : 'Отменить заявку'}
          busy={busy}
          error={error}
          onConfirm={() => void cancel(active.id)}
          onClose={() => setSheet(undefined)}
        />
      ) : undefined}

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

      {sheet?.kind === 'card' ? (
        <Sheet title="Иностранная карта" onClose={() => setSheet(undefined)}>
          <CardSection applications={cards} onChanged={setCards} />
        </Sheet>
      ) : undefined}

      {sheet?.kind === 'inquiry' ? (
        <InquirySheet
          topic={sheet.topic}
          onSent={() =>
            setSheet({
              kind: 'notice',
              title: 'Менеджер получил просьбу',
              body: 'Он посчитает и ответит в чате — приложение для этого держать открытым не нужно.',
            })
          }
          onClose={() => setSheet(undefined)}
        />
      ) : undefined}

      {sheet?.kind === 'notice' ? (
        <NoticeSheet
          title={sheet.title}
          body={sheet.body}
          copyable={sheet.copyable}
          onClose={() => setSheet(undefined)}
        />
      ) : undefined}
    </>
  );
}


/**
 * Класс строки калькулятора с анимацией разворота.
 *
 * Анимация перезапускается сменой имени, а не пересборкой узла: строка
 * несёт поле ввода, и пересобранная она уносила бы с собой фокус вместе
 * с клавиатурой. Одно и то же имя браузер вторично не проигрывает,
 * поэтому их два и они чередуются по чётности разворота.
 */
function swapClass(side: 'give' | 'get', swaps: number): string {
  if (!swaps) return 'calc__line';
  return `calc__line calc__line--${side}-${swaps % 2 === 0 ? 'a' : 'b'}`;
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
  sides: { readonly give: Amount | null; readonly get: Amount | null },
): Amount | null {
  if (direction.fromCode === thresholdCode) return sides.give;
  if (direction.toCode === thresholdCode) return sides.get;
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

