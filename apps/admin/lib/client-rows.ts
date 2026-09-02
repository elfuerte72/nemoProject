import type { ClientRow, ClientTab } from '@nemo/core';
import type { MoneyLine } from '@/lib/money-list';

/**
 * Строка клиента, какой она едет в клиентский компонент: `bigint` и
 * `Date` сериализация серверных компонентов не переносит. Тот же вид
 * отдаёт маршрут дочитывания.
 */
export interface ClientRowDto {
  readonly id: string;
  readonly username: string | null;
  readonly createdAt: string;
  /** Точное время регистрации из базы — курсор дочитывания. */
  readonly cursor: string;
  readonly completed: number;
  readonly cancelled: number;
  readonly open: number;
  readonly lastRequestAt: string | null;
  readonly turnover: readonly MoneyLine[];
  readonly waiting: boolean;
  readonly regular: boolean;
}

export function toClientRowDto(row: ClientRow): ClientRowDto {
  return {
    id: row.telegramUserId.toString(),
    username: row.username,
    createdAt: row.createdAt.toISOString(),
    cursor: row.cursor,
    completed: row.completed,
    cancelled: row.cancelled,
    open: row.open,
    lastRequestAt: row.lastRequestAt?.toISOString() ?? null,
    turnover: row.turnover,
    waiting: row.waiting,
    regular: row.regular,
  };
}

export const clientTabs: readonly ClientTab[] = ['all', 'regular', 'waiting'];

export const CLIENT_TAB_LABELS: Record<ClientTab, string> = {
  all: 'Все',
  regular: 'Постоянные',
  waiting: 'Ждут ответа',
};

export function pickTab(value: string | undefined): ClientTab {
  return (clientTabs as readonly string[]).includes(value ?? '') ? (value as ClientTab) : 'all';
}
