import { describe, expect, it } from 'vitest';
import { Money } from './index.js';
import { netAfterFee, payoutAfterFee, usdForNet, usdForPayout, type FeeTier } from './fee.js';

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

/**
 * Обратный счёт по сетке с фиксом в валюте выдачи: вопрос звучит уже не
 * «сколько долларов останется», а «сколько отдать, чтобы вышло ровно N
 * евро» — фикс вычитается после курса, и в долларах его не выразить.
 */
const EUR: readonly FeeTier[] = [
  { upToUsd: Money.toAmount('2000'), rateBps: 330, fixedPayout: Money.toAmount('10') },
  { upToUsd: null, rateBps: 230, fixedPayout: Money.toAmount('10') },
];

const EUR_RATE = Money.toAmount('0.8649');

describe('обратный счёт с фиксом в валюте выдачи', () => {
  it('решает уравнение ступени с фиксом после курса', () => {
    // Ровно то, что даёт прямой счёт от тысячи долларов: 826,3583 € —
    // и обратно к той же тысяче.
    expect(usdForPayout(Money.toAmount('826.3583'), EUR_RATE, EUR)).toBe('1000');
  });

  it('решает и одним фиксом, без процента', () => {
    const flat: readonly FeeTier[] = [{ upToUsd: null, fixedPayout: Money.toAmount('10') }];

    // Восемьдесят евро при 0,9: (80 + 10) / 0,9 — ровно сто долларов.
    expect(usdForPayout(Money.toAmount('80'), Money.toAmount('0.9'), flat)).toBe('100');
  });

  it('никогда не даёт меньше запрошенного', () => {
    // Главное свойство прежнего счёта переживает фикс: недостачи нет.
    for (const target of ['1', '10', '80', '500', '826.3583', '1662.7166', '2525.0219', '9000']) {
      const usd = usdForPayout(Money.toAmount(target), EUR_RATE, EUR);
      expect(usd).not.toBeNull();
      expect(
        Money.compare(payoutAfterFee(usd!, EUR_RATE, EUR), Money.toAmount(target)),
      ).toBeGreaterThanOrEqual(0);
    }
  });

  it('на сетке без фикса в валюте выдачи совпадает со старым путём', () => {
    // Экран считал так: цель в валюте делится на курс, дальше старый
    // `usdForNet`. Новый счёт обязан давать те же суммы — иначе бат и
    // юань посчитались бы иначе, чем вчера.
    const rate = Money.toAmount('30');
    for (const target of ['14850', '15000', '28650', '57930']) {
      const value = Money.toAmount(target);
      const old = usdForNet(Money.divideCeil(value, rate, 8), BANK);
      expect(usdForPayout(value, rate, BANK)).toBe(old);
    }
  });

  it('молчит, когда курса нет или он нулевой', () => {
    // Делить на ноль нечем, а отрицательный курс — испорченные данные,
    // и выдумывать по ним сумму отдачи нельзя.
    expect(usdForPayout(Money.toAmount('100'), Money.toAmount('0'), EUR)).toBeNull();
    expect(usdForPayout(Money.toAmount('100'), Money.toAmount('-1'), EUR)).toBeNull();
  });

  it('не падает на ставке в сто процентов', () => {
    const all: readonly FeeTier[] = [
      { upToUsd: null, rateBps: 10_000, fixedPayout: Money.toAmount('10') },
    ];

    expect(usdForPayout(Money.toAmount('50'), EUR_RATE, all)).toBeNull();
  });

  it('молчит о сумме, которой не бывает', () => {
    expect(usdForPayout(Money.toAmount('0'), EUR_RATE, EUR)).toBeNull();
    expect(usdForPayout(Money.toAmount('-5'), EUR_RATE, EUR)).toBeNull();
  });
});

/** Доллар по ТЗ от 29 августа 2026: граница ступени — не включая. */
const USD: readonly FeeTier[] = [
  { upToUsd: Money.toAmount('2000'), rateBps: 450 },
  { upToUsd: null, rateBps: 350 },
];

const STRICT = { thresholdInclusive: false };

describe('обратный счёт с границей не включая', () => {
  it('на пороге отдаёт по верхней ступени', () => {
    // 1 930 нетто — это ровно 2 000 по 3,5 %; включительно две тысячи
    // считались бы по 4,5 % и давали 1 910.
    expect(usdForNet(Money.toAmount('1930'), USD, STRICT)).toBe('2000');
  });

  it('не обещает сумму, достижимую только на самой границе нижней ступени', () => {
    // 1 910 нетто: по 4,5 % это ровно две тысячи, но ровно две тысячи —
    // уже верхняя ступень. Чуть меньше двух тысяч дают меньше 1 910, а
    // две тысячи дают 1 930 — их и назвать.
    expect(usdForNet(Money.toAmount('1910'), USD, STRICT)).toBe('2000');
  });

  it('внутри нижней ступени делит как прежде', () => {
    expect(usdForNet(Money.toAmount('955'), USD, STRICT)).toBe('1000');
  });

  it('никогда не даёт меньше запрошенного', () => {
    for (const target of ['100', '955', '1909.99', '1910', '1929', '1930', '1931', '4825']) {
      const usd = usdForNet(Money.toAmount(target), USD, STRICT);
      expect(usd).not.toBeNull();
      expect(
        Money.compare(netAfterFee(usd!, USD, STRICT), Money.toAmount(target)),
      ).toBeGreaterThanOrEqual(0);
    }
  });
});
