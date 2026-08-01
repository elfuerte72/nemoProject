import { asc, eq } from 'drizzle-orm';
import { bonusTransactions, referrals } from '@nemo/db';
import { Money, type Amount, type ReferralLine } from '@nemo/types';
import type { Executor } from './context.js';
import type { Notification } from './notifications.js';
import { readServiceSettings } from './settings.js';

/**
 * Начисление реферальных баллов — следствие исполнения заявки на обмен и
 * единственная точка начисления во всей системе.
 *
 * База начисления — доход по заявке, а не её сумма (docs/adr/0003):
 * заявка на миллион с доходом в тысячу приносит сервису тысячу, и
 * платить рефереру процент от миллиона означало бы платить больше, чем
 * заработано.
 *
 * Ставка, по которой начислено, сохраняется в самой строке движения.
 * Иначе смена ставок задним числом переписывала бы уже сделанные
 * начисления: клиент, приведший реферала на прежних условиях, обнаружил
 * бы у себя другую сумму за сделку, которая давно закрыта.
 *
 * Валюты у балла нет: баланс — сумма движений в баллах, а перевод дохода
 * в баллы по курсу ждёт блокера B3 («цена балла»). Пока доход и балл
 * считаются одной величиной, и сервис, работающий в двух валютах
 * расчёта, сложит их в один баланс. Это ограничение модели, а не
 * недосмотр реализации: колонки валюты в движении баллов нет намеренно —
 * с ней «бонусный баланс» перестал бы быть одним числом, каким его видит
 * клиент.
 */

/** Кому и сколько начислено — для уведомления рефереру. */
export interface Accrual {
  readonly referrerId: bigint;
  readonly line: ReferralLine;
  readonly amount: Amount;
}

interface AccrualInput {
  readonly requestId: string;
  readonly clientId: bigint;
  readonly serviceIncome: Amount;
}

/**
 * Начислить обеим линиям реферера того, чья заявка исполнена.
 *
 * Вызывается только из транзакции перехода в «исполнена»: начисление
 * без исполненной заявки создаёт деньги из воздуха, а исполнение без
 * начисления тихо обворовывает реферера.
 */
export async function accrueReferralBonuses(
  executor: Executor,
  input: AccrualInput,
): Promise<readonly Notification[]> {
  const settings = await readServiceSettings(executor);
  const rateByLine: Record<ReferralLine, number> = {
    1: settings.referralLine1Bps,
    2: settings.referralLine2Bps,
  };

  const lines = await executor
    .select({ referrerId: referrals.referrerId, line: referrals.line })
    .from(referrals)
    .where(eq(referrals.referralId, input.clientId))
    .orderBy(asc(referrals.line));

  const notifications: Notification[] = [];

  for (const { referrerId, line } of lines) {
    // Схема допускает только 1 и 2 (`referrals_line_range`), но колонка
    // остаётся числом, и сузить её тип может лишь проверка здесь.
    if (line !== 1 && line !== 2) continue;

    const rateBps = rateByLine[line];
    const amount = Money.percentOf(input.serviceIncome, rateBps);
    // Нулевое начисление — не движение баллов, а строка, которая ничего
    // не меняет в балансе и засоряет историю клиенту.
    if (Money.isZero(amount)) continue;

    // Повтор исключается ограничением базы, а не проверкой перед
    // вставкой: операцию могут вызвать дважды — повтором запроса, двумя
    // вкладками админки, — и защита должна лежать глубже логики.
    const [inserted] = await executor
      .insert(bonusTransactions)
      .values({
        clientId: referrerId,
        kind: 'accrual',
        amount,
        line,
        rateBps,
        exchangeRequestId: input.requestId,
      })
      .onConflictDoNothing({
        target: [
          bonusTransactions.exchangeRequestId,
          bonusTransactions.clientId,
          bonusTransactions.line,
        ],
      })
      .returning();

    // Пусто — начисление по этой заявке и линии уже было. Второе
    // уведомление рефереру означало бы, что ему начислили дважды.
    if (!inserted) continue;

    notifications.push({ kind: 'bonus-accrued', to: referrerId, line, amount });
  }

  return notifications;
}
