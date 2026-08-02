import type { ExchangeKind, ExchangeRequestStatus } from '@nemo/types';

/**
 * Состояния заявки словами из `CONTEXT.md`. Менеджер и клиент видят
 * один и тот же шаг под одним и тем же названием — иначе разговор
 * начинается с выяснения, чьё «в работе» имеется в виду.
 */
export const STATUS_LABELS: Record<ExchangeRequestStatus, string> = {
  new: 'Новая',
  in_progress: 'В работе',
  rate_confirmed: 'Курс подтверждён',
  payment_received: 'Оплата получена',
  completed: 'Исполнена',
  cancelled: 'Отменена',
};

/**
 * Цвет состояния. Золотом отмечено ровно то, что ждёт менеджера:
 * очередь на экране длинная, и цвет здесь отвечает на вопрос «за что
 * браться», а не украшает строку. Взятая в работу заявка ничего не
 * ждёт — она уже у кого-то, и золота ей не положено.
 */
export const STATUS_TONES: Record<ExchangeRequestStatus, PillTone> = {
  new: 'wait',
  in_progress: 'plain',
  rate_confirmed: 'plain',
  payment_received: 'wait',
  completed: 'done',
  cancelled: 'off',
};

export type PillTone = 'plain' | 'wait' | 'done' | 'off';

/** Способ исполнения. Одна карта на всю админку: в двух местах подписи разошлись. */
export const KIND_LABELS: Record<ExchangeKind, string> = {
  electronic: 'электронный перевод',
  cash: 'наличные',
};
