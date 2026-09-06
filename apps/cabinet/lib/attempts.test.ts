import { beforeEach, describe, expect, it } from 'vitest';
import {
  addressOf,
  attemptAllowed,
  attemptFailed,
  attemptSucceeded,
  ATTEMPT_LIMIT,
  ATTEMPT_WINDOW_MS,
  forgetAttempts,
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
      attemptFailed('shop@example.com', now);
    }
    expect(attemptAllowed('shop@example.com', now)).toBe(false);
  });

  it('считает по своему ключу: чужой перебор не закрывает вход соседу', () => {
    const now = 1_000;
    for (let i = 0; i < ATTEMPT_LIMIT; i += 1) attemptFailed('shop@example.com', now);

    expect(attemptAllowed('shop@example.com', now)).toBe(false);
    expect(attemptAllowed('other@example.com', now)).toBe(true);
  });

  it('окно кончается — счёт начинается заново', () => {
    const now = 1_000;
    for (let i = 0; i < ATTEMPT_LIMIT; i += 1) attemptFailed('shop@example.com', now);

    expect(attemptAllowed('shop@example.com', now + ATTEMPT_WINDOW_MS + 1)).toBe(true);
  });

  /*
   * Вошедший забывает свои неудачи: считается перебор, а не то, сколько
   * раз человек промахнулся мимо пароля за вечер.
   */
  it('удачный вход снимает счёт', () => {
    const now = 1_000;
    for (let i = 0; i < ATTEMPT_LIMIT; i += 1) attemptFailed('shop@example.com', now);
    attemptSucceeded('shop@example.com');

    expect(attemptAllowed('shop@example.com', now)).toBe(true);
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
