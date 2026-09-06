import type { MerchantStatus } from '@nemo/types';
import { merchantStatuses } from '@nemo/types';

/**
 * Табы раздела «Мерчанты» и подписи к ним.
 *
 * Порядок — по пути мерчанта через сервис: анкета, работа, отказ,
 * отключение. Первым стоит то, что ждёт человека: администратор
 * открывает раздел, чтобы рассмотреть анкету, а не чтобы полюбоваться
 * списком активных.
 */
export const MERCHANT_TABS: readonly MerchantStatus[] = [
  'pending',
  'active',
  'rejected',
  'disabled',
];

export const MERCHANT_TAB_LABELS: Readonly<Record<MerchantStatus, string>> = {
  pending: 'На рассмотрении',
  active: 'Активные',
  rejected: 'Отклонённые',
  disabled: 'Отключённые',
};

/** Состояние из адреса; незнакомое — как будто его не называли. */
export function pickMerchantStatus(value: string | undefined): MerchantStatus | undefined {
  return merchantStatuses.find((one) => one === value);
}
