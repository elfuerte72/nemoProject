import type { V1ErrorCode } from './handler';
import { RATE_LIMITS } from './rate-limit';

/**
 * Справка API, которую читает разработчик мерчанта: коды ошибок с тем,
 * что делать, и заголовки ответа. Таблицей «код — что значит — что
 * делать», как у Love&Pay v2: разработчик ищет по коду, пришедшему в
 * ответе, а не читает абзацы.
 *
 * Здесь, а не в YAML: `Record<V1ErrorCode, …>` не соберётся, если код
 * заведён в адаптере, а описать его забыли. Что договор называет те же
 * коды, сверяет тест (`openapi.test.ts`).
 */

export interface ErrorReference {
  readonly status: number;
  readonly meaning: string;
  readonly action: string;
}

export const V1_ERRORS: Record<V1ErrorCode, ErrorReference> = {
  unauthorized: {
    status: 401,
    meaning: 'Ключа нет, он не подходит или отозван; анкета не одобрена или доступ закрыт.',
    action: 'Проверьте ключ в разделе «API»; отозванный замените новым.',
  },
  invalid_signature: {
    status: 401,
    meaning: 'Подпись обязательна, а её нет, она не сошлась, устарела или уже была.',
    action:
      'Подписывайте метод, путь со строкой запроса, x-timestamp в секундах и SHA-256 тела ' +
      'через перевод строки; сверьте часы сервера.',
  },
  address_not_allowed: {
    status: 403,
    meaning: 'Вызов пришёл с адреса, которого нет в списке разрешённых.',
    action: 'Добавьте адрес сервера в разделе «API» или зовите с разрешённого.',
  },
  forbidden: {
    status: 403,
    meaning: 'Обмен закрыт: анкета ещё не одобрена или мерчант отключён.',
    action: 'Дождитесь одобрения анкеты или напишите в поддержку.',
  },
  not_found: {
    status: 404,
    meaning: 'Нет такой заявки или записи — или она не ваша.',
    action: 'Проверьте номер: он наш, из ответа на подачу, а не номер вашего заказа.',
  },
  transition_not_allowed: {
    status: 409,
    meaning: 'Заявка уже не в том состоянии: например, отменять поздно.',
    action: 'Перечитайте заявку и решите по её состоянию.',
  },
  conflict: {
    status: 409,
    meaning: 'Кто-то успел раньше или такое уже есть.',
    action: 'Перечитайте состояние; повтор подачи делайте с тем же Idempotency-Key.',
  },
  invalid_input: {
    status: 422,
    meaning: 'Запрос не проходит правило: сумма ниже минимума, направление закрыто, реквизит с ошибкой.',
    action: 'Исправьте то, что названо в message, и отправьте снова.',
  },
  rate_limited: {
    status: 429,
    meaning:
      `Сверх предела: ${RATE_LIMITS.perMinute} вызовов в минуту или ${RATE_LIMITS.perHour} в час ` +
      'на ключ; или с адреса пришло много неверных ключей.',
    action: 'Подождите столько секунд, сколько в retry-after; следите за x-ratelimit-remaining-*.',
  },
  internal: {
    status: 500,
    meaning: 'Сбой на нашей стороне.',
    action: 'Повторите позже; если не проходит — напишите в поддержку и назовите x-request-id.',
  },
  unavailable: {
    status: 503,
    meaning: 'Источник котировок молчит.',
    action: 'Повторите как есть через минуту; заявку можно подать и без курса.',
  },
};

/** Коды в порядке статуса: так их и ищут глазами. */
export const V1_ERROR_CODES = (Object.keys(V1_ERRORS) as V1ErrorCode[]).sort(
  (a, b) => V1_ERRORS[a].status - V1_ERRORS[b].status,
);

export interface HeaderReference {
  readonly name: string;
  readonly meaning: string;
}

export const V1_RESPONSE_HEADERS: readonly HeaderReference[] = [
  {
    name: 'x-request-id',
    meaning:
      'Идентификатор вызова — у каждого ответа. По нему вызов находится в журнале, назовите ' +
      'его поддержке.',
  },
  {
    name: 'x-ratelimit-limit-minute',
    meaning: `Предел вызовов в минуту на ключ — ${RATE_LIMITS.perMinute}.`,
  },
  { name: 'x-ratelimit-remaining-minute', meaning: 'Сколько вызовов осталось в этой минуте.' },
  {
    name: 'x-ratelimit-limit-hour',
    meaning: `Предел вызовов в час на ключ — ${RATE_LIMITS.perHour}.`,
  },
  { name: 'x-ratelimit-remaining-hour', meaning: 'Сколько вызовов осталось в этом часе.' },
  {
    name: 'x-ratelimit-reset',
    meaning: 'Когда откроется окно, которое сейчас держит, — время ISO 8601 в UTC.',
  },
  { name: 'retry-after', meaning: 'Только у ответа 429: через сколько секунд повторить.' },
];
