import { describe, expect, it } from 'vitest';
import { Money } from '@nemo/types';
import { renderRatesMessage, type QuotedPair } from './rates-message';

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
    expect(message).toContain('Продаёте USDT — 81 ₽ за 1 USDT');
    // Курс «рубли → USDT» приходит мелкой стороной, а читается крупной.
    expect(message).toContain('Покупаете USDT — 83 ₽ за 1 USDT');
  });

  it('ведёт столбец валют выдачи одной стороной — за монету', () => {
    const message = renderRatesMessage({ quoted: DIRECTORY, hasCash: true });
    // У валюты, которой за монету дают меньше одной, строка не
    // переворачивается: столбец читается сверху вниз.
    expect(message).toContain('🇪🇺 EUR · Еврозона — 0,84');
    expect(message).toContain('🇺🇸 USD · США — 0,98');
    expect(message).toContain('🇹🇭 THB · Таиланд — 32,44');
    expect(message).toContain('🇿🇦 ZAR · ЮАР — 18,34');
  });

  it('ставит валюты в том же порядке, что список выбора на экране', () => {
    const message = renderRatesMessage({ quoted: DIRECTORY, hasCash: false });
    const shown = [...message.matchAll(/^\S+ ([A-Z]{3}) · /gmu)].map((match) => match[1]);
    expect(shown).toEqual(['CNY', 'EUR', 'INR', 'THB', 'TRY', 'USD', 'ZAR']);
  });

  it('о наличных говорит только там, где они есть', () => {
    expect(renderRatesMessage({ quoted: DIRECTORY, hasCash: true })).toContain(
      'Наличные считает менеджер',
    );
    expect(renderRatesMessage({ quoted: DIRECTORY, hasCash: false })).not.toContain(
      'Наличные',
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
    expect(message).toContain('🇷🇺 RUB → 🇹🇭 THB —');
  });

  it('не показывает валюту нулём, когда за монету дают доли единицы', () => {
    const message = renderRatesMessage({
      quoted: [pair('USDT', 'KWD', '0.003')],
      hasCash: false,
    });
    expect(message).toContain('KWD — 0,003');
  });

  it('не оставляет в разметке знаков, которые Telegram примет за тег', () => {
    const message = renderRatesMessage({
      quoted: [pair('USDT', '<b', '3')],
      hasCash: false,
    });
    expect(message).toContain('&lt;b');
    expect(message).not.toContain('<b —');
  });
});
