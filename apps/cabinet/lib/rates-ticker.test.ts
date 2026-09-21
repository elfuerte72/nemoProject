import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Money, type ExchangeKind } from '@nemo/types';
import type { DirectionRate } from './direction-rates';
import { RATES_TICK_MS, resetRatesTicker, subscribeToRates } from './rates-ticker';

function direction(rate: string | null, quotedAt = '2026-09-21T10:00:00.000Z'): DirectionRate {
  return {
    fromCode: 'USDT',
    toCode: 'THB',
    rate: rate === null ? null : Money.toAmount(rate),
    quote: null,
    quotedAt,
    minAmountUsd: null,
  };
}

describe('тикер курсов', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetRatesTicker();
  });

  afterEach(() => {
    resetRatesTicker();
    vi.useRealTimers();
  });

  it('шлёт кадр только тогда, когда снимок изменился', async () => {
    const snapshots = [[direction('32.2')], [direction('32.2')], [direction('32.3')]];
    let taken = 0;
    const read = vi.fn(async () => snapshots[Math.min(taken++, snapshots.length - 1)]!);
    const frames: (readonly DirectionRate[])[] = [];

    subscribeToRates(read, 'electronic', (directions) => frames.push(directions));

    await vi.advanceTimersByTimeAsync(RATES_TICK_MS);
    expect(frames).toHaveLength(1);

    // Тот же курс и та же отметка: говорить не о чем.
    await vi.advanceTimersByTimeAsync(RATES_TICK_MS);
    expect(frames).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(RATES_TICK_MS);
    expect(frames).toHaveLength(2);
    expect(frames[1]?.[0]?.rate).toBe('32.3');
  });

  it('читает только те виды сделки, на которые смотрят', async () => {
    const seen: ExchangeKind[] = [];
    const read = vi.fn(async (kind: ExchangeKind) => {
      seen.push(kind);
      return [direction('32.2')];
    });

    subscribeToRates(read, 'electronic', () => {});
    await vi.advanceTimersByTimeAsync(RATES_TICK_MS);

    expect(seen).toEqual(['electronic']);
  });

  it('один обход на процесс, сколько бы вкладок ни смотрело', async () => {
    const read = vi.fn(async () => [direction('32.2')]);
    const first: number[] = [];
    const second: number[] = [];

    subscribeToRates(read, 'electronic', () => first.push(1));
    subscribeToRates(read, 'electronic', () => second.push(1));

    await vi.advanceTimersByTimeAsync(RATES_TICK_MS);

    expect(read).toHaveBeenCalledTimes(1);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
  });

  it('ушла последняя вкладка — тикер замолкает: процесс без зрителей базу не читает', async () => {
    const read = vi.fn(async () => [direction('32.2')]);
    const off = subscribeToRates(read, 'electronic', () => {});

    await vi.advanceTimersByTimeAsync(RATES_TICK_MS);
    expect(read).toHaveBeenCalledTimes(1);

    off();
    await vi.advanceTimersByTimeAsync(RATES_TICK_MS * 5);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('отказ чтения не рвёт подписку: следующий обход идёт как ни в чём не бывало', async () => {
    let attempt = 0;
    const read = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('база молчит');
      return [direction('32.4')];
    });
    const frames: (readonly DirectionRate[])[] = [];

    subscribeToRates(read, 'electronic', (directions) => frames.push(directions));

    await vi.advanceTimersByTimeAsync(RATES_TICK_MS);
    expect(frames).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(RATES_TICK_MS);
    expect(frames).toHaveLength(1);
  });
});
