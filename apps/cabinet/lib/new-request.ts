import {
  addressEdges,
  alipayQrHint,
  describeRequisites,
  giveFor,
  lastFour,
  Money,
  parsePromptPay,
  payoutOf,
  promptPayHint,
  submissionObstacle,
  type Amount,
  type ObstacleInput,
  type Quote,
  type RequisiteInput,
  type Sides,
} from '@nemo/types';
import { formatAmount, formatMoney } from '@nemo/ui/format';

/**
 * Правила формы новой заявки — те, которых глазом не проверить.
 *
 * Арифметика сторон, мера порога и слова препятствий живут в
 * `@nemo/types` (`payoutOf`, `giveFor`, `submissionObstacle`) и одни на
 * Mini App, кабинет и API; здесь только то, что делает форма поверх
 * них: читает набранное, решает, какая сторона считается по какой, и
 * подписывает нового получателя так же, как сохранённого.
 */

export type Side = 'give' | 'get';
export type { ObstacleInput, Sides };

/**
 * Набранное — в десятичную строку. Разряды человек разделяет пробелом,
 * дробную часть — запятой, и ни того, ни другого арифметика не
 * принимает. Мусор и отрицательное — не сумма.
 */
export function parseTyped(input: string): Amount | null {
  const cleaned = input.replace(/\s/g, '').replace(',', '.');
  const parsed = Money.amountSchema.safeParse(cleaned);
  if (!parsed.success || Money.isNegative(parsed.data)) return null;
  return parsed.data;
}

/**
 * Обе стороны сделки числами. Считается та, в которую не вводят.
 *
 * Вопросов у мерчанта два, как у клиента: «сколько дадут за мои сто
 * USDT» и «сколько USDT нужно, чтобы вышло ровно пятьдесят тысяч».
 * Второй считается вверх и тем же правилом, что у ядра: отброшенный
 * вниз хвост вернулся бы умножением как недостача. Без курса считать
 * нечем, и остаётся только набранное.
 */
export function sidesOf(typed: string, side: Side, quote: Quote | null | undefined): Sides {
  const value = parseTyped(typed);
  if (value === null) return { give: null, get: null };
  if (side === 'give') {
    return { give: value, get: quote ? payoutOf(value, quote) : null };
  }
  return { give: quote ? giveFor(value, quote) : null, get: value };
}

/**
 * Что мешает подать заявку — правило и слова одни с Mini App
 * (`submissionObstacle` в `@nemo/types`); здесь только разряды у сумм.
 */
export function obstacleOf(input: ObstacleInput): string | undefined {
  return submissionObstacle(input, formatMoney);
}

/**
 * Набранное — с разрядами, когда набор окончен. Только если набрано
 * число: мусор остаётся как есть, подменять его на «0» значило бы
 * стереть опечатку вместе с тем, что человек хотел набрать.
 */
export function normalizeTyped(input: string): string {
  const value = parseTyped(input);
  return value === null ? input : formatAmount(value);
}

/**
 * Получатель, названный прямо в заявке, — той же подписью, под которой
 * сохранённая запись стоит в списке: в сводке перед подачей новый и
 * сохранённый должны читаться одинаково. Хвосты — теми же `lastFour` и
 * `addressEdges`, какими их посчитает ядро при записи.
 */
export function describeRecipientInput(input: RequisiteInput): string {
  const empty = {
    bankName: null,
    phone: null,
    cardLast4: null,
    network: null,
    addressHint: null,
    accountLast4: null,
    qrHint: null,
    promptpayIdType: null,
    alipayAccount: null,
  };
  switch (input.kind) {
    case 'phone':
      return describeRequisites({ ...empty, kind: input.kind, bankName: input.bankName, phone: input.phone });
    case 'card':
      return describeRequisites({
        ...empty,
        kind: input.kind,
        bankName: input.bankName,
        cardLast4: lastFour(input.cardNumber),
      });
    case 'wallet':
      return describeRequisites({
        ...empty,
        kind: input.kind,
        network: input.network,
        addressHint: addressEdges(input.address),
      });
    case 'account':
      return describeRequisites({
        ...empty,
        kind: input.kind,
        bankName: input.bankName,
        accountLast4: input.accountNumber.replace(/\D/g, '').slice(-4),
      });
    case 'promptpay': {
      const parsed = parsePromptPay(input.qr);
      return describeRequisites({
        ...empty,
        kind: input.kind,
        promptpayIdType: parsed.ok ? parsed.idType : null,
        qrHint: parsed.ok ? promptPayHint(parsed.id) : null,
      });
    }
    case 'alipay':
      return describeRequisites({ ...empty, kind: input.kind, alipayAccount: input.account });
    case 'alipay_qr':
      return describeRequisites({ ...empty, kind: input.kind, qrHint: alipayQrHint(input.qr) });
  }
}
