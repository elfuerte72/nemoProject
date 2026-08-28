import type { RatePair, RateQuote, RateSource } from '@nemo/core';
import { Money } from '@nemo/types';

/**
 * Пары, у которых курс задан определением, а не рынком.
 *
 * USDT для сервиса — доллар: так записано в ТЗ владельца от 29 августа
 * 2026 на доллар («USDT принимается как эквивалент USD в расчёте,
 * отдельная конвертация USDT → USD не требуется»), и так же — с самого
 * начала — считаются все валюты выдачи, у которых прямой цены к USDT не
 * котирует никто (docs/adr/0007). Единица здесь не чья-то котировка, а
 * правило, и брать её у провайдера значило бы отдать правило на откуп
 * тому, кто в этот день ответил первым: до 29 августа доллар шёл со
 * стакана HTX, где верх занят приманками по 1,20 $ за монету, и медиана
 * держалась на единице ровно до третьей приманки с историей.
 *
 * Поэтому источник без сети и без снимков: у единицы нет ни свежести,
 * ни устаревания, и молчать ей не с чего. Стоит в цепочке первым —
 * пару, заданную определением, не переопределяет ни одна площадка,
 * даже если однажды начнёт её котировать.
 *
 * Отметка времени — та, на которую спросили: подача заявки просит курс
 * «на тогда», и единица на тогда была той же единицей. Без отметки —
 * сейчас.
 */
export type Pegs = Readonly<Record<string, string>>;

/** Привязки сервиса: стейблкоин → валюта, которой он считается. */
export const SERVICE_PEGS: Pegs = { USDT: 'USD' };

export function createPeggedRateSource(pegs: Pegs = SERVICE_PEGS): RateSource {
  const pairs = new Set<string>();
  for (const [coin, currency] of Object.entries(pegs)) {
    pairs.add(`${coin.toUpperCase()}/${currency.toUpperCase()}`);
    // Обе стороны: приравнены друг к другу, а не одна к другой.
    pairs.add(`${currency.toUpperCase()}/${coin.toUpperCase()}`);
  }

  return {
    async quote(pair: RatePair, at?: Date): Promise<RateQuote | null> {
      const key = `${pair.fromCode.toUpperCase()}/${pair.toCode.toUpperCase()}`;
      if (!pairs.has(key)) return null;
      return { rate: Money.toAmount('1'), asOf: at ?? new Date() };
    },
  };
}
