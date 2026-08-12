import { describe, expect, it } from 'vitest';
import { Money } from './index.js';
import { netAfterFee, usdForNet, type FeeTier } from './fee.js';

/**
 * Обратный счёт по сетке: сколько отдать, чтобы после комиссии осталось
 * не меньше названного.
 *
 * Вопрос звучит не реже прямого — с ним приходят за суммой брони, счёта
 * или билета, — но со ступенями он перестаёт быть делением. Ставка
 * берётся от всей суммы, поэтому выдача на границах скачет: часть сумм
 * получения достижима двумя разными способами, часть — ни одним. Правило
 * одно: берём наименьшую сумму, при которой клиент получает не меньше,
 * чем просил.
 */

const BANK: readonly FeeTier[] = [
  { upToUsd: Money.toAmount('500'), fixedUsd: Money.toAmount('5') },
  { upToUsd: Money.toAmount('2000'), rateBps: 450 },
  { upToUsd: Money.toAmount('5000'), rateBps: 350 },
  { upToUsd: null, rateBps: 250 },
];

/** Что получит клиент, отдав столько. Тем же кодом, что и в прямом счёте. */
function net(usd: string): ReturnType<typeof Money.toAmount> {
  return netAfterFee(Money.toAmount(usd), BANK);
}

describe('обратный счёт по сетке', () => {
  it('на нижней ступени добавляет фиксированную ставку', () => {
    // Просит 495 — отдать надо 500: пять долларов заберёт комиссия.
    expect(usdForNet(Money.toAmount('495'), BANK)).toBe('500');
  });

  it('на процентной ступени делит с запасом вверх', () => {
    // Просит 955: 955 / 0,955 — ровно тысяча.
    expect(usdForNet(Money.toAmount('955'), BANK)).toBe('1000');
  });

  it('никогда не даёт меньше запрошенного', () => {
    // Главное свойство: клиент, просивший ровно столько, столько и
    // получает — или больше на хвост округления, но не меньше.
    for (const target of ['100', '495', '500', '955', '1000', '1910', '1930', '4825']) {
      const usd = usdForNet(Money.toAmount(target), BANK);
      expect(usd).not.toBeNull();
      expect(Money.compare(net(usd!), Money.toAmount(target))).toBeGreaterThanOrEqual(0);
    }
  });

  it('перепрыгивает провал на границе ступени', () => {
    // За 495 долларов нетто следующая достижимая сумма — не 496:
    // ступень меняется, и весь промежуток до 518,32 даёт меньше. Клиент,
    // просящий 500 нетто, отдаёт 523,57 — а не 505, как вышло бы
    // делением по нижней ступени.
    const usd = usdForNet(Money.toAmount('500'), BANK);

    expect(Money.compare(usd!, Money.toAmount('500'))).toBeGreaterThan(0);
    expect(Money.compare(net(usd!), Money.toAmount('500'))).toBeGreaterThanOrEqual(0);
  });

  it('берёт наименьшую из подходящих сумм, а не первую попавшуюся', () => {
    // 1 930 нетто достижимо и на третьей ступени (2 001), и на любой
    // сумме выше. Клиенту называется меньшая: отдать больше он всегда
    // успеет.
    const usd = usdForNet(Money.toAmount('1930'), BANK);

    expect(Money.compare(usd!, Money.toAmount('2100'))).toBeLessThan(0);
    expect(Money.compare(net(usd!), Money.toAmount('1930'))).toBeGreaterThanOrEqual(0);
  });

  it('не падает на ставке в сто процентов', () => {
    // Такую ставку пропускает ограничение базы, и администратор может
    // её ввести опечаткой. Обратный счёт делил на «единица минус
    // ставка» — то есть на ноль, и экран падал вместо того, чтобы
    // сказать, что такой суммы не выйдет.
    const all: readonly FeeTier[] = [{ upToUsd: null, rateBps: 10_000 }];

    expect(usdForNet(Money.toAmount('50'), all)).toBeNull();
  });

  it('молчит о сумме, которой не бывает', () => {
    // Ноль и отрицательное — не сумма получения: вернуть на них число
    // значило бы предложить клиенту отдать деньги ни за что.
    expect(usdForNet(Money.toAmount('0'), BANK)).toBeNull();
  });
});
