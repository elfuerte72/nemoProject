import { describe, expect, it } from 'vitest';
import {
  merchantRoleCan,
  merchantRoleName,
  merchantUserRoles,
  type MerchantAbility,
} from './merchant-roles.js';

const ALL: readonly MerchantAbility[] = ['submit', 'recipients', 'till', 'integration', 'staff'];

describe('права роли мерчанта', () => {
  it('владельцу можно всё', () => {
    for (const ability of ALL) {
      expect(merchantRoleCan('owner', ability)).toBe(true);
    }
  });

  it('оператор работает, но не ведёт интеграцию и людей', () => {
    expect(merchantRoleCan('operator', 'submit')).toBe(true);
    expect(merchantRoleCan('operator', 'recipients')).toBe(true);
    expect(merchantRoleCan('operator', 'till')).toBe(true);
    expect(merchantRoleCan('operator', 'integration')).toBe(false);
    expect(merchantRoleCan('operator', 'staff')).toBe(false);
  });

  it('наблюдатель только смотрит', () => {
    for (const ability of ALL) {
      expect(merchantRoleCan('viewer', ability)).toBe(false);
    }
  });

  it('у каждой роли есть русское имя', () => {
    for (const role of merchantUserRoles) {
      expect(merchantRoleName(role)).toMatch(/^[А-ЯЁ]/);
    }
  });
});
