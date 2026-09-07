import { describe, expect, it } from 'vitest';
import { InvalidInputError } from '@nemo/core';
import {
  exchangeRequestBodySchema,
  parseBody,
  parseListQuery,
  quoteBodySchema,
  requireIdempotencyKey,
} from './schemas';

/**
 * Разбор тел и параметров API: что обязательно, что отвергается и
 * какими словами. Правила предметной области — минимум, направление,
 * правдоподобие получателя — здесь не проверяются: они у ядра.
 */

function request(headers: Record<string, string> = {}): Request {
  return new Request('https://cabinet.example/api/v1/exchange-requests', {
    method: 'POST',
    headers,
  });
}

describe('ключ повтора', () => {
  it('обязателен: без него подача отвергается словами', () => {
    expect(() => requireIdempotencyKey(request())).toThrow(InvalidInputError);
    expect(() => requireIdempotencyKey(request({ 'idempotency-key': '   ' }))).toThrow(
      /Idempotency-Key/,
    );
  });

  it('обрезается по краям и не длиннее двухсот знаков', () => {
    expect(requireIdempotencyKey(request({ 'idempotency-key': ' booking-1024 ' }))).toBe(
      'booking-1024',
    );
    expect(() => requireIdempotencyKey(request({ 'idempotency-key': 'x'.repeat(201) }))).toThrow(
      InvalidInputError,
    );
  });
});

describe('тело подачи', () => {
  const base = { from: 'usdt', to: 'rub', amount: '100' };

  it('коды валют приводятся к верхнему регистру, сторона по умолчанию — отдаю', () => {
    const body = parseBody(exchangeRequestBodySchema, JSON.stringify(base));
    expect(body).toMatchObject({ from: 'USDT', to: 'RUB', amount: '100', side: 'from' });
  });

  /**
   * Наличная заявка по API не подаётся, и вида у заявки в договоре
   * нет вовсе. Присланный `kind` — не «лишнее поле, которое можно
   * выкинуть»: выкинутый молча, он превратил бы наличную в электронную.
   */
  it('неизвестное поле отвергается, а не выбрасывается молча', () => {
    expect(() =>
      parseBody(exchangeRequestBodySchema, JSON.stringify({ ...base, kind: 'cash' })),
    ).toThrow(/kind/);
    expect(() =>
      parseBody(exchangeRequestBodySchema, JSON.stringify({ ...base, requisiteId: 'x' })),
    ).toThrow(/requisiteId/);
  });

  it('сумма — положительное число строкой', () => {
    expect(() => parseBody(quoteBodySchema, JSON.stringify({ ...base, amount: 100 }))).toThrow(
      InvalidInputError,
    );
    expect(() => parseBody(quoteBodySchema, JSON.stringify({ ...base, amount: '-5' }))).toThrow(
      /amount/,
    );
    expect(() => parseBody(quoteBodySchema, JSON.stringify({ ...base, amount: '0' }))).toThrow(
      /amount/,
    );
  });

  it('не JSON — отказ словами, а не пятисотый', () => {
    expect(() => parseBody(quoteBodySchema, '{oops')).toThrow(/JSON/);
  });

  it('пустое тело — «обязательно» с именем поля', () => {
    expect(() => parseBody(quoteBodySchema, '')).toThrow(/«from»: обязательно/);
  });
});

describe('параметры списка', () => {
  it('курсор — пара, а не половина', () => {
    expect(() => parseListQuery(new URLSearchParams({ after: '2026-09-07T10:00:00Z' }))).toThrow(
      /afterId/,
    );
    const parsed = parseListQuery(
      new URLSearchParams({
        after: '2026-09-07T10:00:00Z',
        afterId: '3f1c2a9e-5b7d-4c0e-9a11-2f6d8e4b7c31',
        status: 'completed',
        limit: '10',
      }),
    );
    expect(parsed.after?.id).toBe('3f1c2a9e-5b7d-4c0e-9a11-2f6d8e4b7c31');
    expect(parsed.status).toBe('completed');
    expect(parsed.limit).toBe(10);
  });

  it('чужое состояние и предел сверх потолка отвергаются', () => {
    expect(() => parseListQuery(new URLSearchParams({ status: 'paid' }))).toThrow(/status/);
    expect(() => parseListQuery(new URLSearchParams({ limit: '999' }))).toThrow(/limit/);
  });
});
