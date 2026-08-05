import type { ExchangeKind, ExchangeRequestStatus } from '@nemo/types';

/**
 * Состояния заявки на языке клиента.
 *
 * Формулировки взяты из `CONTEXT.md`: клиент, менеджер и код должны
 * называть один и тот же шаг одинаково, иначе разговор в поддержке
 * начинается с выяснения, что чьё «в работе» значит.
 *
 * Название шага и то, чей сейчас ход, разведены по двум словарям:
 * на карточке заявки они стоят друг под другом, и склеенные в одну
 * строку — «Курс подтверждён — ждём вашу оплату» — повторяли бы сами
 * себя.
 */

/**
 * Путь заявки от подачи до исполнения. Отмена сюда не входит: это не
 * шаг вперёд, а выход, и на полосе прогресса ей места нет.
 */
export const REQUEST_STEPS = [
  'new',
  'in_progress',
  'rate_confirmed',
  'payment_received',
  'completed',
] as const satisfies readonly ExchangeRequestStatus[];

export type RequestStep = (typeof REQUEST_STEPS)[number];

/** Где заявка сейчас. */
export const STEP_LABELS: Record<RequestStep, string> = {
  new: 'Новая',
  in_progress: 'В работе',
  rate_confirmed: 'Курс подтверждён',
  payment_received: 'Оплата получена',
  completed: 'Исполнена',
};

/** Чей сейчас ход — единственный вопрос клиента: ждать или действовать. */
export const STEP_NOTES: Record<RequestStep, string> = {
  new: 'Ждёт менеджера',
  in_progress: 'Менеджер взял заявку',
  rate_confirmed: 'Ждём вашу оплату',
  payment_received: 'Готовим отправку',
  completed: 'Деньги отправлены',
};

/**
 * Способ исполнения — так, как он читается и в переключателе, и в
 * строке истории: «получить наличными», «получено переводом». Термин
 * тот же, что в `CONTEXT.md`, но в форме, в которой он стоит в
 * предложении, а не в заголовке словаря.
 */
export const KIND_LABELS: Record<ExchangeKind, string> = {
  electronic: 'Переводом',
  cash: 'Наличными',
};

/**
 * Заявка ещё в пути. На главной такая показывается карточкой с оплатой
 * и отменой, в ленте истории — строкой, которая туда же и ведёт.
 */
export function isOpen(status: ExchangeRequestStatus): boolean {
  return status !== 'completed' && status !== 'cancelled';
}

/**
 * Шаг на полосе прогресса. Отмены на ней нет — это не шаг вперёд, а
 * выход, и карточкой отменённая заявка уже не показывается.
 */
export function stepOf(status: ExchangeRequestStatus): RequestStep {
  return status === 'cancelled' ? 'new' : status;
}

/**
 * Исход заявки строкой: в истории отмена — такой же исход, как
 * исполнение.
 *
 * Здесь, а не рядом с экраном: строку эту показывают оба — главная в
 * своей карточке и лента истории, — и разойдись они, один и тот же
 * статус назывался бы в приложении двумя словами.
 */
export function outcomeOf(status: ExchangeRequestStatus): string {
  return status === 'cancelled' ? 'Отменена' : STEP_LABELS[stepOf(status)];
}
