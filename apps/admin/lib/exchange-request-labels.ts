import type { ExchangeRequestStatus } from '@nemo/types';

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
