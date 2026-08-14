import { describe, expect, it, vi } from 'vitest';
import { createSnapshotCache } from './snapshots.js';

/**
 * Прогрев кэша: единственное место, где к провайдеру идут не ради
 * чьего-то запроса, а заранее.
 *
 * Проверяется здесь, а не через источники курса: правило общее для
 * биржи и банка, и своя проверка у каждого разошлась бы с другой.
 */

/** Провайдер, который отвечает не с первого раза. */
function givenProvider(failures: number) {
  let calls = 0;
  return {
    calls: () => calls,
    load: async () => {
      calls += 1;
      if (calls <= failures) throw new Error('провайдер молчит');
      return `снимок ${calls}`;
    },
  };
}

function givenCache<T>(load: () => Promise<T>) {
  return createSnapshotCache({
    load,
    ttlMs: 10_000,
    maxAgeMs: 60_000,
    keep: 3,
    provider: 'Провайдер',
    // Пауза между попытками в тесте не нужна: проверяется, что попытка
    // вторая есть, а не сколько между ними ждут.
    warmUpRetryMs: 0,
    warmUpAttempts: 4,
  });
}

describe('прогрев', () => {
  it('пробует снова, когда провайдер не ответил с первого раза', async () => {
    // Ровно тот случай, что случился на боевом: биржа отвечает от долей
    // секунды до десятков, срок запроса — три, и одна попытка попала на
    // медленный ответ. Кэш оставался пустым до первого клиента, и тот
    // видел «курс назовёт менеджер» при живой бирже.
    const provider = givenProvider(1);
    const cache = givenCache(provider.load);

    cache.warmUp();
    await vi.waitFor(() => expect(provider.calls()).toBe(2));

    const snapshot = await cache.read();
    expect(snapshot?.value).toBe('снимок 2');
    // Клиент к провайдеру не ходил: снимок его уже ждал.
    expect(provider.calls()).toBe(2);
  });

  it('сдаётся, отведя попытки, и не ходит к провайдеру вечно', async () => {
    const provider = givenProvider(Number.POSITIVE_INFINITY);
    const cache = givenCache(provider.load);

    cache.warmUp();
    await vi.waitFor(() => expect(provider.calls()).toBe(4));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(provider.calls()).toBe(4);
  });

  it('начинается один раз: второй звонок не заводит своей череды попыток', async () => {
    const provider = givenProvider(Number.POSITIVE_INFINITY);
    const cache = givenCache(provider.load);

    cache.warmUp();
    cache.warmUp();
    await vi.waitFor(() => expect(provider.calls()).toBe(4));
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Четыре, а не восемь: у провайдера есть предел обращений в минуту.
    expect(provider.calls()).toBe(4);
  });

  it('не греет то, что уже согрето: снимок мог принести клиент', async () => {
    const provider = givenProvider(0);
    const cache = givenCache(provider.load);

    // Клиент пришёл раньше, чем прогрев успел начаться.
    await cache.read();
    cache.warmUp();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(provider.calls()).toBe(1);
  });
});

describe('память снимков', () => {
  it('хватает на весь срок, пока курс можно показывать', async () => {
    /*
     * Клиент подаёт заявку по курсу, который увидел, и присылает отметку
     * его времени. Снимок с этой отметкой обязан найтись, пока курс
     * вообще разрешено показывать: не найдя его, кэш отвечает текущей
     * ценой — и заявка уходит по курсу, которого на экране не было.
     *
     * Числом глубина памяти и расходилась с этим сроком: тридцать
     * снимков при обновлении раз в десять секунд покрывают не пять
     * минут, а четыре пятьдесят, потому что первый из них вытесняется
     * тридцать первым.
     */
    let at = 0;
    let value = 'первый';
    const cache = createSnapshotCache({
      load: async () => value,
      ttlMs: 10_000,
      maxAgeMs: 5 * 60_000,
      provider: 'Провайдер',
      now: () => at,
    });

    const first = await cache.read();
    expect(first?.value).toBe('первый');

    // Пять минут под нагрузкой: раз в десять секунд снимок обновляется.
    for (let step = 1; step <= 30; step += 1) {
      at = step * 10_000;
      value = `снимок ${step}`;
      await cache.read();
      // Обновление фоновое — даём ему завершиться.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const found = await cache.read(new Date(0));
    expect(found?.value).toBe('первый');
  });
});
