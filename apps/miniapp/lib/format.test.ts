import { describe, expect, it } from 'vitest';
import { formatAmount, formatRateValue, isBelow, normalizeTyped, parseAmount } from './format';

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
  it('у крупных курсов дробную часть отбрасывает', () => {
    expect(formatRateValue('5224938.612')).toBe(`5${NBSP}224${NBSP}938`);
  });

  it('у обычных оставляет два знака', () => {
    expect(formatRateValue('82.6612')).toBe('82,66');
  });

  it('у дробных сохраняет всё, чем они различаются', () => {
    expect(formatRateValue('0.01185579')).toBe('0,01185579');
  });

  it('не округляет вверх: справочный курс не обещает точности', () => {
    expect(formatRateValue('82.669')).toBe('82,66');
  });
});

describe('parseAmount', () => {
  it('возвращает то, что примет сервер', () => {
    expect(parseAmount(`50${NBSP}000`)).toBe('50000');
    expect(parseAmount(`50${NBSP}000,5`)).toBe('50000.5');
  });
});

describe('isBelow', () => {
  it('сравнивает числа, а не строки: порядок важнее первой цифры', () => {
    expect(isBelow('900', '3000')).toBe(true);
    expect(isBelow('9000', '3000')).toBe(false);
  });

  it('пропускает сумму, равную порогу: минимальная — значит достаточная', () => {
    expect(isBelow('3000', '3000')).toBe(false);
    expect(isBelow('2999.99', '3000')).toBe(true);
  });

  it('не спотыкается о ведущие нули, которые человек мог набрать', () => {
    expect(isBelow('0000007', '3000')).toBe(true);
    expect(isBelow('03000', '3000')).toBe(false);
  });

  it('сравнивает дробные части разной длины', () => {
    expect(isBelow('3000.1', '3000.05')).toBe(false);
    expect(isBelow('3000.05', '3000.1')).toBe(true);
    expect(isBelow('3000', '3000.00000000000000001')).toBe(true);
  });

  it('не портит точность на числах, которых не выдерживает double', () => {
    // Соседние целые за пределом безопасного диапазона: через `Number`
    // оба стали бы одним и тем же значением.
    expect(isBelow('9007199254740993', '9007199254740994')).toBe(true);
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
