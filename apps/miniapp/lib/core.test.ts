import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Ядро одно на процесс — и это должно переживать второй экземпляр
 * самого модуля.
 *
 * Next собирает `instrumentation.ts` и маршруты в разные бандлы, и у
 * каждого свой экземпляр `lib/core` со своей переменной. Синглтон в
 * переменной модуля давал два ядра: одно грел хук при старте, и его
 * никто не спрашивал, второе заводил первый маршрут — на первом
 * клиенте, ровно так, как до хука. Замечено 27 августа 2026 по десяти
 * таймерам кэшей курса в процессе вместо пяти.
 */

const createCore = vi.hoisted(() => vi.fn(() => ({ core: Symbol('ядро') })));

vi.mock('@nemo/core', () => ({ createCore, createDatabase: vi.fn(() => ({})) }));
vi.mock('@nemo/rates', () => ({ ratesFromEnvironment: vi.fn(() => ({})) }));
vi.mock('@nemo/concierge', () => ({ conciergeFromEnvironment: vi.fn(() => undefined) }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  createCore.mockClear();
  delete (globalThis as { __nemoMiniappCore?: unknown }).__nemoMiniappCore;
});

describe('getCore', () => {
  it('отдаёт второму экземпляру модуля то же ядро, что и первому', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://nemo:nemo@localhost/nemo_test');

    const first = (await import('./core')).getCore();
    // Так выглядит модуль из другого бандла: тот же исходник, своя
    // переменная.
    vi.resetModules();
    const second = (await import('./core')).getCore();

    expect(second).toBe(first);
    expect(createCore).toHaveBeenCalledOnce();
  });

  it('без адреса базы не поднимается', async () => {
    vi.stubEnv('DATABASE_URL', '');

    const { getCore } = await import('./core');

    expect(() => getCore()).toThrow('DATABASE_URL');
    expect(createCore).not.toHaveBeenCalled();
  });
});
