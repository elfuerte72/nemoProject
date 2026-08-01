import type { ExchangeKind, ExchangeRequestStatus } from '@nemo/types';

/**
 * Состояния заявки на языке клиента.
 *
 * Формулировки взяты из `CONTEXT.md`: клиент, менеджер и код должны
 * называть один и тот же шаг одинаково, иначе разговор в поддержке
 * начинается с выяснения, что чьё «в работе» значит.
 */
export const STATUS_LABELS: Record<ExchangeRequestStatus, string> = {
  new: 'Новая — ждёт менеджера',
  in_progress: 'В работе — менеджер взял заявку',
  rate_confirmed: 'Курс подтверждён — ждём вашу оплату',
  payment_received: 'Оплата получена — готовим отправку',
  completed: 'Исполнена',
  cancelled: 'Отменена',
};

/** Способ исполнения — рядом с состояниями, чтобы подписи не разъехались. */
export const KIND_LABELS: Record<ExchangeKind, string> = {
  electronic: 'Электронный перевод',
  cash: 'Наличные',
};
