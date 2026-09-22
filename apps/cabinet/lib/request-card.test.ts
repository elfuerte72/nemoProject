import { describe, expect, it } from 'vitest';
import { slopComplaints } from '@nemo/core';
import { exchangeRequestStatuses } from '@nemo/types';
import { leftWords, pathOf, paymentBlockOf, paymentDeadlineOf } from './request-card.js';

/**
 * Блок реквизитов в карточке заявки.
 *
 * 21 сентября 2026 у исполненной заявки стояло «Куда платить» со
 * словами «на оплату — 120 мин, неоплаченную заявку сервис отменит»:
 * блок показывался всякий раз, когда реквизиты у заявки есть, а есть
 * они у неё с момента выдачи и до конца — и у оплаченной, и у
 * исполненной, и у отменённой.
 *
 * Правило вынесено из разметки и проверяется тестом, потому что ошибка
 * в нём про деньги: призыв платить у отменённой заявки — это перевод,
 * который никто не ждёт, а по реквизитам он всё равно уйдёт.
 */

const INSTRUCTIONS = 'Сбербанк, карта 4111 1111 1111 1111, Иван И.';

describe('блок реквизитов', () => {
  it('зовёт платить только заявку, которая ждёт оплаты', () => {
    const block = paymentBlockOf({ status: 'rate_confirmed', paymentInstructions: INSTRUCTIONS });
    expect(block?.kind).toBe('pay');
    expect(block?.title).toBe('Куда платить');
    // Срок оплаты называется только здесь: дальше он уже ни о чём.
    expect(block?.deadline).toBe(true);
  });

  it('у оплаченной и исполненной реквизиты — запись, а не призыв', () => {
    for (const status of ['payment_received', 'completed'] as const) {
      const block = paymentBlockOf({ status, paymentInstructions: INSTRUCTIONS });
      expect(block?.kind).toBe('paid');
      expect(block?.title).toBe('Куда платили');
      expect(block?.deadline).toBe(false);
      expect(block?.note).not.toMatch(/отменит|Проверьте получателя/);
    }
  });

  it('у отменённой говорит прямо: по ним не платить', () => {
    const block = paymentBlockOf({ status: 'cancelled', paymentInstructions: INSTRUCTIONS });
    expect(block?.kind).toBe('void');
    expect(block?.deadline).toBe(false);
    expect(block?.note).toMatch(/не платите/i);
  });

  it('без реквизитов блока нет ни в каком состоянии', () => {
    for (const status of exchangeRequestStatuses) {
      expect(paymentBlockOf({ status, paymentInstructions: null })).toBeNull();
    }
  });

  /*
   * Реквизиты ядро пишет при подтверждении курса, и раньше их у заявки
   * быть не может. Но экран — не место, где на это полагаются: заявка,
   * у которой они откуда-то взялись до срока, платить не зовёт.
   */
  it('до подтверждения курса платить не зовёт, даже если реквизиты записаны', () => {
    for (const status of ['new', 'in_progress'] as const) {
      expect(paymentBlockOf({ status, paymentInstructions: INSTRUCTIONS })).toBeNull();
    }
  });

  /*
   * Прежняя проверка — «не бросает» — не проверяла ничего: у
   * неразобранного состояния функция вернула бы `undefined` молча.
   * Полноту таблицы сторожит тип, а тест — то, что ответ осмыслен: либо
   * блока нет, либо у него есть слова.
   */
  it('о каждом состоянии ответ осмыслен: блока нет или у него есть слова', () => {
    for (const status of exchangeRequestStatuses) {
      const block = paymentBlockOf({ status, paymentInstructions: INSTRUCTIONS });
      if (block === null) continue;
      expect(block.title.length).toBeGreaterThan(0);
      expect(block.note.length).toBeGreaterThan(0);
    }
  });

  it('тексты проходят проверку на машинный набор', () => {
    for (const status of ['rate_confirmed', 'completed', 'cancelled'] as const) {
      const block = paymentBlockOf({ status, paymentInstructions: INSTRUCTIONS });
      expect(slopComplaints(`${block?.title}. ${block?.note}`)).toEqual([]);
    }
  });
});

/**
 * Строка пути: где заявка и кого она ждёт.
 *
 * Пилюля «Курс подтверждён» отвечает «где», но не отвечает на то, зачем
 * карточку открывают: кто сейчас ходит. Соответствие «состояние → шаг
 * → кого ждём» глазом по одной заявке не проверить — на экране видно
 * одно состояние из шести.
 */
describe('строка пути', () => {
  it('шагов четыре: «новая» и «в работе» для мерчанта — один шаг', () => {
    const fresh = pathOf({ status: 'new' });
    const taken = pathOf({ status: 'in_progress' });
    expect(fresh.steps.map((one) => one.label)).toEqual([
      'Новая',
      'Курс подтверждён',
      'Оплата получена',
      'Исполнена',
    ]);
    // В обоих случаях заявку ведёт менеджер, и шаг у них один и тот же.
    expect(fresh.steps.map((one) => one.state)).toEqual(taken.steps.map((one) => one.state));
    expect(fresh.steps[0]?.state).toBe('current');
  });

  it('пройденное отмечено, текущее одно, остальное впереди', () => {
    expect(pathOf({ status: 'payment_received' }).steps.map((one) => one.state)).toEqual([
      'done',
      'done',
      'current',
      'ahead',
    ]);
  });

  it('у исполненной пройдено всё, и текущего шага нет', () => {
    expect(pathOf({ status: 'completed' }).steps.map((one) => one.state)).toEqual([
      'done',
      'done',
      'done',
      'done',
    ]);
  });

  it('мерчанта ждёт только заявка с подтверждённым курсом', () => {
    for (const status of exchangeRequestStatuses) {
      expect(pathOf({ status }).waitsForMerchant).toBe(status === 'rate_confirmed');
    }
  });

  /*
   * Отменённая путь не проходит. Где она оборвалась, говорит её
   * история: последнее состояние перед отменой.
   */
  it('отменённая обрывается на том шаге, где её отменили', () => {
    const path = pathOf({ status: 'cancelled', reached: 'rate_confirmed' });
    expect(path.steps.map((one) => one.state)).toEqual(['done', 'stopped', 'ahead', 'ahead']);
    expect(path.waitsForMerchant).toBe(false);
  });

  /*
   * Найдено ревью 21 сентября 2026. Заявку, отменённую самим мерчантом,
   * — кнопкой в карточке или по API — ядро закрывает без причины, и это
   * самый частый путь отмены. Строка пути при этом обещала «причина
   * стоит ниже», а ниже не было ничего.
   */
  it('причину обещает, только когда она записана', () => {
    expect(pathOf({ status: 'cancelled', cancelReason: 'Покупатель не заплатил' }).note).toMatch(
      /Причина стоит ниже/,
    );
    const own = pathOf({ status: 'cancelled', cancelReason: null }).note;
    expect(own).not.toMatch(/причин/i);
    expect(slopComplaints(own)).toEqual([]);
  });

  it('отменённая без истории оборвалась на первом шаге', () => {
    expect(pathOf({ status: 'cancelled' }).steps.map((one) => one.state)).toEqual([
      'stopped',
      'ahead',
      'ahead',
      'ahead',
    ]);
  });

  it('о каждом состоянии сказано, кто ходит, и сказано по-человечески', () => {
    for (const status of exchangeRequestStatuses) {
      const { note } = pathOf({ status });
      expect(note.length).toBeGreaterThan(10);
      expect(slopComplaints(note)).toEqual([]);
    }
  });
});

/**
 * Срок оплаты — моментом и остатком. Считать его — работа сервиса: он
 * же его и назначил. Граница «срок вышел» проверяется тестом, потому
 * что видна она одну минуту из ста двадцати.
 */
describe('срок оплаты', () => {
  const issued = new Date('2026-09-21T17:07:00Z');

  it('момент — выдача плюс срок жизни неоплаченной заявки', () => {
    const deadline = paymentDeadlineOf(issued, 120, new Date('2026-09-21T17:55:00Z'));
    expect(deadline?.at.toISOString()).toBe('2026-09-21T19:07:00.000Z');
    expect(deadline?.leftMinutes).toBe(72);
    expect(deadline?.state).toBe('ok');
  });

  it('меньше четверти часа — срочно', () => {
    expect(paymentDeadlineOf(issued, 120, new Date('2026-09-21T18:53:00Z'))?.state).toBe('soon');
    expect(paymentDeadlineOf(issued, 120, new Date('2026-09-21T18:52:00Z'))?.state).toBe('ok');
  });

  it('остаток считается вверх: «осталась 1 мин», пока идёт последняя', () => {
    const deadline = paymentDeadlineOf(issued, 120, new Date('2026-09-21T19:06:30Z'));
    expect(deadline?.leftMinutes).toBe(1);
    expect(deadline?.state).toBe('soon');
  });

  it('срок вышел — не ноль и не минус, а отдельное состояние', () => {
    for (const now of ['2026-09-21T19:07:00Z', '2026-09-21T23:00:00Z']) {
      const deadline = paymentDeadlineOf(issued, 120, new Date(now));
      expect(deadline?.state).toBe('over');
      expect(deadline?.leftMinutes).toBe(0);
    }
  });

  it('без момента выдачи срока нет', () => {
    expect(paymentDeadlineOf(null, 120, new Date())).toBeNull();
  });
});

/*
 * Остаток — часами и минутами, а не десятичной дробью: «1,2 ч» человек
 * переводит в минуты сам, а обратный отсчёт сверяют с часами на стене.
 */
describe('остаток словами', () => {
  it('до часа — минутами', () => {
    expect(leftWords(12)).toBe('12 мин');
    expect(leftWords(1)).toBe('1 мин');
  });

  it('от часа — часами и минутами', () => {
    expect(leftWords(72)).toBe('1 ч 12 мин');
  });

  it('ровный час — без хвоста «0 мин»', () => {
    expect(leftWords(120)).toBe('2 ч');
  });
});
