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

describe('курс не пропадает', () => {
  it('после долгого простоя отдаёт курс, а не пустоту', async () => {
    /*
     * Ровно та жалоба, с которой всё началось. Снимок живёт пять минут,
     * а обновляется только по чьему-то запросу — и при трёх заявках за
     * две недели каждый клиент приходил на мёртвый снимок. Кэш отдавал
     * его и уходил обновляться в фоне, но потолок выбрасывал старьё
     * раньше, чем приходил ответ: человек видел «курс назовёт менеджер»
     * при живой бирже, которая ответила бы за две десятых секунды.
     */
    let clock = 0;
    let calls = 0;
    const cache = createSnapshotCache({
      load: async () => {
        calls += 1;
        return `снимок ${calls}`;
      },
      ttlMs: 10_000,
      maxAgeMs: 60_000,
      provider: 'Провайдер',
      now: () => clock,
    });

    expect((await cache.read())?.value).toBe('снимок 1');

    // Десять минут тишины: снимок мёртв, но провайдер жив.
    clock = 10 * 60_000;

    expect((await cache.read())?.value).toBe('снимок 2');
  });

  it('пришедшие следом делят с первым один запрос и один ответ', async () => {
    /*
     * Так спрашивает бот: все направления разом, `Promise.all`, и у
     * рублёвых пар кэш один на всех. Пока первый ждёт провайдера,
     * остальные приходили на выставленный им признак «уже ждём» и
     * получали пустоту — доска курса выходила дырявой с первого нажатия
     * и целой со второго, то есть ровно та жалоба, которую всё это
     * чинит. Запрос к провайдеру при этом уже шёл, и ответ его общий.
     */
    let calls = 0;
    const cache = createSnapshotCache({
      load: async () => {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 30));
        return `снимок ${calls}`;
      },
      ttlMs: 10_000,
      maxAgeMs: 60_000,
      provider: 'Провайдер',
    });

    const [first, second, third] = await Promise.all([cache.read(), cache.read(), cache.read()]);

    expect(first?.value).toBe('снимок 1');
    expect(second?.value).toBe('снимок 1');
    expect(third?.value).toBe('снимок 1');
    // Запрос был один: склейка обращений никуда не делась.
    expect(calls).toBe(1);
  });

  it('лежащего провайдера не ждут заново, отведав отказа', async () => {
    /*
     * Пока провайдер лежит, каждое новое ожидание — плата ни за что:
     * ответ один и тот же. Ждут идущий запрос; нет запроса — пусто
     * сразу, а стучится в провайдера фон.
     */
    let calls = 0;
    const cache = createSnapshotCache({
      load: async () => {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        throw new Error('провайдер лежит');
      },
      ttlMs: 10_000,
      maxAgeMs: 60_000,
      provider: 'Провайдер',
    });

    // Первая волна: все дождались общего отказа, запрос был один.
    const wave = await Promise.all([cache.read(), cache.read()]);
    expect(wave).toEqual([undefined, undefined]);
    expect(calls).toBe(1);

    // Фоновый пинок второй волны уже мог уйти — дать ему отказать.
    await vi.waitFor(() => expect(calls).toBeGreaterThanOrEqual(1));
    expect(await cache.read()).toBeUndefined();
  });

  it('снова готов ждать после того, как провайдер ожил', async () => {
    /*
     * Признак «уже ждали и не дождались» ставился навсегда. С ним первое
     * же молчание провайдера означало, что ждать не станет никто и
     * дальше: снимок, протухший через час после того, как биржа ожила,
     * снова уходил бы в пустоту.
     */
    let clock = 0;
    let calls = 0;
    const cache = createSnapshotCache({
      load: async () => {
        calls += 1;
        if (calls === 1) throw new Error('провайдер молчит');
        return `снимок ${calls}`;
      },
      ttlMs: 10_000,
      maxAgeMs: 60_000,
      provider: 'Провайдер',
      now: () => clock,
    });

    // Первый клиент ждал и не дождался.
    expect(await cache.read()).toBeUndefined();

    // Провайдер ожил, и снимок появился.
    await vi.waitFor(async () => expect(await cache.read()).toBeDefined());

    // Час тишины — снимок снова мёртв. Ждать его стоит: биржа жива.
    clock += 60 * 60_000;
    const revived = await cache.read();
    // Свежий, а не выживший: снимок записан сейчас, ожиданием, — то есть
    // кэш дождался провайдера, а не отдал то, что срок уже отсеял.
    expect(revived?.at).toBe(clock);
  });
});

describe('обновление без клиента', () => {
  it('обновляет снимок сам, пока процесс жив', async () => {
    /*
     * Обновление по запросу работает, только когда запросы идут подряд.
     * У сервиса они идут часами вразбежку, и снимок умирал между ними —
     * поэтому кэш перестал ждать, когда его спросят.
     */
    vi.useFakeTimers();
    try {
      let calls = 0;
      const cache = createSnapshotCache({
        load: async () => {
          calls += 1;
          return `снимок ${calls}`;
        },
        ttlMs: 10_000,
        maxAgeMs: 60_000,
        provider: 'Провайдер',
      });

      cache.warmUp();
      await vi.advanceTimersByTimeAsync(0);
      expect(calls).toBe(1);

      // Никто не приходил, а снимок свежий.
      await vi.advanceTimersByTimeAsync(35_000);
      expect(calls).toBe(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it('заводится один раз, сколько бы раз ни звали', async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const cache = createSnapshotCache({
        load: async () => {
          calls += 1;
          return `снимок ${calls}`;
        },
        ttlMs: 10_000,
        maxAgeMs: 60_000,
        provider: 'Провайдер',
      });

      cache.warmUp();
      cache.warmUp();
      await vi.advanceTimersByTimeAsync(35_000);

      // Четыре, а не семь: у провайдера есть предел обращений в минуту.
      expect(calls).toBe(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it('пропускает тик, когда снимок и так свежий', async () => {
    /*
     * Снимок появляется и мимо расписания — от чтения на границе срока
     * или от затянувшегося прошлого ответа. Тик, пришедший следом,
     * стучал бы в провайдера ради того, что уже есть.
     */
    vi.useFakeTimers();
    try {
      let calls = 0;
      // Первый ответ ползёт восемь секунд, остальные приходят сразу:
      // так снимок встаёт перед самым тиком.
      const cache = createSnapshotCache({
        load: async () => {
          calls += 1;
          if (calls === 1) await new Promise((resolve) => setTimeout(resolve, 8_000));
          return `снимок ${calls}`;
        },
        ttlMs: 10_000,
        maxAgeMs: 60_000,
        provider: 'Провайдер',
      });

      cache.warmUp();
      await vi.advanceTimersByTimeAsync(8_000);
      expect(calls).toBe(1);

      // Тик 10-й секунды пропущен: снимку две секунды. Тики 20-й и
      // 30-й обновляют как обычно.
      await vi.advanceTimersByTimeAsync(27_000);
      expect(calls).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('останавливается, когда кэш попросили остановиться', async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const cache = createSnapshotCache({
        load: async () => {
          calls += 1;
          return `снимок ${calls}`;
        },
        ttlMs: 10_000,
        maxAgeMs: 60_000,
        provider: 'Провайдер',
      });

      const stop = cache.warmUp();
      await vi.advanceTimersByTimeAsync(15_000);
      expect(calls).toBe(2);

      stop();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(calls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('не держит процесс: таймер отпущен', () => {
    /*
     * Иначе процесс, которому пора закончиться, ждал бы следующего
     * обновления курса — и держался бы так вечно.
     */
    const spy = vi.spyOn(globalThis, 'setInterval');
    try {
      const cache = createSnapshotCache({
        load: async () => 'снимок',
        ttlMs: 10_000,
        maxAgeMs: 60_000,
        provider: 'Провайдер',
      });
      cache.warmUp();

      const timer = spy.mock.results[0]?.value as NodeJS.Timeout;
      expect(timer.hasRef()).toBe(false);
      clearInterval(timer);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('отметка показанного курса', () => {
  it('старше своего срока — не принимается: заявка уходит по текущему', async () => {
    /*
     * Потолок показа поднят до часа ради молчащего провайдера, но он не
     * должен был поднять и это: отметку времени присылает клиент, и час
     * памяти означал бы час выбора — держать показанный курс и подать
     * заявку тогда, когда рынок ушёл дальше наценки. Между взглядом и
     * нажатием проходят минуты, и срок у отметки свой.
     */
    let clock = 0;
    let value = 'показанный';
    const cache = createSnapshotCache({
      load: async () => value,
      ttlMs: 10_000,
      maxAgeMs: 60 * 60_000,
      provider: 'Провайдер',
      now: () => clock,
    });

    const seen = await cache.read();
    expect(seen?.value).toBe('показанный');

    // Десять минут спустя рынок ушёл, и в памяти уже новый снимок — в
    // работе его приносит обновление по таймеру.
    clock = 10 * 60_000;
    value = 'текущий';
    await cache.read();
    await vi.waitFor(async () => expect((await cache.read())?.value).toBe('текущий'));

    const submitted = await cache.read(new Date(0));
    expect(submitted?.value).toBe('текущий');
  });

  it('в своём сроке — принимается и отвечает тем же курсом', async () => {
    let clock = 0;
    let value = 'показанный';
    const cache = createSnapshotCache({
      load: async () => value,
      ttlMs: 10_000,
      maxAgeMs: 60 * 60_000,
      provider: 'Провайдер',
      now: () => clock,
    });

    await cache.read();

    // Три минуты — обычная пауза между показом и подтверждением сводки.
    clock = 3 * 60_000;
    value = 'обновившийся';

    const submitted = await cache.read(new Date(0));
    expect(submitted?.value).toBe('показанный');
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
