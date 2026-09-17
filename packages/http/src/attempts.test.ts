import { beforeEach, describe, expect, it } from 'vitest';
import { createAttemptCounter } from './attempts.js';

/**
 * Счётчик попыток один на кабинет и панель: вход мерчанта по паролю и
 * код второго фактора у сотрудника считаются одним правилом, а предел и
 * окно у каждого свои.
 */

const counter = createAttemptCounter({ name: 'nemo.test.attempts', limit: 3, windowMs: 60_000 });

beforeEach(() => {
  counter.forget();
});

describe('счётчик попыток', () => {
  it('пускает до предела и перестаёт на нём', () => {
    for (let i = 0; i < 3; i += 1) {
      expect(counter.allowed('ключ', 1_000)).toBe(true);
      counter.spent('ключ', 1_000);
    }
    expect(counter.allowed('ключ', 1_000)).toBe(false);
    expect(counter.allowed('сосед', 1_000)).toBe(true);
  });

  it('окно кончается — счёт начинается заново', () => {
    for (let i = 0; i < 3; i += 1) counter.spent('ключ', 1_000);
    expect(counter.allowed('ключ', 1_000 + 60_000)).toBe(true);
  });

  /*
   * Окно отсчитывается от первой попытки и последующими не продлевается:
   * иначе перебирающий, стуча раз в минуту, держал бы чужой вход
   * закрытым вечно.
   */
  it('новые попытки окна не продлевают', () => {
    counter.spent('ключ', 1_000);
    counter.spent('ключ', 50_000);
    counter.spent('ключ', 59_000);
    expect(counter.allowed('ключ', 59_500)).toBe(false);
    expect(counter.allowed('ключ', 61_000)).toBe(true);
  });

  it('удача снимает счёт', () => {
    for (let i = 0; i < 3; i += 1) counter.spent('ключ', 1_000);
    counter.succeeded('ключ');
    expect(counter.allowed('ключ', 1_000)).toBe(true);
  });

  /*
   * Проверка предела и трата попытки — одно действие, а не два: между
   * «попытка есть» и «попытка потрачена» у маршрута стоит обращение к
   * базе, и параллельные запросы проходили бы проверку все разом.
   */
  it('резерв проверяет и тратит попытку одним шагом', () => {
    const taken = Array.from({ length: 10 }, () => counter.reserve('ключ', 1_000));
    expect(taken.filter(Boolean)).toHaveLength(3);
    expect(counter.allowed('ключ', 1_000)).toBe(false);
  });

  it('резерв сообщает, какой по счёту стала попытка', () => {
    expect(counter.reserve('ключ', 1_000)).toBe(1);
    expect(counter.reserve('ключ', 1_000)).toBe(2);
    expect(counter.reserve('ключ', 1_000)).toBe(3);
    expect(counter.reserve('ключ', 1_000)).toBeNull();
  });

  it('возврат отдаёт попытку, которая оказалась не попыткой', () => {
    for (let i = 0; i < 3; i += 1) counter.reserve('ключ', 1_000);
    counter.release('ключ', 1_000);
    expect(counter.allowed('ключ', 1_000)).toBe(true);

    counter.forget();
    counter.release('ключ', 1_000);
    expect(counter.size()).toBe(0);
  });

  it('два счётчика с разными именами друг друга не видят', () => {
    const other = createAttemptCounter({ name: 'nemo.test.attempts.other', limit: 1, windowMs: 60_000 });
    other.forget();
    other.spent('ключ', 1_000);
    expect(other.allowed('ключ', 1_000)).toBe(false);
    expect(counter.allowed('ключ', 1_000)).toBe(true);
  });

  /*
   * Память держится на `globalThis` под именем счётчика: Next собирает
   * маршруты в разные бандлы, и у каждого свой экземпляр модуля. С
   * переменной модуля предел умножался бы на число бандлов.
   */
  it('заведённый заново под тем же именем помнит прежние попытки', () => {
    for (let i = 0; i < 3; i += 1) counter.spent('ключ', 1_000);
    const again = createAttemptCounter({ name: 'nemo.test.attempts', limit: 3, windowMs: 60_000 });
    expect(again.allowed('ключ', 1_000)).toBe(false);
  });

  it('не растёт бесконечно от чужих ключей и обрезает длинный ключ', () => {
    for (let i = 0; i < 3000; i += 1) counter.spent(`spam-${i}`, 1_000);
    expect(counter.size()).toBeLessThanOrEqual(1000);

    counter.forget();
    const long = 'a'.repeat(300);
    for (let i = 0; i < 3; i += 1) counter.spent(`${long}-один`, 1_000);
    expect(counter.allowed(`${long}-другой`, 1_000)).toBe(false);
  });
});
