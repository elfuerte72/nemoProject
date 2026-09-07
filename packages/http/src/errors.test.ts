import { describe, expect, it } from 'vitest';
import { InvalidInputError } from '@nemo/core';
import { coreErrorResponse, isCoreError } from './index.js';

/**
 * Отказ ядра узнаётся по коду: в разработке у маршрута и у ядра бывают
 * разные копии класса, и `instanceof` между ними не сходится.
 */
describe('отказ ядра', () => {
  it('узнаётся по классу', () => {
    expect(isCoreError(new InvalidInputError('нет'))).toBe(true);
  });

  it('узнаётся по коду, когда класс чужой копии', () => {
    const foreign = Object.assign(new Error('Сумма мала'), { code: 'invalid-input' });
    expect(isCoreError(foreign)).toBe(true);
    expect(coreErrorResponse(foreign)?.status).toBe(422);
  });

  it('чужие коды — не отказ ядра', () => {
    expect(isCoreError(Object.assign(new Error('дубль'), { code: '23505' }))).toBe(false);
    expect(isCoreError(Object.assign(new Error('сеть'), { code: 'ECONNREFUSED' }))).toBe(false);
    expect(isCoreError({ code: 'conflict', message: 'не Error' })).toBe(false);
    expect(coreErrorResponse(new Error('просто ошибка'))).toBeNull();
  });
});
