import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';

describe('пароль мерчанта', () => {
  it('сходится сам с собой', async () => {
    const hash = await hashPassword('правильная лошадь батарейка');
    expect(await verifyPassword(hash, 'правильная лошадь батарейка')).toBe(true);
  });

  it('не сходится с другим', async () => {
    const hash = await hashPassword('правильная лошадь батарейка');
    expect(await verifyPassword(hash, 'правильная лошадь батарейкa')).toBe(false);
  });

  /**
   * Соль у каждого пароля своя, иначе таблица заранее посчитанных
   * хешей открывала бы все одинаковые пароли разом.
   */
  it('два одинаковых пароля дают разные хеши', async () => {
    const first = await hashPassword('правильная лошадь батарейка');
    const second = await hashPassword('правильная лошадь батарейка');
    expect(first).not.toBe(second);
    expect(await verifyPassword(second, 'правильная лошадь батарейка')).toBe(true);
  });

  it('хранится argon2id, а не что-то другое', async () => {
    expect(await hashPassword('правильная лошадь батарейка')).toMatch(/^\$argon2id\$/);
  });

  /**
   * База с испорченным хешем не должна валить вход исключением: строка,
   * по которой не проверить пароль, — это «не подходит», а пятисотый
   * ответ на форме входа читается как поломка сервиса.
   */
  it('испорченный хеш не подходит и не бросает', async () => {
    expect(await verifyPassword('не хеш вовсе', 'правильная лошадь батарейка')).toBe(false);
  });
});
