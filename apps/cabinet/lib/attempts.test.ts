import { beforeEach, describe, expect, it } from 'vitest';
import {
  addressOf,
  attemptAllowed,
  attemptCount,
  attemptSpent,
  attemptSucceeded,
  ATTEMPT_LIMIT,
  ATTEMPT_WINDOW_MS,
  forgetAttempts,
  isFailedLogin,
} from './attempts';

/**
 * Ограничение попыток входа. Проверяется тестом, потому что руками это
 * пятнадцать неудачных входов подряд, а ошибка выглядит как работающий
 * вход — до тех пор, пока кто-то не подберёт пароль.
 */

beforeEach(() => {
  forgetAttempts();
});

describe('счёт попыток', () => {
  it('пускает, пока попытки есть, и перестаёт на пределе', () => {
    const now = 1_000;
    for (let i = 0; i < ATTEMPT_LIMIT; i += 1) {
      expect(attemptAllowed('shop@example.com', now)).toBe(true);
      attemptSpent('shop@example.com', now);
    }
    expect(attemptAllowed('shop@example.com', now)).toBe(false);
  });

  it('считает по своему ключу: чужой перебор не закрывает вход соседу', () => {
    const now = 1_000;
    for (let i = 0; i < ATTEMPT_LIMIT; i += 1) attemptSpent('shop@example.com', now);

    expect(attemptAllowed('shop@example.com', now)).toBe(false);
    expect(attemptAllowed('other@example.com', now)).toBe(true);
  });

  it('окно кончается — счёт начинается заново', () => {
    const now = 1_000;
    for (let i = 0; i < ATTEMPT_LIMIT; i += 1) attemptSpent('shop@example.com', now);

    expect(attemptAllowed('shop@example.com', now + ATTEMPT_WINDOW_MS + 1)).toBe(true);
  });

  /*
   * Вошедший забывает свои неудачи: считается перебор, а не то, сколько
   * раз человек промахнулся мимо пароля за вечер.
   */
  it('удачный вход снимает счёт', () => {
    const now = 1_000;
    for (let i = 0; i < ATTEMPT_LIMIT; i += 1) attemptSpent('shop@example.com', now);
    attemptSucceeded('shop@example.com');

    expect(attemptAllowed('shop@example.com', now)).toBe(true);
  });
});

/**
 * Ключ приходит снаружи — почтой из формы. Без потолка память растёт от
 * одного цикла по случайным адресам, а перебирающему это и надо.
 */
describe('память счётчика', () => {
  it('не растёт бесконечно от чужих ключей', () => {
    const now = 1_000;
    for (let i = 0; i < 3000; i += 1) attemptSpent(`spam-${i}@example.com`, now);

    expect(attemptCount()).toBeLessThanOrEqual(1000);
  });

  it('забывает просроченное', () => {
    const now = 1_000;
    for (let i = 0; i < 1200; i += 1) attemptSpent(`old-${i}@example.com`, now);
    attemptSpent('fresh@example.com', now + ATTEMPT_WINDOW_MS + 1);

    expect(attemptCount()).toBeLessThan(1200);
  });

  /*
   * Длинный ключ обрезается, и это видно снаружи: две почты, различные
   * только за сотым знаком, считаются одной. Так и задумано — почта
   * такой длины уже не почта, а нагрузка.
   */
  it('обрезает длинный ключ', () => {
    const now = 1_000;
    const long = `${'a'.repeat(300)}@example.com`;
    for (let i = 0; i < ATTEMPT_LIMIT; i += 1) attemptSpent(long, now);

    expect(attemptAllowed(`${'a'.repeat(300)}@other.com`, now)).toBe(false);
  });
});

describe('адрес запроса', () => {
  it('берёт первый в цепочке: он от клиента, остальные дописали посредники', () => {
    const request = new Request('https://business.tobee.ru/api/auth/login', {
      headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' },
    });
    expect(addressOf(request)).toBe('203.0.113.7');
  });

  it('без заголовков считает все запросы одним источником', () => {
    expect(addressOf(new Request('https://business.tobee.ru/api/auth/login'))).toBe(
      'неизвестный адрес',
    );
  });
});

describe('что считается неудачной попыткой', () => {
  /*
   * Ядро кабинета держится на `globalThis`, а заводит его хук запуска —
   * в своём бандле. Ошибка приходит с классом из другой копии
   * `@nemo/core`, и `instanceof ForbiddenError` в маршруте ложно всегда.
   * Так предел входа не срабатывал вовсе: 14 сентября 2026 на dev
   * тринадцать неверных паролей подряд к одной почте не заперли ничего.
   * Здесь ошибка собрана так, как она приходит из чужой копии: тот же
   * `code`, но родства по классу нет.
   */
  function foreignCopy(code: string): Error {
    return Object.assign(new Error('Почта или пароль не подходят'), { code });
  }

  it('отказ ядра «forbidden» из чужой копии класса — неудачный вход', () => {
    expect(isFailedLogin(foreignCopy('forbidden'))).toBe(true);
  });

  it('отказавшая база — не попытка подбора', () => {
    expect(isFailedLogin(foreignCopy('unavailable'))).toBe(false);
    expect(isFailedLogin(new Error('connect ECONNREFUSED'))).toBe(false);
  });
});
