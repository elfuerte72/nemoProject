import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Прогрев курса на старте процесса кабинета.
 *
 * Правило то же, что в Mini App, и держится оно на том же: кто-то
 * заводит модуль операций до первого запроса, иначе это делает первый
 * пришедший — то есть тот, чьё ожидание прогрев и должен был съесть.
 *
 * Проверяется здесь ровно эта связь: старт сервера заводит операции.
 * Мокается не поведение прогрева, а его единственный вход — биржу в
 * тест не позовёшь, а потерять вызов при перестановке файлов можно
 * легко, и заметит это первый мерчант после каждой выкатки.
 */

const getCore = vi.hoisted(() => vi.fn());

vi.mock('./lib/core', () => ({ getCore }));

/*
 * Сбрасывается не только счёт вызовов, но и подменённое поведение:
 * очистка одной истории оставляет мок бросать исключение и в следующем
 * тесте, а тот проверяет вызов, а не отказ, — и молча идёт по сбойному
 * пути, оставаясь зелёным.
 */
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('register', () => {
  it('заводит операции на старте сервера — до первого запроса', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');

    const { register } = await import('./instrumentation');
    await register();

    expect(getCore).toHaveBeenCalledOnce();
  });

  /*
   * Next зовёт этот хук в каждом рантайме, в котором собрано приложение.
   * Маршруты здесь объявлены `nodejs`, и в остальных заводить нечего:
   * ни драйвера базы, ни таймеров прогрева там всё равно нет.
   */
  it('в чужом рантайме не делает ничего', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'edge');

    const { register } = await import('./instrumentation');
    await register();

    expect(getCore).not.toHaveBeenCalled();
  });

  /*
   * Прогрев — ускорение, а не обязанность. Упавший на старте, он уронил
   * бы весь сервер, и вместо медленного первого запроса вышел бы
   * контейнер, перезапускающийся по кругу.
   */
  it('переживает отказ: сервер поднимается и без прогретого курса', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    getCore.mockImplementation(() => {
      throw new Error('Не задан DATABASE_URL');
    });
    const complaint = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { register } = await import('./instrumentation');
    await expect(register()).resolves.toBeUndefined();

    expect(complaint).toHaveBeenCalled();
  });
});
