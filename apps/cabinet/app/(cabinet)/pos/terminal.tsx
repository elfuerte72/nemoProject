'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Money, sortCurrencies, type Quote } from '@nemo/types';
import { HowTo, Icon, LIVE_REFRESH_MS, Moment, shouldRefresh } from '@nemo/ui';
import { formatAmount, formatMoney, formatRate } from '@nemo/ui/format';
import {
  INVOICE_STATUS_LABELS,
  INVOICE_STATUS_TONES,
  type InvoiceStatus,
  type MockInvoice,
} from '@/lib/invoice-rows';
import { normalizeTyped, parseTyped } from '@/lib/new-request';
import { posRateLine, posSides, type PosSide } from '@/lib/pos';
import type { QrView } from '@/lib/pos/acquirer';
import type { PosEvent } from '@/lib/pos/bus';
import { markupPercent, parseMarkupPercent } from '@/lib/pos/settings';
import { POS_STREAM_PATH } from '@/lib/pos/stream';
import { POS_HOW_TO } from '@/lib/pos-texts';
import { send } from '@/app/ui/send';
import { CurrencyPick } from './currency-pick';
import { PosPath } from './explainer';
import { MarkupPanel } from './markup-panel';

/**
 * Котировка, как её отдаёт `/api/quote`: к цене приложена отметка
 * времени, и её же экран присылает обратно при создании счёта —
 * иначе счёт уходил бы по курсу, который пришёл между словами «пять
 * тысяч рублей» и нажатием. То же правило, что у подачи заявки.
 */
type QuoteReply = Quote & { readonly asOf: string };

/**
 * POS-терминал: покупатель называет валюту и сумму, мерчант создаёт
 * счёт, покупатель платит по QR.
 *
 * Цена берётся тем же путём, что на экране новой заявки, — курс на
 * направление перечитывается по кругу, стороны считает экран той же
 * арифметикой (`posSides` поверх `@nemo/types`) с наценкой мерчанта.
 * Двух правд о цене быть не должно: покупатель у стойки и мерчант в
 * кабинете смотрят на одно число.
 *
 * Расчёт собран калькулятором Mini App: две строки с крупными суммами
 * одного веса, пилюля валюты у каждой, курс на черте между ними.
 * Набирают в любой строке. У стойки вслух называют обе суммы, и мельче
 * одна другой быть не должна.
 *
 * Валюту выбирают там же, в строке её суммы (`currency-pick.tsx`), и
 * наценка стоит в строке оплаты, у числа, которое поднимает: ряд кнопок
 * над расчётом и кнопка наценки сверху убраны 22 сентября 2026 по
 * словам владельца — «выбрать валюту прямо внутри, как в самом Mini
 * App» и «наценку внутри секции „покупатель платит“, сверху неудобно и
 * плохо видно». Полей «Назначение» и «Покупатель» нет с того же дня:
 * у стойки их никто не заполнял.
 *
 * После «Создать счёт» на месте формы встаёт сам счёт: QR, обратный
 * отсчёт, что с ним стало. Об оплате говорит поток событий
 * (`/api/pos/stream`), и экран отвечает звуком: у стойки смотрят на
 * покупателя, а не на планшет. QR ненастоящий, платёж принимает
 * имитация, и «Покупатель заплатил» — та кнопка, вместо которой у банка
 * будет вебхук; на экране это сказано словами.
 *
 * Полноэкранного «вида терминала» больше нет: владелец попросил убрать
 * его целиком 22 сентября 2026. Кнопок с готовыми суммами — тоже: «на
 * моей практике я ими особо никогда не пользовался», а сумму у стойки
 * всё равно называет покупатель, и своя она каждый раз.
 */

const QUOTE_REFRESH_MS = 30_000;

/**
 * Через сколько тишины наценка уходит на сервер. Полсекунды: меньше —
 * и запись срабатывает посреди набора «12,5», больше — и владелец,
 * сменивший её и сразу выставивший счёт, успел бы уйти раньше записи.
 */
const MARKUP_SAVE_MS = 600;

/**
 * Ступени набора для длинных сумм — то же правило, что в Mini App:
 * обратный счёт даёт длинный хвост, и такое число в кегль, рассчитанный
 * на «5 000», не помещается. Обрезать его нельзя — это ровно та сумма,
 * которую называют покупателю.
 */
function amountClass(value: string): string {
  if (value.length > 13) return 'calc__amount calc__amount--tiny';
  if (value.length > 9) return 'calc__amount calc__amount--small';
  return 'calc__amount';
}

export interface PosDirection {
  readonly fromCode: string;
  readonly toCode: string;
  readonly rate: string | null;
}

/** Строка последних счетов: то, что нужно узнать счёт с полуметра. */
export interface RecentInvoice {
  readonly id: string;
  readonly number: string;
  readonly status: InvoiceStatus;
  readonly payAmount: string;
  readonly payCode: string;
  readonly amount: string;
  readonly code: string;
  readonly createdAt: string;
  readonly demo: boolean;
}

/** Счёт, как его отдаёт `/api/pos/invoices/[id]`: с QR и часами сервера. */
interface InvoiceView {
  readonly invoice: MockInvoice;
  readonly qr: QrView | null;
  readonly now: string;
}

interface OpenView extends InvoiceView {
  /** Разница часов сервера и планшета: отсчёт идёт по серверным. */
  readonly skew: number;
}

export function Terminal({
  directions,
  shift,
  authorName,
  minAmount,
  markupBps,
  canPrice,
  payRound,
  ttlMinutes,
  provider,
  recent,
}: {
  readonly directions: readonly PosDirection[];
  /** Сколько счетов уже создано за сегодня — счётчик смены. */
  readonly shift: number;
  /** Кто создаёт счёт — человек, а не кабинет: так он и запишется в счёт. */
  readonly authorName: string;
  /** Минимум сервиса в долларах: по нему черта курса решает, что сказать. */
  readonly minAmount: string;
  /** Наценка мерчанта: ею считают цену, и владелец правит её тут же. */
  readonly markupBps: number;
  /** Смотрящий вправе менять наценку: оператору поля не показывают. */
  readonly canPrice: boolean;
  /**
   * До какого знака ровнять сумму к оплате в каждой валюте, которой
   * платят. У рубля ноль, у монеты её знак: до целой монеты ровнять
   * нельзя, она стоит под сотню рублей.
   */
  readonly payRound: Readonly<Record<string, number>>;
  /** Сколько минут счёт ждёт оплаты. */
  readonly ttlMinutes: number;
  readonly provider: { readonly title: string; readonly imitation: boolean };
  readonly recent: readonly RecentInvoice[];
}) {
  const router = useRouter();
  const first = directions[0];
  const [fromCode, setFromCode] = useState(first?.fromCode ?? '');
  const [toCode, setToCode] = useState(first?.toCode ?? '');
  const [side, setSide] = useState<PosSide>('pay');
  const [typed, setTyped] = useState('');
  const [kyc, setKyc] = useState(false);
  /*
   * Наценка живёт здесь, а не в своём поле: по ней считается цена, и
   * владелец просил, чтобы цифра менялась при наборе, а не по уходу из
   * поля. Пустая строка — без наценки.
   */
  const [markup, setMarkup] = useState(markupBps === 0 ? '' : markupPercent(markupBps));
  const [markupComplaint, setMarkupComplaint] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [complaint, setComplaint] = useState<string>();
  const [made, setMade] = useState(shift);
  const [open, setOpen] = useState<OpenView>();
  const [asking, setAsking] = useState<'cancel' | 'imitate'>();
  const [tick, setTick] = useState(() => Date.now());

  // Счётчик смены сервер знает точнее: после перечитывания его слово главнее.
  useEffect(() => setMade(shift), [shift]);

  /*
   * Чем платят и что получают — два отдельных выбора: сервис принимает
   * и рубли, и монету, и у стойки просят то одно, то другое. Пары
   * односторонние, поэтому список получения зависит от того, чем платят.
   */
  const fromCodes = useMemo(
    () => sortCurrencies([...new Set(directions.map((one) => one.fromCode))]),
    [directions],
  );
  const toCodes = useMemo(
    () => directions.filter((one) => one.fromCode === fromCode).map((one) => one.toCode),
    [directions, fromCode],
  );

  // Направление пропало из справочника — терминал переходит на первое.
  useEffect(() => {
    if (fromCodes.length > 0 && !fromCodes.includes(fromCode)) setFromCode(fromCodes[0]!);
  }, [fromCodes, fromCode]);
  useEffect(() => {
    if (toCodes.length > 0 && !toCodes.includes(toCode)) setToCode(toCodes[0]!);
  }, [toCodes, toCode]);

  /** До какого знака ровнять то, что платит покупатель. */
  const payDecimals = payRound[fromCode] ?? 0;

  /* Курс — на направление, не на сумму; перечитывается по кругу. */
  const pairKey = `${fromCode}/${toCode}`;
  const [quote, setQuote] = useState<{
    pair: string;
    view: QuoteReply | null;
  }>();
  const rate = quote?.pair === pairKey ? quote.view : undefined;

  useEffect(() => {
    if (!toCode) return;
    let cancelled = false;
    const ask = () => {
      if (document.visibilityState !== 'visible') return;
      void fetch(`/api/quote?from=${fromCode}&to=${toCode}`)
        .then(async (response) => {
          if (!response.ok) throw new Error(String(response.status));
          return (await response.json()) as { quote: QuoteReply | null };
        })
        .then((reply) => {
          if (!cancelled) setQuote({ pair: pairKey, view: reply.quote });
        })
        .catch(() => {
          // Молчащий источник — рабочее состояние: счёт по нему не
          // создать, и об этом сказано словами.
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
  }, [fromCode, toCode, pairKey]);

  /*
   * Набранная наценка в базисных пунктах. Непонятное число не роняет
   * расчёт: цена считается по последнему сохранённому, а о наборе
   * говорит жалоба под полем.
   */
  const typedMarkup = parseMarkupPercent(markup.trim() === '' ? '0' : markup.trim());
  const liveMarkupBps = typedMarkup.ok ? typedMarkup.bps : markupBps;

  const amount = parseTyped(typed);
  const sides = useMemo(
    () => posSides(amount, side, rate ?? null, liveMarkupBps, payDecimals),
    [amount, side, rate, liveMarkupBps, payDecimals],
  );
  const ready = sides.buy !== null && sides.pay !== null && !busy;

  /*
   * Что стоит на черте, решает `posRateLine` — то же правило, что на
   * экране новой заявки и в `GET /api/v1/rates`, с наценкой мерчанта
   * поверх. Голый `quote.rate` сюда не годится: у направления со
   * ступенчатой сеткой курс выводится из посчитанной выдачи, и в
   * котировке он пуст.
   */
  const line = rate
    ? posRateLine(rate, sides.pay, Money.toAmount(minAmount), liveMarkupBps, payDecimals)
    : ({ kind: 'none' } as const);

  /* ── Открытый счёт: QR, отсчёт, исход ─────────────────────────── */

  const openId = useRef<string>(undefined);
  openId.current = open?.invoice.id;
  const busyRef = useRef(false);
  busyRef.current = busy;

  const show = useCallback((view: InvoiceView, was?: OpenView) => {
    // Звук на оплату — один раз, на переходе, а не на каждом перечитывании.
    if (
      was &&
      was.invoice.id === view.invoice.id &&
      was.invoice.status !== 'paid' &&
      view.invoice.status === 'paid'
    ) {
      beep(true);
    }
    setOpen({ ...view, skew: new Date(view.now).getTime() - Date.now() });
  }, []);

  const load = useCallback(async (id: string) => {
    try {
      const response = await fetch(`/api/pos/invoices/${id}`, {
        cache: 'no-store',
      });
      if (!response.ok) return;
      const view = (await response.json()) as InvoiceView;
      setOpen((was) => {
        if (
          was &&
          was.invoice.id === view.invoice.id &&
          was.invoice.status !== 'paid' &&
          view.invoice.status === 'paid'
        ) {
          beep(true);
        }
        return { ...view, skew: new Date(view.now).getTime() - Date.now() };
      });
    } catch {
      // Сеть; поток и таймер перечитают.
    }
  }, []);

  /*
   * Поток событий: об оплате, истечении, отмене говорит сервер. Чужое
   * событие того же мерчанта тоже не пропадает — по нему перечитывается
   * список последних счетов. Таймер — страховка на обрыв потока, тем же
   * правилом, что у остальных экранов.
   */
  useEffect(() => {
    const refresh = (): void => {
      if (
        shouldRefresh({
          hidden: document.visibilityState === 'hidden',
          busy: busyRef.current,
          typing: false,
        })
      ) {
        router.refresh();
      }
    };
    const source = new EventSource(POS_STREAM_PATH);
    source.addEventListener('message', (message: MessageEvent<string>) => {
      let event: PosEvent;
      try {
        event = JSON.parse(message.data) as PosEvent;
      } catch {
        return;
      }
      if (event.kind === 'invoice' && openId.current === event.id) void load(event.id);
      refresh();
    });
    const timer = setInterval(refresh, LIVE_REFRESH_MS);
    return () => {
      source.close();
      clearInterval(timer);
    };
  }, [router, load]);

  /* Секундный отсчёт, пока открыт счёт, который ещё ждёт денег. */
  const waiting = open?.invoice.status === 'issued';
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [waiting]);

  const serverNow = tick + (open?.skew ?? 0);
  const qrLeft = open?.qr ? new Date(open.qr.expiresAt).getTime() - serverNow : null;
  const invoiceLeft = open?.invoice.expiresAt
    ? new Date(open.invoice.expiresAt).getTime() - serverNow
    : null;

  // QR перевыпустился или счёт истёк — перечитать, но один раз на границу.
  const renewedFor = useRef<string>(undefined);
  useEffect(() => {
    if (!open || !waiting) return;
    const boundary =
      qrLeft !== null && qrLeft <= 0
        ? `qr:${open.qr?.expiresAt}`
        : invoiceLeft !== null && invoiceLeft <= 0
          ? `due:${open.invoice.expiresAt}`
          : undefined;
    if (!boundary || renewedFor.current === boundary) return;
    renewedFor.current = boundary;
    void load(open.invoice.id);
  }, [open, waiting, qrLeft, invoiceLeft, load]);

  /*
   * Запись наценки догоняет набор.
   *
   * Цена на экране меняется с каждой цифрой, а на сервер уходит через
   * паузу: запрос на каждое нажатие — это десяток записей за одно
   * «двенадцать с половиной». Уход из поля и Enter не ждут паузы.
   */
  const savedMarkup = useRef(markupBps);
  savedMarkup.current = markupBps;
  const markupTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const saveMarkup = useCallback(async (text: string): Promise<void> => {
    const parsed = parseMarkupPercent(text.trim() === '' ? '0' : text.trim());
    if (!parsed.ok) {
      setMarkupComplaint(parsed.complaint);
      return;
    }
    setMarkupComplaint(undefined);
    if (parsed.bps === savedMarkup.current) return;
    const reply = await send('/api/pos/settings', {
      markupPercent: text.trim() === '' ? '0' : text.trim(),
    });
    if (!reply.ok) {
      setMarkupComplaint(reply.complaint);
      return;
    }
    savedMarkup.current = parsed.bps;
    router.refresh();
  }, [router]);

  function typeMarkup(next: string): void {
    setMarkup(next);
    setMarkupComplaint(undefined);
    clearTimeout(markupTimer.current);
    markupTimer.current = setTimeout(() => void saveMarkup(next), MARKUP_SAVE_MS);
  }

  function settleMarkup(): void {
    clearTimeout(markupTimer.current);
    void saveMarkup(markup);
  }

  // Уходя с экрана, дописывать наценку некуда: таймер снимается.
  useEffect(() => () => clearTimeout(markupTimer.current), []);

  async function issue(): Promise<void> {
    if (!ready) return;
    setComplaint(undefined);
    setBusy(true);
    const reply = await send('/api/pos/invoices', {
      from: fromCode,
      to: toCode,
      side,
      amount: typed,
      kycRequired: kyc,
      ...(rate ? { quotedAt: rate.asOf } : {}),
    });
    setBusy(false);
    if (!reply.ok) {
      beep(false);
      setComplaint(reply.complaint);
      return;
    }
    beep(true);
    setMade((one) => one + 1);
    setTyped('');
    setKyc(false);
    setAsking(undefined);
    show(reply.data as InvoiceView);
    router.refresh();
  }

  async function act(path: string, body: unknown): Promise<void> {
    if (!open || busy) return;
    setComplaint(undefined);
    setBusy(true);
    const reply = await send(path, body);
    setBusy(false);
    if (!reply.ok) {
      setComplaint(reply.complaint);
      return;
    }
    setAsking(undefined);
    show(reply.data as InvoiceView, open);
    router.refresh();
  }

  function next(): void {
    setOpen(undefined);
    setAsking(undefined);
    setComplaint(undefined);
  }

  /* ── Разметка ──────────────────────────────────────────────────── */

  /*
   * Калькулятор — тем же устройством, что экран обмена Mini App
   * (`apps/miniapp/app/exchange-screen.tsx`): две строки с крупными
   * суммами, пилюля валюты у каждой, курс на черте между ними. Так
   * попросил владелец 22 сентября 2026: «сделать POS-терминал так же,
   * как в самом Mini App, такой же дизайн, это визуально удобнее».
   *
   * Взято устройство, а не палитра: Mini App тёмный и фиксированно, а
   * кабинет светлый, и двух правд о том, как выглядит поверхность, быть
   * не должно. То же правило, по которому панель менеджера собрана по
   * образцу чужого кабинета.
   *
   * Набирают в любой строке, и набранная становится той, от которой
   * считают встречную: «сколько покупатель заплатит за две тысячи бат»
   * спрашивают у стойки не реже, чем «сколько бат выйдет за пять
   * тысяч». Прежние чипы «В RUB / В CNY» этим и заменены.
   *
   * Кнопки-переворота здесь нет, в отличие от Mini App: у стойки
   * покупатель всегда платит рублями, и обратного направления не
   * существует.
   */
  function shown(which: PosSide): string {
    if (side === which) return typed;
    const value = which === 'pay' ? sides.pay : sides.buy;
    return value ? formatAmount(value) : '';
  }

  /** Набор в поле делает его тем, по которому считают встречное. */
  function type(which: PosSide, value: string): void {
    setSide(which);
    setTyped(value);
  }

  /*
   * Развернуть направление можно, только если обратное сервис тоже
   * знает: он принимает рубль и монету, а бат только выдаёт.
   */
  const canSwap = directions.some((one) => one.fromCode === toCode && one.toCode === fromCode);

  /**
   * Разворот меняет обе стороны разом. Набранное остаётся на своём
   * месте — оно и есть то, что назвал покупатель, — а встречное
   * пересчитывается по новому направлению.
   */
  function swap(): void {
    if (!canSwap) return;
    setFromCode(toCode);
    setToCode(fromCode);
  }

  /** Разряды по окончании набора — только там, где набирали. */
  function settle(which: PosSide): void {
    if (side === which) setTyped(normalizeTyped(typed));
  }

  const form = (
    <>
      <div className="calc">
        <div className="calc__side">
          <span className="label">Покупатель платит</span>
          <div className="calc__line">
            <input
              className={amountClass(shown('pay'))}
              inputMode="decimal"
              autoComplete="off"
              value={shown('pay')}
              onChange={(event) => type('pay', event.target.value)}
              onBlur={() => settle('pay')}
              placeholder="0"
              aria-label={`Сумма в ${fromCode}`}
            />
            {/*
              Чем платят, выбирают здесь же: сервис принимает и рубли, и
              монету, и у стойки просят то одно, то другое.
            */}
            <CurrencyPick
              codes={fromCodes}
              selected={fromCode}
              onPick={setFromCode}
              label="Чем платит покупатель"
            />
          </div>
        </div>

        {/*
          Курс стоит на самой черте между отданным и полученным — там,
          где одно превращается в другое, и тем же приёмом, что в Mini
          App. Рядом разворот направления: у стойки просят то «дай
          монету за рубли», то обратное, и разворот короче двух выборов.
          Кнопка гаснет, когда обратного направления нет вовсе: батов
          сервис не принимает, и менять RUB → THB местами не на что.
        */}
        <div className="calc__divider">
          <button
            type="button"
            className="calc__swap"
            onClick={swap}
            disabled={!canSwap}
            aria-label={canSwap ? 'Поменять местами' : 'Обратного направления нет'}
            title={canSwap ? 'Поменять местами' : 'Обратного направления нет'}
          >
            <Icon name="swap" size={18} />
          </button>
          <span className={line.kind === 'rate' ? 'calc__rate' : 'calc__rate calc__rate--absent'}>
            {line.kind === 'rate'
              ? formatRate(line.rate, fromCode, toCode)
              : line.kind === 'from'
                ? `счёт от ${formatMoney(line.giveAtLeast, fromCode)}`
                : rate === null
                  ? 'курса сейчас нет'
                  : amount === null
                    ? ''
                    : 'спрашиваем курс…'}
          </span>
          <span className="calc__rule" />
        </div>

        <div className="calc__side">
          <span className="label">Покупатель получает</span>
          <div className="calc__line">
            <input
              className={amountClass(shown('buy'))}
              inputMode="decimal"
              autoComplete="off"
              value={shown('buy')}
              // Без курса считать обратно нечем: набор в этом поле
              // обещал бы пересчёт, которого не будет.
              readOnly={!rate}
              onChange={(event) => type('buy', event.target.value)}
              onBlur={() => settle('buy')}
              placeholder="0"
              aria-label={`Сумма в ${toCode}`}
            />
            {/*
              Валюту выбирают здесь же, в строке, где стоит её сумма:
              ряд кнопок над расчётом владелец убрал 22 сентября —
              «выбрать валюту прямо внутри, как в самом Mini App».
            */}
            <CurrencyPick
              codes={toCodes}
              selected={toCode}
              onPick={setToCode}
              label="Что получает покупатель"
            />
          </div>
        </div>
      </div>

      {/*
        Наценка — под расчётом и над верификацией, полем, а не кнопкой:
        так попросил владелец 22 сентября 2026, пройдя по ней четырежды.
        Оператору поля не показывают, но само число он видит: знать, из
        чего сложилась цена, продавцу нужно, менять её — нет.
      */}
      {canPrice ? (
        <MarkupPanel
          value={markup}
          onChange={typeMarkup}
          onSettle={settleMarkup}
          complaint={markupComplaint}
        />
      ) : markupBps > 0 ? (
        <p className="muted">Наценка кабинета: {markupPercent(markupBps)} %</p>
      ) : undefined}

      <label className="check">
        <input type="checkbox" checked={kyc} onChange={(event) => setKyc(event.target.checked)} />
        Требовать верификацию
        <span className="hint"> · покупатель подтвердит личность перед оплатой</span>
      </label>
    </>
  );

  const recentList = (
    <div className="recent">
      {/*
        «Все счета» стоит здесь, а не в заголовке страницы: уходят
        отсюда — из списка, который кончился восемью строками, — а не с
        экрана кассы вообще. В шапке страницы та же кнопка звала со
        всего экрана, включая момент, когда счёт ещё создают.
      */}
      <div className="recent__head">
        <span className="recent__name">
          <span className="card__title">Последние счета</span>
          <span className="recent__live" aria-label="обновляется само">
            <span className="recent__dot" aria-hidden /> live
          </span>
        </span>
        <Link className="btn btn--soft btn--tiny" href="/invoices">
          Все счета
        </Link>
      </div>
      {recent.length === 0 ? (
        <p className="muted">Счетов ещё не было: первый появится здесь.</p>
      ) : (
        <ul className="rows rows--tight">
          {recent.map((one) => (
            <li key={one.id} className="row">
              <button
                type="button"
                className="recent__row"
                onClick={() => void load(one.id)}
                aria-current={open?.invoice.id === one.id ? 'true' : undefined}
              >
                <span className="row__main">
                  <span className="row__title">{formatMoney(one.payAmount, one.payCode)}</span>
                  <span className="row__meta">
                    {one.number} · {formatMoney(one.amount, one.code)} ·{' '}
                    <Moment at={one.createdAt} />
                    {one.demo ? ' · пример' : ''}
                  </span>
                </span>
                <span className={`pill pill--${INVOICE_STATUS_TONES[one.status]}`}>
                  {INVOICE_STATUS_LABELS[one.status]}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  const payment = open ? (
    <div className="pay" aria-live="polite">
      <span className="pos__label">Счёт {open.invoice.number}</span>
      {open.invoice.status === 'paid' ? (
        <>
          <span className="pay__state pay__state--paid">Оплачено!</span>
          <span className="pos__value">
            {formatMoney(open.invoice.payAmount, open.invoice.payCode)}
          </span>
          <span className="pos__equal">
            за {formatMoney(open.invoice.amount, open.invoice.code)}
            {open.invoice.paidAt ? (
              <>
                {' '}
                · <Moment at={open.invoice.paidAt} />
              </>
            ) : undefined}
          </span>
        </>
      ) : open.invoice.status === 'issued' ? (
        <>
          <span className="pos__value">
            {formatMoney(open.invoice.payAmount, open.invoice.payCode)}
          </span>
          <span className="pos__equal">
            за {formatMoney(open.invoice.amount, open.invoice.code)}
          </span>
          {open.qr ? (
            <img
              className="pay__qr"
              // Адрес меняется вместе с окном QR: браузер сам перечитывает картинку.
              src={`/api/pos/invoices/${open.invoice.id}/qr?at=${encodeURIComponent(open.qr.issuedAt)}`}
              alt={`QR для оплаты счёта ${open.invoice.number} (${provider.title.toLowerCase()})`}
              width={220}
              height={220}
            />
          ) : undefined}
          <span className="pay__note">
            {provider.imitation ? 'QR ненастоящий: платёж принимает имитация. ' : ''}
            {qrLeft !== null ? `QR обновится через ${mmss(qrLeft)}. ` : ''}
            {invoiceLeft !== null
              ? `Счёт действует ещё ${mmss(invoiceLeft)}.`
              : `Счёт действует ${ttlMinutes} мин.`}
          </span>
          {open.invoice.kycRequired ? (
            <span className="hint">Покупатель подтвердит личность перед оплатой</span>
          ) : undefined}
        </>
      ) : (
        <>
          <span className="pay__state">
            {open.invoice.status === 'expired' ? 'Срок оплаты вышел' : 'Счёт отменён'}
          </span>
          <span className="pos__value">
            {formatMoney(open.invoice.payAmount, open.invoice.payCode)}
          </span>
          <span className="pos__equal">
            за {formatMoney(open.invoice.amount, open.invoice.code)}
          </span>
        </>
      )}

      {complaint ? <p className="error">{complaint}</p> : undefined}

      <div className="actions">
        {open.invoice.status === 'issued' && provider.imitation ? (
          asking === 'imitate' ? (
            <div className="actions__ask">
              <p className="muted">
                Это имитация: денег не будет, счёт станет оплаченным. У банка это место займёт его
                сообщение об оплате.
              </p>
              <button
                type="button"
                className="btn btn--gold"
                aria-busy={busy}
                onClick={() => void act(`/api/pos/invoices/${open.invoice.id}/imitate`, {})}
              >
                Да, покупатель заплатил
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setAsking(undefined)}
                disabled={busy}
              >
                Не сейчас
              </button>
            </div>
          ) : (
            <button type="button" className="btn btn--gold" onClick={() => setAsking('imitate')}>
              Покупатель заплатил
            </button>
          )
        ) : undefined}

        {open.invoice.status === 'issued' ? (
          asking === 'cancel' ? (
            <div className="actions__ask">
              <p className="muted">Отменённый счёт назад не возвращается.</p>
              <button
                type="button"
                className="btn btn--danger"
                aria-busy={busy}
                onClick={() =>
                  void act(`/api/pos/invoices/${open.invoice.id}`, {
                    status: 'cancelled',
                  })
                }
              >
                Да, отменить
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setAsking(undefined)}
                disabled={busy}
              >
                Не надо
              </button>
            </div>
          ) : (
            <button type="button" className="btn btn--ghost" onClick={() => setAsking('cancel')}>
              Отменить счёт
            </button>
          )
        ) : undefined}

        <button type="button" className="btn btn--soft" onClick={next}>
          Следующий покупатель
        </button>
        <Link className="btn btn--ghost" href={`/invoices/${open.invoice.id}`}>
          Открыть счёт
        </Link>
      </div>
    </div>
  ) : undefined;

  return (
    <>
      {/*
        Объяснение — в клиентской части, как у табло курсов: оно идёт на
        тех числах, которые сейчас набраны в терминале, а они живут здесь.
      */}
      <HowTo
        title="Как это устроено"
        sub="Путь денег покупателя на живых числах"
        items={POS_HOW_TO}
      >
        <PosPath
          fromCode={fromCode}
          toCode={toCode}
          quote={rate}
          typed={amount}
          side={side}
          markupBps={liveMarkupBps}
          minAmount={Money.toAmount(minAmount)}
          payDecimals={payDecimals}
        />
      </HowTo>

      <section className="card">
        <div className="pos__layout">
          <div className="pos__main">
            {payment ?? (
              <>
                {form}

                {complaint ? <p className="error">{complaint}</p> : undefined}

                <div className="pos__actions">
                  <button
                    type="button"
                    className="btn btn--gold"
                    disabled={!ready}
                    aria-busy={busy}
                    onClick={() => void issue()}
                  >
                    {busy ? 'Создаём…' : 'Создать счёт'}
                  </button>
                  <span className="muted">
                    создал {authorName} · за смену {made}
                  </span>
                </div>
              </>
            )}
          </div>
          <aside className="pos__side">{recentList}</aside>
        </div>
      </section>
    </>
  );
}

/**
 * «4:59» из миллисекунд, дольше часа — «1:02:08»; отрицательное — ноль:
 * отсчёт не уходит в минус.
 */
function mmss(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const tail = `${String(minutes).padStart(hours > 0 ? 2 : 1, '0')}:${String(seconds).padStart(2, '0')}`;
  return hours > 0 ? `${hours}:${tail}` : tail;
}

/**
 * Звук на исход — короткий и разный: у стойки на экран не смотрят, там
 * смотрят на покупателя. Звук синтезируется, а не везётся файлом:
 * два тона не стоят запроса по сети.
 */
function beep(good: boolean): void {
  try {
    const Ctor =
      window.AudioContext ??
      (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = good ? 880 : 220;
    gain.gain.value = 0.05;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
    osc.onended = () => void ctx.close();
  } catch {
    // Звука может не быть вовсе — политика автовоспроизведения, немой
    // планшет. Исход при этом виден на экране, и падать тут не за чем.
  }
}
