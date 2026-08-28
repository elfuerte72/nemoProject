import { describe, expect, it } from 'vitest';
import { Money } from '@nemo/types';
import { slopComplaints } from '@nemo/core';
import { RATES_UNAVAILABLE, renderRatesMessage, type QuotedPair } from './rates-message';

/** Направление с курсом — так, как их отдаёт ядро. */
function pair(fromCode: string, toCode: string, rate: string): QuotedPair {
  return { fromCode, toCode, rate: Money.toAmount(rate) };
}

/** Девять валют справочника с правдоподобными курсами. */
const DIRECTORY: readonly QuotedPair[] = [
  pair('USDT', 'RUB', '81'),
  pair('RUB', 'USDT', '0.012048192771084337'),
  pair('USDT', 'THB', '32.4467'),
  pair('USDT', 'USD', '0.98'),
  pair('USDT', 'EUR', '0.8474'),
  pair('USDT', 'CNY', '7.0512'),
  pair('USDT', 'TRY', '40.2183'),
  pair('USDT', 'INR', '87.1544'),
  pair('USDT', 'ZAR', '18.3401'),
];

describe('renderRatesMessage', () => {
  it('называет обе стороны рублёвого обмена', () => {
    const message = renderRatesMessage({ quoted: DIRECTORY, hasCash: true });
    expect(message).toContain('Продаёте USDT по 81 ₽');
    // Курс «рубли → USDT» приходит мелкой стороной, а читается крупной.
    expect(message).toContain('Покупаете USDT по 83 ₽');
  });

  it('называет рубль с копейками — тем же числом, что на черте курса', () => {
    // Письмо владельца: продажа 85,5 − 2 % = 83,79, покупка хранится
    // частным от 87,25. Целого в сообщении больше нет.
    const message = renderRatesMessage({
      quoted: [pair('USDT', 'RUB', '83.79'), pair('RUB', 'USDT', '0.011461318051575931')],
      hasCash: false,
    });
    expect(message).toContain('Продаёте USDT по 83,79 ₽');
    expect(message).toContain('Покупаете USDT по 87,25 ₽');
  });

  it('ведёт столбец валют выдачи одной стороной — за монету', () => {
    const message = renderRatesMessage({ quoted: DIRECTORY, hasCash: true });
    // У валюты, которой за монету дают меньше одной, строка не
    // переворачивается: столбец читается сверху вниз.
    expect(message).toContain('🇪🇺 0,84 EUR · Еврозона');
    expect(message).toContain('🇺🇸 0,98 USD · США');
    expect(message).toContain('🇹🇭 32,44 THB · Таиланд');
    expect(message).toContain('🇿🇦 18,34 ZAR · ЮАР');
  });

  it('ставит валюты в том же порядке, что список выбора на экране', () => {
    const message = renderRatesMessage({ quoted: DIRECTORY, hasCash: false });
    const shown = [...message.matchAll(/^\S+ [\d,]+ ([A-Z]{3}) · /gmu)].map((match) => match[1]);
    expect(shown).toEqual(['CNY', 'EUR', 'INR', 'THB', 'TRY', 'USD', 'ZAR']);
  });

  it('о наличных говорит только там, где они есть', () => {
    expect(renderRatesMessage({ quoted: DIRECTORY, hasCash: true })).toContain(
      'их считает менеджер',
    );
    expect(renderRatesMessage({ quoted: DIRECTORY, hasCash: false })).not.toContain(
      'наличных',
    );
  });

  it('не заводит пустых блоков, когда известна одна котировка', () => {
    const message = renderRatesMessage({ quoted: [pair('USDT', 'RUB', '81')], hasCash: false });
    expect(message).toContain('Продаёте USDT');
    expect(message).not.toContain('Покупаете USDT');
    expect(message).not.toContain('Выдаём');
    expect(message).not.toContain('Другие направления');
  });

  it('показывает направление, не подходящее ни под рубль, ни под столбец', () => {
    const message = renderRatesMessage({
      quoted: [...DIRECTORY, pair('RUB', 'THB', '0.39')],
      hasCash: false,
    });
    expect(message).toContain('Другие направления');
    expect(message).toContain('🇷🇺 RUB → 🇹🇭 THB:');
  });

  it('не показывает валюту нулём, когда за монету дают доли единицы', () => {
    const message = renderRatesMessage({
      quoted: [pair('USDT', 'KWD', '0.003')],
      hasCash: false,
    });
    expect(message).toContain('0,003 KWD');
  });

  it('не оставляет в разметке знаков, которые Telegram примет за тег', () => {
    const message = renderRatesMessage({
      quoted: [pair('USDT', '<b', '3')],
      hasCash: false,
    });
    expect(message).toContain('&lt;b');
    expect(message).not.toContain('<b>&lt;b');
  });

  /*
   * Столбец курса — самое длинное, что бот присылает, и раньше каждая
   * его строка была связкой через длинное тире. Девять одинаковых
   * связок подряд читаются набранными машиной, а не человеком: правило
   * и жалобы к нему живут в `@nemo/core`.
   */
  it('не собирается в столбец одинаковых связок', () => {
    expect(slopComplaints(renderRatesMessage({ quoted: DIRECTORY, hasCash: true }))).toEqual(
      [],
    );
  });

  it('не собирается в столбец и вместе с блоком других направлений', () => {
    const message = renderRatesMessage({
      quoted: [...DIRECTORY, pair('RUB', 'THB', '0.39')],
      hasCash: true,
    });
    expect(slopComplaints(message)).toEqual([]);
  });

  it('говорит человеком и там, где курса нет вовсе', () => {
    expect(slopComplaints(RATES_UNAVAILABLE)).toEqual([]);
  });
});
