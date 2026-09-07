import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { issueToken, readToken, SessionError } from './session';

/**
 * Подписанная кука кабинета.
 *
 * Проверяется здесь то, чего не видно глазами: подпись, срок и
 * поколение. Ошибка в любом из трёх выглядит как работающий вход — и
 * обнаруживается тем, что в кабинет зашёл не тот.
 */

const secret = 'x'.repeat(32);
const options = { secret };

describe('кука сессии', () => {
  it('переживает выдачу и чтение', () => {
    const token = issueToken({ merchantId: 'm1', sessionEpoch: 3 }, options);
    expect(readToken(token, options)).toEqual({ merchantId: 'm1', sessionEpoch: 3 });
  });

  it('подделанная не читается: подпись покрывает всё, включая поколение', () => {
    const token = issueToken({ merchantId: 'm1', sessionEpoch: 3 }, options);
    const [id, epoch, expires, signature] = token.split('.');

    expect(() => readToken(`m2.${epoch}.${expires}.${signature}`, options)).toThrow(SessionError);
    expect(() => readToken(`${id}.9.${expires}.${signature}`, options)).toThrow(SessionError);
    expect(() => readToken(token, { secret: 'y'.repeat(32) })).toThrow(SessionError);
  });

  it('истёкшая не читается', () => {
    const token = issueToken(
      { merchantId: 'm1', sessionEpoch: 1 },
      { ...options, ttlSeconds: 60, now: new Date('2026-09-06T10:00:00Z') },
    );
    expect(() =>
      readToken(token, { ...options, now: new Date('2026-09-06T10:01:01Z') }),
    ).toThrow(SessionError);
  });

  it('пустая и обрезанная — тоже отказ, а не пустая сессия', () => {
    expect(() => readToken(undefined, options)).toThrow(SessionError);
    expect(() => readToken('', options)).toThrow(SessionError);
    expect(() => readToken('m1.1.999', options)).toThrow(SessionError);
  });

  /*
   * Поколение читается числом: строка в этом месте прошла бы сверку с
   * поколением из базы только по случайности, а не пройдя её — выкинула
   * бы из кабинета того, чья кука в порядке.
   */
  it('поколение не число — отказ', () => {
    const token = issueToken({ merchantId: 'm1', sessionEpoch: 1 }, options);
    const [id, , expires] = token.split('.');
    const forged = `${id}.первое.${expires}`;
    expect(() => readToken(`${forged}.${signOf(forged)}`, options)).toThrow(SessionError);
  });
});

function signOf(body: string): string {
  // Тот же способ подписи, что и в модуле: тест подделывает не подпись,
  // а поколение — и должен пройти проверку подписи, чтобы дойти до него.
  return createHmac('sha256', secret).update(body).digest('base64url');
}
