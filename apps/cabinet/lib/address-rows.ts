import type { ApiAddressView } from '@nemo/core';

/** Разрешённый адрес для экрана: дата строкой — список живёт в клиентском компоненте. */
export interface AddressRow {
  readonly id: string;
  readonly address: string;
  readonly note: string | null;
  readonly createdAt: string;
}

export function toAddressRow(view: ApiAddressView): AddressRow {
  return {
    id: view.id,
    address: view.address,
    note: view.note,
    createdAt: view.createdAt.toISOString(),
  };
}
