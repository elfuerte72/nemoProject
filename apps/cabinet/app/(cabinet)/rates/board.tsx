'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CurrencyFlag } from '@nemo/flags';
import {
  currencyName,
  currencyPlace,
  readRate,
  sortCurrencies,
  type Amount,
  type ExchangeKind,
} from '@nemo/types';
import { HowTo, Tabs } from '@nemo/ui';
import { formatAmount, formatMoney } from '@nemo/ui/format';
import { LIVE_HEARTBEAT_MS, shouldRefresh } from '@nemo/ui/live';
import { parseTyped } from '@/lib/new-request';
import {
  boardOf,
  flashes,
  pairKey,
  priceOn,
  quoteAge,
  sameRates,
  shownRate,
  type Flash,
} from '@/lib/rate-board';
import type { DirectionRate } from '@/lib/direction-rates';
import { COLUMN_HINTS, RATES_HOW_TO } from '@/lib/exchange-texts';
import { PathOfMoney } from './explainer';
import { ColumnHint } from './hint';

/**
 * Табло курсов: весь справочник одним списком, и число в нём меняется
 * само.
 *
 * Клиентское целиком, потому что клиентское здесь всё: курс приходит
 * потоком (`app/api/rates/stream`), возраст котировки считается по
 * часам браузера, а сумму, которую мерчант набирает, считает экран той
 * же арифметикой, что и ядро (`lib/rate-board.ts` поверх `@nemo/types`).
 * Сервер отдаёт первый снимок и уходит.
 */

/** Сколько держится подсветка изменившейся строки. */
const FLASH_MS = 1_400;

/** Как часто пересчитывается возраст котировки в строках. */
const CLOCK_MS = 20_000;

/**
 * Через сколько молчания поток считается мёртвым.
 *
 * Сервер дышит в него каждые `LIVE_HEARTBEAT_MS`; пропущенных подряд
 * два вдоха достаточно, чтобы не гадать. Соединение может стоять
 * открытым, а данные — не доходить: промежуточный узел, собравший
 * поток в буфер, выглядит с этой стороны живым.
 */
const SILENCE_MS = LIVE_HEARTBEAT_MS * 3;

export function RatesBoard({
  directions,
  minAmount,
  kind,
  hasCash,
}: {
  readonly directions: readonly DirectionRate[];
  /** Общий минимум сервиса: им меряется курс до набора суммы. */
  readonly minAmount: Amount;
  readonly kind: ExchangeKind;
  readonly hasCash: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<readonly DirectionRate[]>(directions);
  const [marks, setMarks] = useState<Readonly<Record<string, Flash>>>({});
  const [now, setNow] = useState(() => new Date());
  const [typed, setTyped] = useState('');
  /* Строка, на которой объяснение разбирает путь денег. */
  const [chosen, setChosen] = useState<string>();

  /*
   * Серверный снимок приезжает заново после каждого `router.refresh()`
   * — им табло и лечится, если поток не дошёл. Сравнение обязательно:
   * без него новый массив с теми же числами перерисовывал бы таблицу по
   * кругу.
   */
  useEffect(() => {
    setRows((current) => (sameRates(current, directions) ? current : directions));
  }, [directions]);

  /* Текущее состояние — ссылкой: кадр приходит в обработчик, заведённый
     один раз, и замыкание на состояние показывало бы ему старое. */
  const shown = useRef(rows);
  shown.current = rows;

  const apply = useCallback((next: readonly DirectionRate[]) => {
    const changed = flashes(shown.current, next);
    setRows(next);
    if (Object.keys(changed).length > 0) setMarks(changed);
  }, []);

  /* Подсветка гаснет сама: она говорит «вот это сейчас изменилось». */
  useEffect(() => {
    if (Object.keys(marks).length === 0) return;
    const timer = setTimeout(() => setMarks({}), FLASH_MS);
    return () => clearTimeout(timer);
  }, [marks]);

  /* Возраст котировки идёт по часам браузера: сервер живёт в UTC. */
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), CLOCK_MS);
    return () => clearInterval(timer);
  }, []);

  /*
   * Поток курсов и страховка к нему.
   *
   * Страховка не таймер «перечитывай раз в полминуты», а ответ на
   * молчание: пока сервер дышит, перечитывать нечего — он сам скажет,
   * когда число сменится. Замолчал дольше трёх вдохов — значит поток
   * не дошёл, и страницу перечитывает обычное обновление.
   */
  useEffect(() => {
    const heard = { at: Date.now() };
    const source = new EventSource(`/api/rates/stream?kind=${kind}`);

    source.addEventListener('open', () => {
      heard.at = Date.now();
    });
    source.addEventListener('ping', () => {
      heard.at = Date.now();
    });
    source.addEventListener('message', (message: MessageEvent<string>) => {
      heard.at = Date.now();
      try {
        const frame = JSON.parse(message.data) as { directions?: readonly DirectionRate[] };
        if (frame.directions) apply(frame.directions);
      } catch {
        // Кадр не разобрался — ждём следующего: битый кадр не повод
        // рвать соединение, а табло по-прежнему показывает прежнее.
      }
    });

    const watchdog = setInterval(() => {
      if (Date.now() - heard.at < SILENCE_MS) return;
      // Набранное на табло переживёт обновление: `router.refresh()`
      // перерисовывает серверную часть, не размонтируя клиентскую.
      if (
        !shouldRefresh({
          hidden: document.visibilityState === 'hidden',
          busy: false,
          typing: false,
        })
      ) {
        return;
      }
      heard.at = Date.now();
      router.refresh();
    }, LIVE_HEARTBEAT_MS);

    return () => {
      clearInterval(watchdog);
      source.close();
    };
  }, [kind, apply, router]);

  const board = useMemo(() => boardOf(rows), [rows]);

  /* Валюты, которые сервис принимает по этому виду сделки. */
  const fromCodes = useMemo(
    () => sortCurrencies([...new Set(board.rows.map((one) => one.fromCode))]),
    [board.rows],
  );
  const [fromCode, setFromCode] = useState<string>(() => fromCodes[0] ?? '');
  useEffect(() => {
    if (fromCodes.length > 0 && !fromCodes.includes(fromCode)) setFromCode(fromCodes[0]!);
  }, [fromCodes, fromCode]);

  const give = parseTyped(typed);
  /*
   * Строки той валюты, которую мерчант отдаёт. Поиска по валюте здесь
   * нет: направлений полтора десятка, они целиком на экране, и поле
   * поиска над ними только притворялось бы выбором валюты.
   */
  const visible = useMemo(
    () => board.rows.filter((one) => one.fromCode === fromCode),
    [board.rows, fromCode],
  );
  /*
   * Пример для объяснения: выбранная строка, а если её нет среди видимых
   * — сменили валюту отдачи — первая. Объяснять устройство удобнее на
   * той строке, за которой человек пришёл.
   */
  const example = visible.find((one) => pairKey(one) === chosen) ?? visible[0];

  return (
    <>
      <HowTo title="Как это устроено" sub="Путь ваших денег на живых числах" items={RATES_HOW_TO}>
        <PathOfMoney direction={example} typed={give} minAmount={minAmount} now={now} />
      </HowTo>

      {hasCash ? (
        <Tabs
          label="Вид сделки"
          items={[
            { href: '/rates', label: 'Переводом', current: kind === 'electronic' },
            { href: '/rates?kind=cash', label: 'Наличными', current: kind === 'cash' },
          ]}
        />
      ) : undefined}

      <RubleBlock block={board.ruble} now={now} marks={marks} />

      <div className="board__controls">
        <div className="field">
          <span className="label">Отдаёте</span>
          <div className="chips">
            {fromCodes.map((code) => (
              <button
                key={code}
                type="button"
                className={code === fromCode ? 'chip chip--on' : 'chip'}
                onClick={() => setFromCode(code)}
                aria-pressed={code === fromCode}
              >
                <CurrencyFlag code={code} size={16} />
                {code}
              </button>
            ))}
          </div>
        </div>

        <div className="field field--narrow">
          <label className="label" htmlFor="board-give">
            Сумма
          </label>
          <input
            id="board-give"
            className="input"
            inputMode="decimal"
            autoComplete="off"
            placeholder={`Сколько ${fromCode}`}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
          />
        </div>
      </div>

      {visible.length === 0 ? (
        <section className="card">
          <p className="muted">Направления обмена ещё не заведены. Загляните позже.</p>
        </section>
      ) : (
        <ul className={give ? 'table table--board table--board-sum' : 'table table--board'}>
          <li className="table__head">
            <span>Пара</span>
            <span>Курс</span>
            <span>
              {give ? 'Получите' : 'Минимум'}
              {give ? undefined : <ColumnHint {...COLUMN_HINTS.minimum} />}
            </span>
            <span>
              Котировка
              <ColumnHint {...COLUMN_HINTS.quotedAt} />
            </span>
          </li>
          {visible.map((one) => (
            <BoardRow
              key={pairKey(one)}
              direction={one}
              give={give}
              minAmount={minAmount}
              now={now}
              flash={marks[pairKey(one)]}
              chosen={example !== undefined && pairKey(one) === pairKey(example)}
              onChoose={() => setChosen(pairKey(one))}
            />
          ))}
        </ul>
      )}
    </>
  );
}

/**
 * Рублёвая пара: покупка, продажа и разница между ними.
 *
 * Отдельно от таблицы, потому что это единственное направление, где
 * сервис стоит по обе стороны: у остальных второй стороны не
 * существует, и «спред» у них был бы выдуманным числом.
 */
function RubleBlock({
  block,
  now,
  marks,
}: {
  readonly block: ReturnType<typeof boardOf>['ruble'];
  readonly now: Date;
  readonly marks: Readonly<Record<string, Flash>>;
}) {
  if (!block.sell && !block.buy) return null;

  return (
    <section className="card pairbox">
      <h2 className="card__title">USDT и рубль</h2>
      <div className="pairbox__sides">
        {block.sell ? (
          <PairSide
            title="Продаёте USDT"
            direction={block.sell}
            now={now}
            flash={marks[pairKey(block.sell)]}
          />
        ) : undefined}
        {block.buy ? (
          <PairSide
            title="Покупаете USDT"
            direction={block.buy}
            now={now}
            flash={marks[pairKey(block.buy)]}
          />
        ) : undefined}
        {block.spread ? (
          <div className="pairbox__side">
            <span className="label">Разница</span>
            <span className="pairbox__value">{formatAmount(block.spread)} %</span>
            <span className="cell__note">между покупкой и продажей</span>
          </div>
        ) : undefined}
      </div>
    </section>
  );
}

function PairSide({
  title,
  direction,
  now,
  flash,
}: {
  readonly title: string;
  readonly direction: DirectionRate;
  readonly now: Date;
  readonly flash: Flash | undefined;
}) {
  const value = shownRate(direction);
  return (
    <div className={flash ? `pairbox__side pairbox__side--${flash}` : 'pairbox__side'}>
      <span className="label">{title}</span>
      <span className="pairbox__value">
        {value ? `${formatAmount(value)} ₽` : 'курс назовёт менеджер'}
      </span>
      <span className="cell__note" suppressHydrationWarning>
        {quoteAge(direction.quotedAt, now) || 'за 1 USDT'}
      </span>
    </div>
  );
}

/**
 * Строка табло: пара, курс, что получат на набранную сумму и свежесть
 * котировки.
 *
 * Кнопки «обменять» в строке нет: заявки кабинет заводит интеграцией, а
 * не формой, и кнопка вела бы в никуда.
 */
function BoardRow({
  direction,
  give,
  minAmount,
  now,
  flash,
  chosen,
  onChoose,
}: {
  readonly direction: DirectionRate;
  readonly give: Amount | null;
  readonly minAmount: Amount;
  readonly now: Date;
  readonly flash: Flash | undefined;
  /** Эту строку разбирает объяснение над таблицей. */
  readonly chosen: boolean;
  readonly onChoose: () => void;
}) {
  const { line, payout } = priceOn(direction, give, minAmount);
  const reading = line.kind === 'rate' ? readRate(line.rate, direction.fromCode, direction.toCode) : null;

  return (
    <li
      className={[
        'table__item',
        'table__item--clickable',
        chosen ? 'table__item--chosen' : '',
        flash ? `table__item--${flash}` : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {/*
        Кнопка во всю строку, а не обработчик на `li`: нажатие выбирает
        строку для объяснения, и до него должны доходить с клавиатуры.
      */}
      <button
        type="button"
        className="table__row table__row--button"
        onClick={onChoose}
        aria-pressed={chosen}
      >
        <span className="cell">
          <span className="cell__label">Пара</span>
          <span className="pair">
            <span className="pair__marks">
              <CurrencyFlag code={direction.fromCode} size={22} />
              <CurrencyFlag code={direction.toCode} size={22} />
            </span>
            <span className="pair__names">
              <span className="cell__value">
                {direction.fromCode} → {direction.toCode}
              </span>
              <span className="cell__note">
                {currencyName(direction.toCode)}
                {currencyPlace(direction.toCode) ? ` · ${currencyPlace(direction.toCode)}` : ''}
              </span>
            </span>
          </span>
        </span>

        <span className="cell cell--num">
          <span className="cell__label">Курс</span>
          {reading ? (
            <>
              <span className="cell__value">{formatAmount(reading.value)}</span>
              <span className="cell__note">
                {reading.perCode} за 1 {reading.unitCode}
              </span>
            </>
          ) : line.kind === 'from' ? (
            <>
              <span className="cell__value">
                от {formatMoney(line.giveAtLeast, direction.fromCode)}
              </span>
              <span className="cell__note">столько нужно отдать</span>
            </>
          ) : (
            <span className="cell__value cell__value--quiet">назовёт менеджер</span>
          )}
        </span>

        <span className="cell cell--num">
          <span className="cell__label">{give ? 'Получите' : 'Минимум'}</span>
          {give ? (
            <span className="cell__value">
              {payout ? formatMoney(payout, direction.toCode) : '—'}
            </span>
          ) : (
            <span className="cell__value">
              {direction.minAmountUsd ? formatMoney(direction.minAmountUsd, '$') : '—'}
            </span>
          )}
        </span>

        <span className="cell">
          <span className="cell__label">Котировка</span>
          <span className="cell__value cell__value--quiet" suppressHydrationWarning>
            {quoteAge(direction.quotedAt, now) || '—'}
          </span>
        </span>
      </button>
    </li>
  );
}
