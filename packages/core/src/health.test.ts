import { afterAll, describe, expect, it } from 'vitest';
import { closeTestDatabase, testDatabase } from '@nemo/db/testing';
import { createCore, createDatabase } from './index.js';

/**
 * Пульс базы: живая отвечает, отсутствующая — отвергается.
 *
 * Второй случай важнее первого: `/api/health`, который на мёртвую базу
 * отвечает «ok», хуже отсутствия маршрута — сторожок снаружи молчит
 * ровно тогда, когда должен звать.
 */

afterAll(async () => {
  await closeTestDatabase();
});

describe('pingDatabase', () => {
  it('проходит до живой базы', async () => {
    const core = createCore({ db: testDatabase() });
    await expect(core.pingDatabase()).resolves.toBeUndefined();
  });

  it('отвергается, когда базы по адресу нет', async () => {
    // Порт 1 никто не слушает: отказ приходит сразу, а не по таймауту.
    const core = createCore({
      db: createDatabase('postgres://nemo:nemo@127.0.0.1:1/nemo', { max: 1 }),
    });
    await expect(core.pingDatabase()).rejects.toThrow();
  });
});
