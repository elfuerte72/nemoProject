import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SessionError } from './session';
import {
  AMBASSADOR_COOKIE,
  issueAmbassadorToken,
  readAmbassadorToken,
} from './ambassador-session';

/**
 * Кука кабинета амбассадора — вторая рядом с мерчантской и той же
 * выделки: подписанная строка со сроком.
 *
 * Поколения у неё нет: гасится доступ снятием отметки, и это ядро
 * проверяет при каждом запросе. Проверяется здесь то, чего не видно
 * глазами: подпись, срок и то, что подделанный идентификатор не
 * читается — за ним чужие деньги.
 */

const secret = 'x'.repeat(32);
const options = { secret };

describe('кука амбассадора', () => {
  it('переживает выдачу и чтение, идентификатор остаётся числом', () => {
    const token = issueAmbassadorToken({ clientId: 7_123_456_789n }, options);
    expect(readAmbassadorToken(token, options)).toEqual({ clientId: 7_123_456_789n });
  });

  it('кука своя, а не мерчантская: две сессии рядом не мешают друг другу', () => {
    expect(AMBASSADOR_COOKIE).not.toBe('tobee_cabinet_session');
  });

  it('подменённый идентификатор не читается', () => {
    const token = issueAmbassadorToken({ clientId: 1n }, options);
    const [, expires, signature] = token.split('.');
    expect(() => readAmbassadorToken(`2.${expires}.${signature}`, options)).toThrow(SessionError);
    expect(() => readAmbassadorToken(token, { secret: 'y'.repeat(32) })).toThrow(SessionError);
  });

  it('истёкшая не читается', () => {
    const token = issueAmbassadorToken(
      { clientId: 1n },
      { ...options, ttlSeconds: 60, now: new Date('2026-09-10T10:00:00Z') },
    );
    expect(() =>
      readAmbassadorToken(token, { ...options, now: new Date('2026-09-10T10:01:01Z') }),
    ).toThrow(SessionError);
  });

  it('пустая, обрезанная и не-число — отказ, а не пустая сессия', () => {
    expect(() => readAmbassadorToken(undefined, options)).toThrow(SessionError);
    expect(() => readAmbassadorToken('', options)).toThrow(SessionError);
    expect(() => readAmbassadorToken('1.999', options)).toThrow(SessionError);

    const forged = `седьмой.${Math.floor(Date.now() / 1000) + 60}`;
    const signature = createHmac('sha256', secret).update(forged).digest('base64url');
    expect(() => readAmbassadorToken(`${forged}.${signature}`, options)).toThrow(SessionError);
  });
});
