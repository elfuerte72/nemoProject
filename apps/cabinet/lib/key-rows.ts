import type { ApiKeyView } from '@nemo/core';

/**
 * Ключ для экрана: то же, что в ядре, но датами-строками — список
 * живёт в клиентском компоненте, и `Date` через его границу не
 * переезжает.
 */
export interface KeyRow {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly issuedAt: string;
  readonly revokedAt: string | null;
  readonly lastUsedAt: string | null;
}

export function toKeyRow(key: ApiKeyView): KeyRow {
  return {
    id: key.id,
    label: key.label,
    hint: key.hint,
    issuedAt: key.issuedAt.toISOString(),
    revokedAt: key.revokedAt?.toISOString() ?? null,
    lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
  };
}
