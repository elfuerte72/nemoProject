import { isFailedApiStatus, type ApiRequestLogEntry } from '@nemo/core';

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
