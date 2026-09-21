import type { ExchangeKind } from '@nemo/types';
import type { DirectionRate } from './direction-rates';
import { sameRates } from './rate-board';

/**
 * Тикер курсов: кто смотрит на табло, тому сервер сам говорит, что
 * число сменилось.
 *
 * Один на процесс, а не на вкладку. Обход справочника стоит запросов к
 * базе, и десять открытых табло означали бы десять таких обходов в
 * минуту вместо одного. Наружу тикер при этом не ходит: котировки
 * лежат снимками в кэше `packages/rates`, который обновляет свой
 * таймер (docs/adr/0010), — здесь только чтение.
 *
 * Обходятся лишь те виды сделки, на которые кто-то подписан: пока
 * наличное табло никто не открыл, наличные направления не читаются. А
 * когда закрылась последняя вкладка, тикер останавливается совсем —
 * процесс без зрителей не должен молотить базу круглые сутки.
 *
 * Читать умеет не сам: чтение приходит зависимостью, и поэтому правило
 * «кадр уходит только при изменении» проверяется тестом без базы.
 */

/** Кому уходит кадр. */
export type RatesListener = (directions: readonly DirectionRate[]) => void;

/** Чем тикер читает справочник — обычно `listDirectionRates` поверх ядра. */
export type RatesReader = (kind: ExchangeKind) => Promise<readonly DirectionRate[]>;

/**
 * Как часто тикер перечитывает справочник.
 *
 * Полминуты — половина периода, с которым обновляется сам снимок
 * курса: чаще спрашивать нечего, снимок тот же, а вдвое реже значило
 * бы, что человек у экрана узнаёт новость с минутным опозданием.
 */
export const RATES_TICK_MS = 30_000;

interface Watch {
  readonly listeners: Set<RatesListener>;
  /** Последний разосланный снимок: с ним сравнивается прочитанное. */
  last: readonly DirectionRate[] | undefined;
}

interface Ticker {
  readonly watches: Map<ExchangeKind, Watch>;
  timer: ReturnType<typeof setInterval> | undefined;
  /** Обход ещё идёт: база медленнее тикера — второй заход только навредит. */
  reading: boolean;
}

const KEY = Symbol.for('nemo.cabinet.rates-ticker');

type Holder = typeof globalThis & { [KEY]?: Ticker };

/**
 * Тикер держится на `globalThis`, а не в переменной модуля: Next
 * пересобирает модули в разработке на каждую правку, и с переменной у
 * каждой сборки был бы свой таймер. То же правило, что у ядра.
 */
function ticker(): Ticker {
  const holder = globalThis as Holder;
  holder[KEY] ??= { watches: new Map(), timer: undefined, reading: false };
  return holder[KEY];
}

/**
 * Подписаться на обновления курсов одного вида сделки. Возвращает
 * отписку — её зовёт поток, когда вкладка ушла.
 */
export function subscribeToRates(
  read: RatesReader,
  kind: ExchangeKind,
  listener: RatesListener,
): () => void {
  const state = ticker();
  const watch = state.watches.get(kind) ?? { listeners: new Set<RatesListener>(), last: undefined };
  watch.listeners.add(listener);
  state.watches.set(kind, watch);

  if (!state.timer) {
    state.timer = setInterval(() => void tick(state, read), RATES_TICK_MS);
    // Таймер не должен держать процесс живым сам по себе: он служит
    // открытым вкладкам, а не наоборот.
    state.timer.unref?.();
  }

  return () => {
    watch.listeners.delete(listener);
    if (watch.listeners.size === 0) state.watches.delete(kind);
    if (state.watches.size === 0 && state.timer) {
      clearInterval(state.timer);
      state.timer = undefined;
    }
  };
}

/**
 * Один обход: прочитать то, на что смотрят, и разослать изменившееся.
 *
 * Молчание источника и отказ базы глотаются: табло живёт ещё и
 * таймером, и порванный обход — обычное дело, а не повод рвать
 * соединения всем, кто смотрит.
 */
async function tick(state: Ticker, read: RatesReader): Promise<void> {
  if (state.reading) return;
  state.reading = true;
  try {
    for (const [kind, watch] of [...state.watches]) {
      if (watch.listeners.size === 0) continue;
      let directions: readonly DirectionRate[];
      try {
        directions = await read(kind);
      } catch {
        continue;
      }
      if (watch.last && sameRates(watch.last, directions)) continue;
      watch.last = directions;
      for (const listener of watch.listeners) listener(directions);
    }
  } finally {
    state.reading = false;
  }
}

/** Только для теста: тикер живёт на `globalThis` и переживает файл теста. */
export function resetRatesTicker(): void {
  const state = ticker();
  if (state.timer) clearInterval(state.timer);
  state.timer = undefined;
  state.reading = false;
  state.watches.clear();
}
