import type { ApiRequestLogEntry, ApiRequestLogFilter } from '@nemo/core';
import { API_LOG_METHODS, isFailedApiStatus } from '@nemo/types';

/**
 * Строка журнала вызовов для экрана — датами-строками, как и заявки:
 * хвост дочитывается в браузере.
 */
export interface CallRow {
  readonly id: string;
  readonly keyLabel: string;
  readonly keyHint: string;
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly durationMs: number;
  readonly address: string | null;
  readonly error: string | null;
  /** Машинный код отказа — тот, что ушёл в теле ответа. */
  readonly errorCode: string | null;
  /** Из заголовка `x-request-id`; у вызовов до 24 сентября 2026 пуст. */
  readonly requestId: string | null;
  /** ISO-строка: она же курсор вместе с номером. */
  readonly at: string;
}

export function toCallRow(entry: ApiRequestLogEntry): CallRow {
  return {
    id: entry.id,
    keyLabel: entry.keyLabel,
    keyHint: entry.keyHint,
    method: entry.method,
    path: entry.path,
    status: entry.status,
    durationMs: entry.durationMs,
    address: entry.address,
    error: entry.error,
    errorCode: entry.errorCode,
    requestId: entry.requestId,
    at: entry.at.toISOString(),
  };
}

/** Табы журнала: все вызовы, удачные, отказы. Живут в адресе. */
export const CALL_OUTCOMES = ['all', 'ok', 'error'] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

export const OUTCOME_LABELS: Record<CallOutcome, string> = {
  all: 'Все',
  ok: 'Успешные',
  error: 'С ошибкой',
};

export function pickOutcome(value: string | undefined): CallOutcome {
  return CALL_OUTCOMES.find((one) => one === value) ?? 'all';
}

/** Столько строк на странице журнала. */
export const CALLS_PAGE = 50;

/** Успех — тем же правилом, что считает плитки ядро. */
export function isOk(status: number): boolean {
  return !isFailedApiStatus(status);
}

/** Метод в фильтре: один из тех, что принимает API, иначе «любой». */
export function pickMethod(value: string | undefined): string | undefined {
  const method = value?.trim().toUpperCase();
  return method && (API_LOG_METHODS as readonly string[]).includes(method) ? method : undefined;
}

/**
 * Отбор журнала из адреса — один на страницу и на маршрут дочитывания:
 * хвост, дочитанный по другому правилу, чем первая страница, дописал бы
 * к списку чужие строки.
 */
export interface CallFilter {
  readonly outcome: CallOutcome;
  readonly keyId: string | undefined;
  readonly method: string | undefined;
  readonly search: string | undefined;
}

export function readCallFilter(get: (name: string) => string | undefined): CallFilter {
  return {
    outcome: pickOutcome(get('outcome')),
    keyId: uuidOrUndefined(get('key')),
    method: pickMethod(get('method')),
    search: get('q')?.trim().slice(0, 100) || undefined,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ключ из адреса — только вида uuid: «?key=abc» база отвергла бы пятисотым. */
function uuidOrUndefined(value: string | undefined): string | undefined {
  const one = value?.trim();
  return one && UUID.test(one) ? one : undefined;
}

/** Тот же отбор словами ядра. */
export function coreCallFilter(filter: CallFilter): Omit<ApiRequestLogFilter, 'limit' | 'after'> {
  return {
    ...(filter.outcome === 'all' ? {} : { outcome: filter.outcome }),
    ...(filter.keyId ? { keyId: filter.keyId } : {}),
    ...(filter.method ? { method: filter.method } : {}),
    ...(filter.search ? { search: filter.search } : {}),
  };
}

/** Строка адреса для отбора: пустые поля не пишутся. */
export function callFilterQuery(filter: CallFilter): URLSearchParams {
  const query = new URLSearchParams();
  if (filter.outcome !== 'all') query.set('outcome', filter.outcome);
  if (filter.keyId) query.set('key', filter.keyId);
  if (filter.method) query.set('method', filter.method);
  if (filter.search) query.set('q', filter.search);
  return query;
}
