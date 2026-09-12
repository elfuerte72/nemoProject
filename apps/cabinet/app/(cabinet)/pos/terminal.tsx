'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Money, rateLine, type Quote } from '@nemo/types';

/**
 * Котировка, как её отдаёт `/api/quote`: к цене приложена отметка
 * времени, и её же экран присылает обратно при выставлении счёта —
 * иначе счёт уходил бы по курсу, который пришёл между словами «пять
 * тысяч рублей» и нажатием. То же правило, что у подачи заявки.
 */
type QuoteReply = Quote & { readonly asOf: string };
import { formatAmount, formatMoney, formatRate, formatRateValue } from '@nemo/ui/format';
import { normalizeTyped, parseTyped } from '@/lib/new-request';
import { posSides, type PosSide } from '@/lib/pos';
import { send } from '@/app/ui/send';

/**
 * POS-терминал: покупатель называет валюту и сумму, мерчант выставляет
 * счёт.
 *
 * Цена берётся тем же путём, что на экране новой заявки, — курс на
 * направление перечитывается по кругу, стороны считает экран той же
 * арифметикой (`posSides` поверх `@nemo/types`). Двух правд о цене
 * быть не должно: покупатель у стойки и мерчант в кабинете смотрят на
 * одно число.
 *
 * Оплаты экран нигде не обещает: ни QR, ни «ждём платёж», ни срока.
 * Чем платит покупатель мерчанта, владелец ещё не назвал, и любой из
 * этих знаков читался бы как обещание сервиса.
 *
 * Режим кассы — не узкая вёрстка того же экрана, а полноэкранный режим
 * под палец на планшете у стойки: меню убрано, клавиатура крупная,
 * часы и счёт за смену на виду.
 */

const QUOTE_REFRESH_MS = 30_000;
/** Быстрые суммы в валюте оплаты: столько чаще всего и просят у стойки. */
const QUICK = ['1000', '3000', '5000', '10000'];
/** Цель нажатия в режиме кассы — не меньше сорока восьми точек. */
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'];

export interface PosDirection {
  readonly fromCode: string;
  readonly toCode: string;
  readonly rate: string | null;
}

export function Terminal({
  directions,
  shift,
  merchantName,
  minAmount,
}: {
  readonly directions: readonly PosDirection[];
  /** Сколько счетов уже выставлено за сегодня — счётчик смены. */
  readonly shift: number;
  readonly merchantName: string;
  /** Минимум сервиса в долларах: по нему черта курса решает, что сказать. */
  readonly minAmount: string;
}) {
  const router = useRouter();
  const first = directions[0];
  const [toCode, setToCode] = useState(first?.toCode ?? '');
  const [side, setSide] = useState<PosSide>('pay');
  const [typed, setTyped] = useState('');
  const [purpose, setPurpose] = useState('');
  const [buyer, setBuyer] = useState('');
  const [busy, setBusy] = useState(false);
  const [complaint, setComplaint] = useState<string>();
  const [made, setMade] = useState(shift);
  const [desk, setDesk] = useState(false);

  const direction = directions.find((one) => one.toCode === toCode) ?? first;
  const fromCode = direction?.fromCode ?? 'RUB';

  /* Курс — на направление, не на сумму; перечитывается по кругу. */
  const pairKey = `${fromCode}/${toCode}`;
  const [quote, setQuote] = useState<{ pair: string; view: QuoteReply | null }>();
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
          // выставить, и об этом сказано словами.
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

  const sides = useMemo(
    () => posSides(parseTyped(typed), side, rate ?? null),
    [typed, side, rate],
  );
  const ready = sides.buy !== null && sides.pay !== null && !busy;

  /*
   * Что стоит на черте, решает `rateLine` — то же правило, что на
   * экране новой заявки и в `GET /api/v1/rates`. Голый `quote.rate`
   * сюда не годится: у направления со ступенчатой сеткой курс выводится
   * из посчитанной выдачи, и в котировке он пуст.
   */
  const line = rate
    ? rateLine(rate, sides.pay, Money.toAmount(minAmount))
    : ({ kind: 'none' } as const);

  async function issue(): Promise<void> {
    if (!ready) return;
    setComplaint(undefined);
    setBusy(true);
    const reply = await send('/api/pos/invoices', {
      from: fromCode,
      to: toCode,
      side,
      amount: typed,
      purpose,
      buyer,
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
    setPurpose('');
    setBuyer('');
    // В режиме кассы со стойки никуда не уходят: следующий покупатель
    // уже стоит. Из кабинета — сразу в счёт, там его и смотрят.
    if (!desk) {
      const id = (reply.data as { invoice?: { id?: string } }).invoice?.id;
      if (id) router.push(`/invoices/${id}`);
      else router.refresh();
    }
  }

  const body = (
    <>
      <div className="chips">
        {directions.map((one) => (
          <button
            key={one.toCode}
            type="button"
            className={one.toCode === toCode ? 'chip chip--on' : 'chip'}
            onClick={() => setToCode(one.toCode)}
            aria-pressed={one.toCode === toCode}
          >
            {one.toCode}
            {/*
              Курс на плитке — крупной стороной и до сотых, тем же
              правилом, что у клиента и у менеджера (`readRate` из
              `@nemo/types`). Сырое число «0,053964632059326866» у
              стойки не читается вовсе.
            */}
            {one.rate ? <span className="chip__rate">{formatRateValue(one.rate)}</span> : undefined}
          </button>
        ))}
      </div>
      {/*
        На плитках курс для наименьшей суммы — тот же, что в разделе
        «Курсы». Со ступенчатой сеткой он зависит от суммы, и на
        набранную выходит другим; сказать об этом надо здесь, иначе два
        разных числа на одном экране читаются как ошибка.
      */}
      <p className="hint">
        На плитках курс для наименьшей суммы. Чем крупнее счёт, тем он выгоднее покупателю —
        точный виден под суммой.
      </p>

      <div className="pos__sum">
        <div className="pos__field">
          <div className="chips chips--tight">
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
            className="input input--big"
            inputMode="decimal"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            onBlur={() => setTyped(normalizeTyped(typed))}
            placeholder="0"
            aria-label={`Сумма в ${side === 'pay' ? fromCode : toCode}`}
          />
          <div className="chips chips--tight">
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

        <div className="pos__total">
          <span className="pos__label">Покупатель заплатит</span>
          <span className="pos__value">
            {sides.pay ? formatMoney(sides.pay, fromCode) : '—'}
          </span>
          <span className="pos__equal">
            {sides.buy ? `получит ${formatMoney(sides.buy, toCode)}` : 'наберите сумму'}
          </span>
          <span className="pos__rate" aria-live="polite">
            {line.kind === 'rate'
              ? formatRate(line.rate, fromCode, toCode)
              : line.kind === 'from'
                ? `счёт от ${formatMoney(line.giveAtLeast, fromCode)}`
                : rate === null
                  ? 'курса сейчас нет — счёт по нему не выставить'
                  : 'спрашиваем курс…'}
          </span>
        </div>
      </div>
    </>
  );

  if (desk) {
    /*
     * Порталом в `body`, а не на месте: у оболочки кабинета есть свои
     * преобразования, и для `position: fixed` любое из них становится
     * системой отсчёта — режим кассы разворачивался бы внутри колонки
     * раздела, рядом с меню. Тем же приёмом и по той же причине уходит
     * нижний лист Mini App.
     */
    return portal(
      <div className="desk">
        <div className="desk__bar">
          <Clock />
          <span className="desk__shift">за смену: {made}</span>
          <div className="desk__actions">
            <button type="button" className="btn btn--soft" onClick={() => setDesk(false)}>
              Свернуть
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                setDesk(false);
                router.push('/invoices');
              }}
            >
              Выйти
            </button>
          </div>
        </div>

        <div className="desk__body">
          {body}
          <div className="desk__keys">
            {KEYS.map((key) => (
              <button
                key={key}
                type="button"
                className="desk__key"
                onClick={() =>
                  setTyped((one) =>
                    key === '⌫' ? one.slice(0, -1) : key === '.' && one.includes(',') ? one : one + (key === '.' ? ',' : key),
                  )
                }
              >
                {key}
              </button>
            ))}
          </div>
          {complaint ? <p className="error">{complaint}</p> : undefined}
          <button
            type="button"
            className="btn btn--gold btn--wide"
            disabled={!ready}
            aria-busy={busy}
            onClick={() => void issue()}
          >
            {busy ? 'Выставляем…' : 'Выставить счёт'}
          </button>
        </div>
      </div>,
    );
  }

  return (
    <section className="card">
      {body}

      <div className="pos__about">
        <label className="field">
          <span className="label">Назначение</span>
          <input
            className="input"
            value={purpose}
            onChange={(event) => setPurpose(event.target.value)}
            placeholder="За что платят"
            maxLength={200}
          />
        </label>
        <label className="field">
          <span className="label">Покупатель</span>
          <input
            className="input"
            value={buyer}
            onChange={(event) => setBuyer(event.target.value)}
            placeholder="Имя или телефон"
            maxLength={200}
          />
        </label>
      </div>

      {complaint ? <p className="error">{complaint}</p> : undefined}

      <div className="pos__actions">
        <button
          type="button"
          className="btn btn--gold"
          disabled={!ready}
          aria-busy={busy}
          onClick={() => void issue()}
        >
          {busy ? 'Выставляем…' : 'Выставить счёт'}
        </button>
        <button type="button" className="btn btn--soft" onClick={() => setDesk(true)}>
          Режим кассы
        </button>
        <span className="muted">
          выставил {merchantName} · за смену {made}
        </span>
      </div>
    </section>
  );
}

/**
 * Узел поверх всего — в `body`. На сервере рисовать нечего: режим
 * включают нажатием, и до него ничего не показано.
 */
function portal(node: React.ReactNode): React.ReactPortal | null {
  return typeof document === 'undefined' ? null : createPortal(node, document.body);
}

/** Часы у стойки: время печатает браузер, а не сервер — тот живёт в UTC. */
function Clock() {
  const [now, setNow] = useState<string>('');
  useEffect(() => {
    const tick = () =>
      setNow(new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }));
    tick();
    const timer = setInterval(tick, 10_000);
    return () => clearInterval(timer);
  }, []);
  return <span className="desk__clock">{now}</span>;
}

/**
 * Звук на исход — короткий и разный: у стойки на экран не смотрят, там
 * смотрят на покупателя. Звук синтезируется, а не везётся файлом:
 * два тона не стоят запроса по сети.
 */
function beep(good: boolean): void {
  try {
    const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
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
