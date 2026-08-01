import { describe, expect, it } from 'vitest';
import { issueToken, readToken, SessionError } from './session.js';

/**
 * Сессия админки.
 *
 * Она не хранится в базе — это подписанная строка со сроком годности.
 * Проверять здесь нужно ровно то, на чём держится такая схема: чужую
 * подпись не принять, срок не подделать, чужим секретом не открыть.
 * Право доступа она не подтверждает: активность сотрудника проверяется
 * отдельно, при каждом запросе.
 */

const SECRET = 'секрет-для-теста-достаточной-длины';
const STAFF_ID = '11111111-2222-3333-4444-555555555555';
const NOW = new Date('2026-08-01T12:00:00Z');

describe('выданный токен', () => {
  it('читается тем же секретом', () => {
    const token = issueToken({ staffId: STAFF_ID, stage: 'active' }, { secret: SECRET, now: NOW });

    expect(readToken(token, { secret: SECRET, now: NOW })).toEqual({
      staffId: STAFF_ID,
      stage: 'active',
    });
  });

  it('не читается чужим секретом', () => {
    const token = issueToken({ staffId: STAFF_ID, stage: 'active' }, { secret: SECRET, now: NOW });

    expect(() => readToken(token, { secret: 'другой секрет', now: NOW })).toThrow(SessionError);
  });

  it('перестаёт действовать по истечении срока', () => {
    const token = issueToken(
      { staffId: STAFF_ID, stage: 'active' },
      { secret: SECRET, now: NOW, ttlSeconds: 60 },
    );

    expect(() =>
      readToken(token, { secret: SECRET, now: new Date(NOW.getTime() + 61_000) }),
    ).toThrow(SessionError);
  });

  it('действует, пока срок не вышел', () => {
    const token = issueToken(
      { staffId: STAFF_ID, stage: 'active' },
      { secret: SECRET, now: NOW, ttlSeconds: 60 },
    );

    expect(
      readToken(token, { secret: SECRET, now: new Date(NOW.getTime() + 59_000) }).staffId,
    ).toBe(STAFF_ID);
  });
});

describe('подделка токена', () => {
  it('не проходит при подмене сотрудника', () => {
    const token = issueToken({ staffId: STAFF_ID, stage: 'active' }, { secret: SECRET, now: NOW });
    const [, stage, expiresAt, signature] = token.split('.');

    const forged = [
      '99999999-9999-9999-9999-999999999999',
      stage,
      expiresAt,
      signature,
    ].join('.');

    expect(() => readToken(forged, { secret: SECRET, now: NOW })).toThrow(SessionError);
  });

  it('не проходит при продлении срока', () => {
    const token = issueToken(
      { staffId: STAFF_ID, stage: 'active' },
      { secret: SECRET, now: NOW, ttlSeconds: 60 },
    );
    const [staffId, stage, , signature] = token.split('.');

    const forged = [
      staffId,
      stage,
      String(Math.floor(NOW.getTime() / 1000) + 99_999),
      signature,
    ].join('.');

    expect(() => readToken(forged, { secret: SECRET, now: NOW })).toThrow(SessionError);
  });

  it('не проходит при повышении незавершённого входа до полноценного', () => {
    const token = issueToken({ staffId: STAFF_ID, stage: 'pending' }, { secret: SECRET, now: NOW });

    const forged = token.replace('pending', 'active');

    expect(() => readToken(forged, { secret: SECRET, now: NOW })).toThrow(SessionError);
  });

  it('не проходит, когда токена нет вовсе', () => {
    expect(() => readToken(undefined, { secret: SECRET, now: NOW })).toThrow(SessionError);
    expect(() => readToken('', { secret: SECRET, now: NOW })).toThrow(SessionError);
    expect(() => readToken('мусор', { secret: SECRET, now: NOW })).toThrow(SessionError);
  });
});
