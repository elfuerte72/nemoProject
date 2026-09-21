import { describe, expect, it } from 'vitest';
import { slopComplaints } from '@nemo/core';
import { exchangeRequestStatuses } from '@nemo/types';
import { paymentBlockOf } from './request-card.js';

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

  it('каждое состояние заявки разобрано — новое не проскочит молча', () => {
    for (const status of exchangeRequestStatuses) {
      expect(() => paymentBlockOf({ status, paymentInstructions: INSTRUCTIONS })).not.toThrow();
    }
  });

  it('тексты проходят проверку на машинный набор', () => {
    for (const status of ['rate_confirmed', 'completed', 'cancelled'] as const) {
      const block = paymentBlockOf({ status, paymentInstructions: INSTRUCTIONS });
      expect(slopComplaints(`${block?.title}. ${block?.note}`)).toEqual([]);
    }
  });
});
