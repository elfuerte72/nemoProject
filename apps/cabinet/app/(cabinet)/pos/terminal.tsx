'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CurrencyFlag } from '@nemo/flags';
import { currencyName, Money, type Quote } from '@nemo/types';
import { HowTo, LIVE_REFRESH_MS, Moment, shouldRefresh } from '@nemo/ui';
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
import { markupPercent } from '@/lib/pos/settings';
import { POS_STREAM_PATH } from '@/lib/pos/stream';
import { POS_HOW_TO } from '@/lib/pos-texts';
import { send } from '@/app/ui/send';
import { PosPath } from './explainer';

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
 * Валюта выбирается теми же кнопками, что на табло «Курсов», — флаг и
 * код: 22 сентября 2026 владелец попросил «вместо кнопок с валютами
 * использовать кнопки, которые есть в приложении и на странице
 * „Курсы“». Курса на кнопке нет — он стоит под суммой, там, где
 * считается. Полей «Назначение» и «Покупатель» нет с того же дня по
 * его слову: у стойки их никто не заполнял.
 *
 * Итог — две суммы одного веса: сколько покупатель платит и сколько
 * получает. У стойки вслух называют обе, и мельче одна другой быть не
 * должна; курс между ними — подпись, а не третье число.
 *
 * После «Создать счёт» на месте формы встаёт сам счёт: QR, обратный
 * отсчёт, что с ним стало. Об оплате говорит поток событий
 * (`/api/pos/stream`), и экран отвечает звуком: у стойки смотрят на
 * покупателя, а не на планшет. QR ненастоящий, платёж принимает
 * имитация, и «Покупатель заплатил» — та кнопка, вместо которой у банка
 * будет вебхук; на экране это сказано словами.
 *
 * Полноэкранного «вида терминала» больше нет: владелец попросил убрать
 * его целиком 22 сентября 2026.
 */

const QUOTE_REFRESH_MS = 30_000;
/** Быстрые суммы в валюте оплаты: столько чаще всего и просят у стойки. */
const QUICK = ['1000', '3000', '5000', '10000'];

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
  /** Наценка мерчанта из настроек кабинета. */
  readonly markupBps: number;
  /** Смотрящий вправе менять наценку — ему показывается дорога в настройки. */
  readonly canPrice: boolean;
  /** Сколько минут счёт ждёт оплаты. */
  readonly ttlMinutes: number;
  readonly provider: { readonly title: string; readonly imitation: boolean };
  readonly recent: readonly RecentInvoice[];
}) {
  const router = useRouter();
  const first = directions[0];
  const [toCode, setToCode] = useState(first?.toCode ?? '');
  const [side, setSide] = useState<PosSide>('pay');
  const [typed, setTyped] = useState('');
  const [kyc, setKyc] = useState(false);
  const [busy, setBusy] = useState(false);
  const [complaint, setComplaint] = useState<string>();
  const [made, setMade] = useState(shift);
  const [open, setOpen] = useState<OpenView>();
  const [asking, setAsking] = useState<'cancel' | 'imitate'>();
  const [tick, setTick] = useState(() => Date.now());

  // Счётчик смены сервер знает точнее: после перечитывания его слово главнее.
  useEffect(() => setMade(shift), [shift]);

  // Направление пропало из справочника — терминал переходит на первое.
  useEffect(() => {
    if (!directions.some((one) => one.toCode === toCode)) setToCode(first?.toCode ?? '');
  }, [directions, toCode, first]);

  const direction = directions.find((one) => one.toCode === toCode) ?? first;
  const fromCode = direction?.fromCode ?? 'RUB';

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

  const amount = parseTyped(typed);
  const sides = useMemo(
    () => posSides(amount, side, rate ?? null, markupBps),
    [amount, side, rate, markupBps],
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
    ? posRateLine(rate, sides.pay, Money.toAmount(minAmount), markupBps)
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

  const form = (
    <>
      {/*
        Валюта — теми же кнопками, что на табло «Курсов»: флаг и код.
        Подпись над рядом видимая, а не в `aria-label`: кнопки без
        подписи отвечают «что есть», а не «что выбрать».
      */}
      <div className="field">
        <span className="label">Покупатель получает</span>
        <div className="chips">
          {directions.map((one) => (
            <button
              key={one.toCode}
              type="button"
              className={
                one.toCode === toCode ? 'chip chip--currency chip--on' : 'chip chip--currency'
              }
              onClick={() => setToCode(one.toCode)}
              aria-pressed={one.toCode === toCode}
              title={currencyName(one.toCode)}
            >
              <CurrencyFlag code={one.toCode} size={16} />
              {one.toCode}
            </button>
          ))}
        </div>
      </div>

      <div className="pos__field">
        <label className="label" htmlFor="pos-amount">
          Сумма
        </label>
        <div className="chips chips--tight" role="group" aria-label="В какой валюте набираете">
          <button
            type="button"
            className={side === 'pay' ? 'chip chip--on' : 'chip'}
            onClick={() => setSide('pay')}
            aria-pressed={side === 'pay'}
          >
            В {fromCode}
          </button>
          <button
            type="button"
            className={side === 'buy' ? 'chip chip--on' : 'chip'}
            onClick={() => setSide('buy')}
            aria-pressed={side === 'buy'}
          >
            В {toCode}
          </button>
        </div>
        <input
          id="pos-amount"
          className="input input--big"
          inputMode="decimal"
          autoComplete="off"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          onBlur={() => setTyped(normalizeTyped(typed))}
          placeholder="0"
        />
        <div className="chips chips--tight" role="group" aria-label={`Быстрые суммы в ${fromCode}`}>
          {QUICK.map((one) => (
            <button
              key={one}
              type="button"
              className="chip"
              onClick={() => {
                setSide('pay');
                setTyped(formatAmount(one));
              }}
            >
              {formatAmount(one)}
            </button>
          ))}
        </div>
      </div>

      {/*
        Две суммы одного размера: обе называют покупателю вслух, и
        мельче одна другой быть не должна. Подписи стоят своей строкой
        сетки, значения своей — иначе подпись из двух слов роняет своё
        число ниже соседнего. Курс — строкой под ними и тусклым, а не
        акцентом: акцентный цвет в кабинете означает «нажми» и «ждёт
        тебя», а курс ни то ни другое.
      */}
      <div className="pos__deal" aria-live="polite">
        <span className="pos__label pos__deal-paylabel">Покупатель заплатит</span>
        <span className="pos__amount pos__deal-payvalue">
          {sides.pay ? formatMoney(sides.pay, fromCode) : '—'}
        </span>
        <span className="pos__deal-arrow" aria-hidden>
          →
        </span>
        <span className="pos__label pos__deal-getlabel">Получит</span>
        <span className="pos__amount pos__deal-getvalue">
          {sides.buy ? formatMoney(sides.buy, toCode) : '—'}
        </span>
        <span className="pos__deal-rate">
          {line.kind === 'rate'
            ? `по курсу ${formatRate(line.rate, fromCode, toCode)}${markupBps > 0 ? ` · с наценкой ${markupPercent(markupBps)} %` : ''}`
            : line.kind === 'from'
              ? `счёт от ${formatMoney(line.giveAtLeast, fromCode)}`
              : rate === null
                ? 'курса сейчас нет — счёт по нему не создать'
                : amount === null
                  ? 'наберите сумму'
                  : 'спрашиваем курс…'}
        </span>
      </div>

      <label className="check">
        <input type="checkbox" checked={kyc} onChange={(event) => setKyc(event.target.checked)} />
        Требовать верификацию
        <span className="hint"> · покупатель подтвердит личность перед оплатой</span>
      </label>
    </>
  );

  const recentList = (
    <div className="recent">
      <div className="recent__head">
        <span className="card__title">Последние счета</span>
        <span className="recent__live" aria-label="обновляется само">
          <span className="recent__dot" aria-hidden /> live
        </span>
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
          markupBps={markupBps}
          minAmount={Money.toAmount(minAmount)}
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
                    создал {authorName} · за смену {made} ·{' '}
                    {markupBps > 0 ? `наценка ${markupPercent(markupBps)} %` : 'без наценки'}
                    {canPrice ? (
                      <>
                        {' · '}
                        <Link href="/settings">изменить</Link>
                      </>
                    ) : undefined}
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
