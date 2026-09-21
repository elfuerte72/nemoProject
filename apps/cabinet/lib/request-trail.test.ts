import { describe, expect, it } from 'vitest';
import { slopComplaints } from '@nemo/core';
import { deliveryWords, trailOf, type TrailDeliveryInput } from './request-trail.js';

/**
 * Хронология заявки вместе с вебхуками.
 *
 * Смена состояния — половина истории; вторая — узнала ли о ней система
 * мерчанта. Под какую смену встаёт доставка, решает то же правило, по
 * которому ядро её ставит в очередь (`webhookEventForStatus`), и
 * проверяется это тестом: на экране видна одна заявка, а ошибка
 * сопоставления показала бы доставку «исполнена» под «курс
 * подтверждён» — и выглядела бы правдоподобно.
 */

const at = (minute: number) => new Date(Date.UTC(2026, 8, 21, 17, minute));

const delivery = (over: Partial<TrailDeliveryInput>): TrailDeliveryInput => ({
  id: 'd1',
  endpointId: 'e1',
  event: 'exchange_request.rate_confirmed',
  status: 'delivered',
  attempt: 1,
  responseStatus: 200,
  nextAttemptAt: at(10),
  endpointUrl: 'https://shop.example/hooks',
  createdAt: at(7),
  error: null,
  ...over,
});

describe('лента заявки', () => {
  const events = [
    { fromStatus: null, toStatus: 'new', createdAt: at(0), comment: null },
    { fromStatus: 'new', toStatus: 'in_progress', createdAt: at(5), comment: null },
    { fromStatus: 'in_progress', toStatus: 'rate_confirmed', createdAt: at(7), comment: null },
  ] as const;

  it('доставка встаёт под свою смену состояния', () => {
    const trail = trailOf(events, [
      delivery({ id: 'a', event: 'exchange_request.created', createdAt: at(0) }),
      delivery({ id: 'b', event: 'exchange_request.rate_confirmed' }),
    ]);

    expect(trail.map((row) => [row.status, row.deliveries.map((one) => one.id)])).toEqual([
      ['new', ['a']],
      ['in_progress', []],
      ['rate_confirmed', ['b']],
    ]);
  });

  it('«взята в работу» доставок не имеет: это не событие', () => {
    const trail = trailOf(events, [delivery({})]);
    expect(trail.find((row) => row.status === 'in_progress')?.deliveries).toEqual([]);
  });

  it('две точки — две доставки под одной сменой, по времени', () => {
    const trail = trailOf(events, [
      delivery({ id: 'late', createdAt: at(9) }),
      delivery({ id: 'early', createdAt: at(8) }),
    ]);
    expect(trail[2]?.deliveries.map((one) => one.id)).toEqual(['early', 'late']);
  });

  it('без доставок лента остаётся лентой состояний', () => {
    const trail = trailOf(events, []);
    expect(trail).toHaveLength(3);
    expect(trail.every((row) => row.deliveries.length === 0)).toBe(true);
  });

  /*
   * Словами владельцу отдаётся только причина отмены — так решает ядро
   * (`listExchangeRequestEventsForOwner`), и сцена здесь та же: у прочих
   * событий комментария нет.
   */
  it('причина отмены доезжает до своей строки', () => {
    const trail = trailOf(
      [
        ...events,
        {
          fromStatus: 'rate_confirmed',
          toStatus: 'cancelled',
          createdAt: at(30),
          comment: 'Покупатель не заплатил',
        },
      ],
      [],
    );
    expect(trail.at(-1)?.comment).toBe('Покупатель не заплатил');
  });

  /*
   * Найдено ревью 21 сентября 2026. Передача заявки другому менеджеру
   * пишет в историю событие без смены состояния — «откуда» и «куда»
   * равны. В ленте мерчанта оно вставало второй строкой «Курс
   * подтверждён», и под обеими стоял один и тот же вебхук: читалось
   * как «прислали дважды», да ещё в момент, когда ничего не
   * отправлялось. Кто ведёт заявку — дело сервиса, мерчанту передача не
   * меняет ничего, и в его ленте ей не место.
   */
  it('передача заявки в ленту не попадает и доставку не удваивает', () => {
    const trail = trailOf(
      [
        ...events,
        { fromStatus: 'rate_confirmed', toStatus: 'rate_confirmed', createdAt: at(20), comment: null },
      ],
      [delivery({ id: 'once' })],
    );

    expect(trail.map((row) => row.status)).toEqual(['new', 'in_progress', 'rate_confirmed']);
    expect(trail.flatMap((row) => row.deliveries).map((one) => one.id)).toEqual(['once']);
  });

  it('пробная доставка к заявке не относится и в ленту не попадает', () => {
    const trail = trailOf(events, [delivery({ event: 'ping' })]);
    expect(trail.flatMap((row) => row.deliveries)).toEqual([]);
  });
});

describe('исход доставки словами', () => {
  it('доставлено — с кодом ответа', () => {
    expect(deliveryWords(delivery({}))).toEqual({ text: 'доставлен, 200', tone: 'ok' });
  });

  it('ещё не отправляли — ждёт отправки', () => {
    expect(
      deliveryWords(delivery({ status: 'pending', attempt: 0, responseStatus: null })),
    ).toEqual({ text: 'ждёт отправки', tone: 'wait' });
  });

  it('не дошёл, будет повтор — с номером попытки и кодом', () => {
    expect(
      deliveryWords(delivery({ status: 'pending', attempt: 3, responseStatus: 500 })),
    ).toEqual({ text: 'не доставлен, попытка 3 из 5, ответ 500 — будет повтор', tone: 'wait' });
  });

  it('не дошёл без ответа — приёмник молчал', () => {
    expect(
      deliveryWords(
        delivery({ status: 'pending', attempt: 2, responseStatus: null, error: 'timeout' }),
      ).text,
    ).toBe('не доставлен, попытка 2 из 5, приёмник не ответил — будет повтор');
  });

  it('провал — повторов больше не будет', () => {
    expect(
      deliveryWords(delivery({ status: 'failed', attempt: 5, responseStatus: 502 })),
    ).toEqual({ text: 'не доставлен после пяти попыток, ответ 502', tone: 'bad' });
  });

  /*
   * Найдено ревью 21 сентября 2026. Удаление точки закрывает её ждущие
   * доставки провалом при любом числе попыток, а слова провала брали
   * число из константы: «не доставлен после пяти попыток» стояло у
   * доставки, которую ни разу не отправляли.
   */
  it('провал раньше пятой попытки — это удалённая точка, а не пять попыток', () => {
    const never = deliveryWords(delivery({ status: 'failed', attempt: 0, responseStatus: null }));
    expect(never).toEqual({ text: 'не отправлен: точку удалили', tone: 'bad' });

    const twice = deliveryWords(delivery({ status: 'failed', attempt: 2, responseStatus: 500 }));
    expect(twice.text).toBe('не доставлен: точку удалили после попытки 2, ответ 500');
    expect(twice.text).not.toMatch(/пяти/);
  });

  /*
   * Номер попытки растёт, когда воркер доставку забирает, — до ответа
   * приёмника. Первая попытка, которая идёт прямо сейчас, секунду
   * читалась как «не доставлен, приёмник не ответил»: неправда о
   * доставке, которая ещё ни разу не провалилась.
   */
  it('первая попытка в полёте — «отправляется», а не «не доставлен»', () => {
    expect(
      deliveryWords(delivery({ status: 'pending', attempt: 1, responseStatus: null, error: null })),
    ).toEqual({ text: 'отправляется', tone: 'wait' });
    // Приёмник промолчал — ошибка записана, и это уже неудача.
    expect(
      deliveryWords(
        delivery({ status: 'pending', attempt: 1, responseStatus: null, error: 'timeout' }),
      ).text,
    ).toBe('не доставлен, попытка 1 из 5, приёмник не ответил — будет повтор');
  });

  it('слова проходят проверку на машинный набор', () => {
    for (const one of [
      delivery({}),
      delivery({ status: 'pending', attempt: 0, responseStatus: null }),
      delivery({ status: 'pending', attempt: 3, responseStatus: 500 }),
      delivery({ status: 'failed', attempt: 5, responseStatus: 502 }),
      delivery({ status: 'failed', attempt: 0, responseStatus: null }),
      delivery({ status: 'failed', attempt: 2, responseStatus: 500 }),
      delivery({ status: 'pending', attempt: 1, responseStatus: null, error: null }),
    ]) {
      expect(slopComplaints(`Вебхук ${deliveryWords(one).text}.`)).toEqual([]);
    }
  });
});
