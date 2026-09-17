import { eq } from 'drizzle-orm';
import { bonusTransactions, clients } from '@nemo/db';
import { Money } from '@nemo/types';
import { requireAdmin, type Actor } from './actor.js';
import { bonusStanding, toBonusTransactionView, type BonusTransactionView } from './bonus-account.js';
import type { CoreConfig } from './context.js';
import { InvalidInputError, NotFoundError } from './errors.js';

/**
 * Правка баллов руками — движение вида `adjustment`.
 *
 * Нужна рядом с личными ставками: там, где ставку назначили руками,
 * ошибку правят тоже руками. Комментарий обязателен — движение без
 * причины через месяц не отличить от сбоя; кто правил, пишется в строку.
 * Ниже нуля счёт не уходит: снятое сверх остатка было бы долгом
 * клиента, которого программа не знает. Снять можно только доступное —
 * баллы под поданной заявкой на вывод уже обещаны.
 */

export interface AdjustBonusInput {
  /** Со знаком: плюс начисляет, минус снимает. */
  readonly amount: string;
  readonly comment: string;
}

export async function adjustBonus(
  ctx: CoreConfig,
  actor: Actor,
  clientId: bigint,
  input: AdjustBonusInput,
): Promise<BonusTransactionView> {
  const admin = requireAdmin(actor);
  const parsed = Money.amountSchema.safeParse(input.amount);
  if (!parsed.success || Money.isZero(parsed.data)) {
    throw new InvalidInputError('Сумма правки — число со знаком, не ноль');
  }
  const amount = parsed.data;
  const comment = input.comment.trim();
  if (comment.length === 0) {
    throw new InvalidInputError('Комментарий обязателен: за что начислено или снято');
  }

  return ctx.db.transaction(async (tx) => {
    // Строка клиента под замком на время подсчёта — как при заявке на
    // вывод: два снятия разом иначе прочли бы один остаток.
    const [client] = await tx
      .select({ id: clients.telegramUserId })
      .from(clients)
      .where(eq(clients.telegramUserId, clientId))
      .limit(1)
      .for('update');
    if (!client) {
      throw new NotFoundError('Клиент не найден');
    }
    if (Money.isNegative(amount)) {
      // Мерится доступным, а не остатком: баллы под поданной заявкой на
      // вывод уже обещаны клиенту, и снятые, они всё равно ушли бы
      // деньгами при выплате — счёт стал бы отрицательным.
      const { balance, held, available } = await bonusStanding(tx, clientId);
      if (Money.isNegative(Money.add(available, amount))) {
        throw new InvalidInputError(
          Money.isZero(held)
            ? `Снять больше остатка нельзя: на счёте ${balance}`
            : `Снять больше доступного нельзя: доступно ${available} из ${balance}, ` +
                `${held} ждут выплаты по заявке на вывод. Сначала отклоните её в разделе «Вывод»`,
        );
      }
    }
    const [row] = await tx
      .insert(bonusTransactions)
      .values({ clientId, kind: 'adjustment', amount, comment, staffId: admin.staffId })
      .returning();
    return toBonusTransactionView(row!);
  });
}
