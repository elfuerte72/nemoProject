import { describe, expect, it } from 'vitest';
import { formatAmount, formatRate, formatRateValue, normalizeTyped, parseAmount } from './format';

/**
 * Суммы приходят десятичными строками произвольной точности, и путь
 * «строка из базы → экран → строка на сервер» проходит без `Number`.
 * Проверяется именно он: потерянный на этом пути знак — это потерянные
 * деньги.
 */

/** Тот же разделитель разрядов, что и в самом форматировании. */
const NBSP = ' ';

describe('formatAmount', () => {
  it('разделяет разряды', () => {
    expect(formatAmount('50000')).toBe(`50${NBSP}000`);
    expect(formatAmount('1234567')).toBe(`1${NBSP}234${NBSP}567`);
    expect(formatAmount('999')).toBe('999');
  });

  it('убирает хвост нулей, которым база дополняет numeric(38, 18)', () => {
    expect(formatAmount('100.000000000000000000')).toBe('100');
    expect(formatAmount('0.010624000000000000')).toBe('0,010624');
  });

  it('не показывает больше восьми знаков после запятой', () => {
    expect(formatAmount('0.123456789123')).toBe('0,12345678');
  });

  it('показывает знак минуса, а не дефис', () => {
    expect(formatAmount('-5000')).toBe(`−5${NBSP}000`);
  });

  it('не портит точность на числах, которых не выдерживает double', () => {
    expect(formatAmount('9007199254740993')).toBe(`9${NBSP}007${NBSP}199${NBSP}254${NBSP}740${NBSP}993`);
  });
});

describe('formatRateValue', () => {
  it('показывает курс целым числом', () => {
    expect(formatRateValue('82')).toBe('82');
  });

  it('крупный курс тоже целым', () => {
    expect(formatRateValue('5224938')).toBe(`5${NBSP}224${NBSP}938`);
  });

  /*
   * Курс приходит из ядра уже целым. Дробный сюда попадает только из
   * старых заявок, поданных до округления, — их карточки открывают и
   * сегодня, и число в них должно читаться так же, как в новых.
   */
  it('дробный курс из прежних заявок округляет к ближайшему', () => {
    expect(formatRateValue('82.6612')).toBe('83');
    expect(formatRateValue('82.4')).toBe('82');
  });

  it('мелкую сторону пары переворачивает: ею никто не пользуется', () => {
    // 1 / 82 — таким курс лежит у направления «рубли → USDT».
    expect(formatRateValue('0.012195121951219512')).toBe('82');
  });

  it('переворот не оставляет хвоста от деления', () => {
    // Обратное деление даёт 81,999…, и вниз это дало бы 81.
    expect(formatRateValue('0.0121951219512195')).toBe('82');
  });
});

describe('formatRate', () => {
  it('читается как табло обменника, куда бы ни шёл обмен', () => {
    expect(formatRate('82', 'USDT', 'RUB')).toBe('82 RUB за 1 USDT');
    expect(formatRate('0.012195121951219512', 'RUB', 'USDT')).toBe('82 RUB за 1 USDT');
  });
});

describe('parseAmount', () => {
  it('возвращает то, что примет сервер', () => {
    expect(parseAmount(`50${NBSP}000`)).toBe('50000');
    expect(parseAmount(`50${NBSP}000,5`)).toBe('50000.5');
  });
});

describe('normalizeTyped', () => {
  it('расставляет разряды в набранном числе', () => {
    expect(normalizeTyped('50000')).toBe(`50${NBSP}000`);
    expect(normalizeTyped('1000,25')).toBe(`1${NBSP}000,25`);
  });

  it('принимает запятую, за которой ещё ничего не набрано', () => {
    expect(normalizeTyped('1000,')).toBe(`1${NBSP}000`);
  });

  it('не подменяет опечатку нулём: человек хотел набрать что-то своё', () => {
    expect(normalizeTyped('abc')).toBe('abc');
    expect(normalizeTyped('1.2.3')).toBe('1.2.3');
    expect(normalizeTyped('')).toBe('');
  });
});
