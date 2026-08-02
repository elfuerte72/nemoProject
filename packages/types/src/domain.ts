import { z } from 'zod';

/**
 * Перечисления доменного языка проекта. Русские названия терминов —
 * в `CONTEXT.md` в корне репозитория; здесь их машинные соответствия.
 */

/** Идентификатор клиента. Telegram отдаёт число, но оно уже вышло за 32 бита. */
export const telegramUserIdSchema = z.coerce.bigint().positive();
export type TelegramUserId = z.infer<typeof telegramUserIdSchema>;

/**
 * Состояния заявки на обмен.
 *
 * `new` ставит система; все остальные — менеджер. Переход в `completed`
 * — единственная точка, где фиксируется доход по заявке и начисляются
 * реферальные баллы (см. docs/adr/0003).
 */
export const exchangeRequestStatuses = [
  'new', // новая
  'in_progress', // в работе
  'rate_confirmed', // курс подтверждён
  'payment_received', // оплата получена
  'completed', // исполнена
  'cancelled', // отменена
] as const;
export const exchangeRequestStatusSchema = z.enum(exchangeRequestStatuses);
export type ExchangeRequestStatus = z.infer<typeof exchangeRequestStatusSchema>;

/** Допустимые переходы. Всё, чего здесь нет, — ошибка, а не «на всякий случай». */
export const exchangeRequestTransitions: Record<
  ExchangeRequestStatus,
  readonly ExchangeRequestStatus[]
> = {
  new: ['in_progress', 'cancelled'],
  in_progress: ['rate_confirmed', 'cancelled'],
  rate_confirmed: ['payment_received', 'cancelled'],
  payment_received: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

export function canTransition(
  from: ExchangeRequestStatus,
  to: ExchangeRequestStatus,
): boolean {
  return exchangeRequestTransitions[from].includes(to);
}

/** Тип исполнения обмена. У наличных курс называет менеджер после подачи заявки. */
export const exchangeKinds = ['electronic', 'cash'] as const;
export const exchangeKindSchema = z.enum(exchangeKinds);
export type ExchangeKind = z.infer<typeof exchangeKindSchema>;

/** Состояния заявки на вывод бонусных баллов. */
export const withdrawalRequestStatuses = [
  'new', // новая
  'approved', // одобрена
  'paid', // выплачена
  'rejected', // отклонена
] as const;
export const withdrawalRequestStatusSchema = z.enum(withdrawalRequestStatuses);
export type WithdrawalRequestStatus = z.infer<typeof withdrawalRequestStatusSchema>;

/**
 * Допустимые переходы заявки на вывод. Отдельная таблица от заявки на
 * обмен: у них разные жизненные циклы, и объединять их значило бы
 * разрешить «оплата получена» там, где оплаты нет.
 *
 * Баллы списываются в «выплачена» — это состояние конечное, и вернуться
 * из него нельзя: возврат означал бы, что баллы появились обратно, а
 * деньги у клиента уже.
 */
export const withdrawalRequestTransitions: Record<
  WithdrawalRequestStatus,
  readonly WithdrawalRequestStatus[]
> = {
  new: ['approved', 'rejected'],
  approved: ['paid', 'rejected'],
  paid: [],
  rejected: [],
};

export function canTransitionWithdrawal(
  from: WithdrawalRequestStatus,
  to: WithdrawalRequestStatus,
): boolean {
  return withdrawalRequestTransitions[from].includes(to);
}

/** Заявка ещё в работе: из этого состояния куда-то ведёт переход. */
export function isWithdrawalOpen(status: WithdrawalRequestStatus): boolean {
  return withdrawalRequestTransitions[status].length > 0;
}

/** Способ выплаты бонусов. Исполняет менеджер вручную. */
export const withdrawalMethods = ['bank', 'crypto'] as const;
export const withdrawalMethodSchema = z.enum(withdrawalMethods);
export type WithdrawalMethod = z.infer<typeof withdrawalMethodSchema>;

/**
 * Сеть, в которой ждут перевод.
 *
 * Отдельно от адреса, потому что один и тот же адрес живёт в нескольких
 * сетях, а перевод в чужую — потерянные деньги без возврата. Спросить
 * сеть дешевле, чем выяснять её у клиента после отправки.
 *
 * Список задан здесь, а не в интерфейсе: и клиент, и менеджер должны
 * называть сеть одинаково, иначе «TRC20» и «Tron» в двух окнах окажутся
 * разными вещами.
 */
export const withdrawalNetworks = ['TRC20', 'ERC20', 'BEP20', 'TON', 'SOL'] as const;
export const withdrawalNetworkSchema = z.enum(withdrawalNetworks);
export type WithdrawalNetwork = z.infer<typeof withdrawalNetworkSchema>;

/**
 * Состояния заявки на карту. Сервис карту не выпускает — статусы
 * отражают то, что сообщил внешний провайдер (см. docs/adr/0004).
 */
export const cardApplicationStatuses = [
  'submitted', // подана
  'processing', // в обработке
  'active', // активна
  'rejected', // отклонена провайдером
  'cancelled', // отозвана клиентом, пока провайдер за неё не взялся
] as const;
export const cardApplicationStatusSchema = z.enum(cardApplicationStatuses);
export type CardApplicationStatus = z.infer<typeof cardApplicationStatusSchema>;

/**
 * Допустимые переходы заявки на карту. Менеджер ведёт их по тому, что
 * сообщил провайдер: сервис карту не выпускает и сам ничего решить не
 * может.
 */
export const cardApplicationTransitions: Record<
  CardApplicationStatus,
  readonly CardApplicationStatus[]
> = {
  submitted: ['processing', 'rejected'],
  processing: ['active', 'rejected'],
  active: [],
  rejected: [],
  // Отзыв клиентом — не переход менеджера: сюда заявку уводит сам
  // клиент, и обратной дороги из этого состояния нет.
  cancelled: [],
};

export function canTransitionCardApplication(
  from: CardApplicationStatus,
  to: CardApplicationStatus,
): boolean {
  return cardApplicationTransitions[from].includes(to);
}

/** Заявка на карту ещё в работе: из этого состояния куда-то ведёт переход. */
export function isCardApplicationOpen(status: CardApplicationStatus): boolean {
  return cardApplicationTransitions[status].length > 0;
}

/**
 * Движение бонусных баллов. Баланс — сумма движений, поэтому списание
 * при выплате хранится отрицательной величиной: отдельного знака у
 * движения нет, иначе баланс пришлось бы считать по правилу «сложить
 * одни виды и вычесть другие», и это правило разошлось бы между местами.
 */
export const bonusTransactionKinds = [
  'accrual', // начисление за исполненную заявку реферала
  'withdrawal', // списание при выплате
  'adjustment', // ручная правка администратором
] as const;
export const bonusTransactionKindSchema = z.enum(bonusTransactionKinds);
export type BonusTransactionKind = z.infer<typeof bonusTransactionKindSchema>;

/** Линия реферальной сети. Глубже второй начисления не идут. */
export const referralLines = [1, 2] as const;
export const referralLineSchema = z.union([z.literal(1), z.literal(2)]);
export type ReferralLine = z.infer<typeof referralLineSchema>;

/**
 * Кто выполнил действие. Система ставит только начальные состояния;
 * клиент подаёт заявку на обмен и отменяет её, пока она новая; всё
 * остальное делает менеджер.
 */
export const actorTypes = ['system', 'client', 'manager'] as const;
export const actorTypeSchema = z.enum(actorTypes);
export type ActorType = z.infer<typeof actorTypeSchema>;

/** Роль сотрудника в админ-панели. */
export const staffRoles = ['manager', 'admin'] as const;
export const staffRoleSchema = z.enum(staffRoles);
export type StaffRole = z.infer<typeof staffRoleSchema>;

/** Валюта: код и число знаков после запятой для показа клиенту. */
export const currencySchema = z.object({
  code: z.string().min(2).max(12),
  decimals: z.number().int().min(0).max(18),
  kind: z.enum(['fiat', 'crypto']),
});
export type Currency = z.infer<typeof currencySchema>;
