import { asc, eq } from 'drizzle-orm';
import { bonusTransactions, referrals } from '@nemo/db';
import { Money, isReferralLine, type Amount, type ReferralLine } from '@nemo/types';
import type { Executor } from './context.js';
import type { Notification } from './notifications.js';
import { effectiveReferralRates, readReferralProgram } from './referral-program.js';

/**
 * Начисление реферальных баллов — следствие исполнения заявки на обмен и
 * единственная точка начисления во всей системе.
 *
 * База начисления — доход по заявке, а не её сумма (docs/adr/0003):
 * заявка на миллион с доходом в тысячу приносит сервису тысячу, и
 * платить рефереру процент от миллиона означало бы платить больше, чем
 * заработано.
 *
 * Линии — по цепочке предков, записанной при регистрации, но не глубже
 * настроенной глубины программы; ставка каждой — по старшинству «личная
 * → уровень → базовая» на момент исполнения (docs/adr/0019). Ставка, по
 * которой начислено, сохраняется в самой строке движения: иначе смена
 * ставок задним числом переписывала бы уже сделанные начисления.
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
 * Начислить реферерам того, чья заявка исполнена, — каждой оплачиваемой
 * линии.
 *
 * Вызывается только из транзакции перехода в «исполнена»: начисление
 * без исполненной заявки создаёт деньги из воздуха, а исполнение без
 * начисления тихо обворовывает реферера.
 */
export async function accrueReferralBonuses(
  executor: Executor,
  input: AccrualInput,
): Promise<readonly Notification[]> {
  const program = await readReferralProgram(executor);

  const chain = await executor
    .select({ referrerId: referrals.referrerId, line: referrals.line })
    .from(referrals)
    .where(eq(referrals.referralId, input.clientId))
    .orderBy(asc(referrals.line));

  const notifications: Notification[] = [];

  for (const { referrerId, line } of chain) {
    // Схема допускает 1..5 (`referrals_line_range`), но колонка остаётся
    // числом, и сузить её тип может лишь проверка здесь. Цепочка
    // хранится глубже, чем платится: линии за глубиной молчат.
    if (!isReferralLine(line) || line > program.depth) continue;

    const rates = await effectiveReferralRates(executor, referrerId, program);
    const rateBps = rates.lines.find((one) => one.line === line)?.rateBps ?? 0;
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
