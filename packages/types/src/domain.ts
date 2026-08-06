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
 * Здесь только форма кода, а не список: сети живут справочником в базе,
 * и администратор гасит ту, в которой кошелёк временно недоступен.
 * Перечисление в коде было бы второй правдой о том, куда сервис умеет
 * отправлять, — и рано или поздно разошлось бы со справочником.
 */
export const networkCodeSchema = z.string().min(2).max(20);

/**
 * Способ, которым клиент получает деньги.
 *
 * Тип записи, а не набор необязательных полей: реквизит, по которому
 * нельзя отправить деньги, не должен существовать. Что обязательно
 * внутри каждого типа, проверяет база — форма всего лишь не даёт
 * составить неполную запись раньше неё.
 */
export const requisiteKinds = [
  'phone', // перевод по номеру телефона
  'card', // перевод на карту
  'wallet', // перевод на криптокошелёк
] as const;
export const requisiteKindSchema = z.enum(requisiteKinds);
export type RequisiteKind = z.infer<typeof requisiteKindSchema>;

/** Валюта бывает фиатной и криптовалютной: от этого зависит, куда её отправлять. */
export const currencyKinds = ['fiat', 'crypto'] as const;
export const currencyKindSchema = z.enum(currencyKinds);
export type CurrencyKind = z.infer<typeof currencyKindSchema>;

/**
 * Подходит ли реквизит валюте, которую клиент получает.
 *
 * Рубли приходят на карту или по телефону, USDT — на кошелёк. Правило
 * живёт в доменных типах, а не в операции: отказывает всё равно
 * операция, но экран должен показать клиенту только подходящие записи —
 * и делать это по своей копии правила означало бы разойтись с ядром
 * молча.
 */
export function requisiteKindSuits(kind: RequisiteKind, currency: CurrencyKind): boolean {
  return currency === 'crypto' ? kind === 'wallet' : kind !== 'wallet';
}

/**
 * Проверки реквизита на правдоподобие.
 *
 * Не на подлинность: существует ли карта и чей это кошелёк, знает только
 * банк и сеть. Ловится другое — опечатка: переставленные цифры,
 * недобитый до конца адрес, номер телефона вместо номера карты. Этого
 * достаточно, потому что цена ошибки здесь — перевод, который не
 * возвращается.
 *
 * Правила живут в доменных типах, а не в форме: форма не единственный
 * способ создать запись, и отказывает всё равно операция. Экран
 * повторяет их, чтобы сказать об ошибке до сохранения, а не после.
 */

/**
 * Номер карты — по контрольной сумме Луна.
 *
 * Ею проверяются все платёжные карты, и одна переставленная пара цифр
 * её не проходит. Длина от тринадцати до девятнадцати — весь диапазон
 * стандарта, от старых Visa до Maestro.
 */
export function looksLikeCardNumber(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;

  let sum = 0;
  let double = false;
  for (let at = digits.length - 1; at >= 0; at -= 1) {
    let digit = digits.charCodeAt(at) - 48;
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * Телефон — по числу цифр.
 *
 * Формат не проверяется: у сервиса клиенты в разных странах, и
 * российская маска отвергла бы тайский номер. Десять цифр — короткий
 * национальный номер, пятнадцать — потолок международного стандарта.
 */
export function looksLikePhone(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15;
}

/**
 * Форма адреса в известных сетях.
 *
 * Сеть, которой здесь нет, проверку проходит: справочник ведёт
 * администратор, и запрет на всё незнакомое означал бы, что заведённая
 * им сеть не работает, пока её не впишут в код.
 *
 * TRC20 — тридцать четыре знака base58 от буквы «T». TON — сорок восемь
 * знаков base64url в дружественном виде или «рабочая цепочка: шестьдесят
 * четыре шестнадцатеричных» в сыром.
 */
const WALLET_ADDRESS_FORMS: Readonly<Record<string, RegExp>> = {
  TRC20: /^T[1-9A-HJ-NP-Za-km-z]{33}$/,
  TON: /^(?:[A-Za-z0-9_-]{48}|-?\d+:[0-9a-fA-F]{64})$/,
};

export function looksLikeWalletAddress(network: string, address: string): boolean {
  const form = WALLET_ADDRESS_FORMS[network.toUpperCase()];
  return form ? form.test(address.trim()) : address.trim().length > 0;
}

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
  kind: currencyKindSchema,
});
export type Currency = z.infer<typeof currencySchema>;
