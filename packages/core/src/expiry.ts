import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { exchangeRequestEvents, exchangeRequests } from '@nemo/db';
import type { CoreConfig } from './context.js';
import type { Notification } from './notifications.js';
import { readServiceSettings } from './settings.js';

/**
 * Истечение неоплаченной заявки.
 *
 * Курс заявки — обязательство сервиса (docs/adr/0006), и бессрочным оно
 * быть не может: клиент вернулся бы к нему тогда, когда рынок ушёл в
 * его пользу, и не вернулся бы, когда против. Срок отсчитывается от
 * момента, когда менеджер выдал реквизиты, — то есть когда клиент
 * впервые мог заплатить.
 *
 * Момент передаётся параметром, а не берётся из системных часов внутри:
 * тогда планировщик и тест вызывают одно и то же, и подменять время в
 * тестах не нужно ни в одном.
 *
 * Обе операции меняют состояние условно — одним `update` с проверкой в
 * `where`, а не «прочитать, решить, записать». Вызывает их защищённый
 * маршрут, но защищает он от чужих, а не от повтора: два наложившихся
 * вызова не должны ни отменить заявку, оплаченную между ними, ни
 * прислать клиенту два одинаковых предупреждения.
 */

/** За сколько до истечения бот предупреждает клиента. */
const WARNING_MINUTES = 30;

type ExchangeRequestRow = typeof exchangeRequests.$inferSelect;

/** Причина отмены — та, что увидит клиент. */
const EXPIRED_REASON = 'Истёк срок оплаты по названному курсу';

/**
 * Момент, к которому заявка должна быть оплачена: выдача реквизитов
 * плюс срок из настроек. Считается в самой базе — тогда сравнение с
 * переданным моментом идёт одним выражением, без гонки между чтением и
 * записью.
 */
function dueBy(minutes: number) {
  return sql`${exchangeRequests.requisitesIssuedAt} + make_interval(mins => ${minutes})`;
}

/**
 * Переданный момент в виде, который база принимает.
 *
 * Тип указан явно: выражение собрано руками, и вывести из него, что
 * рядом ожидается время, драйвер не может — `Date` он отдал бы как есть
 * и получил бы отказ.
 */
function moment(at: Date) {
  return sql`${at.toISOString()}::timestamptz`;
}

/**
 * Отменить заявки, чей срок истёк к переданному моменту.
 *
 * Отменяет система, и отмена — это отмена, а не новое состояние: тип
 * действующего лица «система» в схеме уже есть, а отдельный статус
 * потребовал бы правки всех мест, где состояния перечисляются.
 *
 * Оплаченной заявки это не касается: условие требует состояния «курс
 * подтверждён», а из него заявка уходит, как только менеджер отметил
 * поступление.
 */
export async function expireUnpaidExchangeRequests(
  ctx: CoreConfig,
  at: Date,
): Promise<readonly Notification[]> {
  return ctx.db.transaction(async (tx) => {
    const { unpaidExchangeRequestTtlMinutes } = await readServiceSettings(tx);

    const expired = await tx
      .update(exchangeRequests)
      .set({ status: 'cancelled', cancelReason: EXPIRED_REASON, updatedAt: at })
      .where(
        and(
          eq(exchangeRequests.status, 'rate_confirmed'),
          isNotNull(exchangeRequests.requisitesIssuedAt),
          sql`${dueBy(unpaidExchangeRequestTtlMinutes)} <= ${moment(at)}`,
        ),
      )
      .returning();

    if (expired.length === 0) return [];

    // История заявки ведётся и здесь: в разборе спорного обмена должно
    // быть видно, что заявку закрыл срок, а не менеджер и не клиент.
    await tx.insert(exchangeRequestEvents).values(
      expired.map((row) => ({
        requestId: row.id,
        fromStatus: 'rate_confirmed' as const,
        toStatus: 'cancelled' as const,
        actorType: 'system' as const,
        comment: EXPIRED_REASON,
      })),
    );

    return expired.map(cancelledNotification);
  });
}

/**
 * Предупредить о скором истечении — один раз на заявку.
 *
 * Отметка о предупреждении ставится тем же условным изменением, что и
 * порождает уведомление: иначе два наложившихся вызова пришлют клиенту
 * два одинаковых сообщения.
 *
 * При сроке жизни короче получаса предупреждения нет вовсе: «за
 * полчаса» пришлось бы на момент выдачи реквизитов или раньше, и
 * клиент получил бы его вместе с ними — это не предупреждение, а шум.
 */
export async function warnAboutExpiringExchangeRequests(
  ctx: CoreConfig,
  at: Date,
): Promise<readonly Notification[]> {
  return ctx.db.transaction(async (tx) => {
    const { unpaidExchangeRequestTtlMinutes: ttl } = await readServiceSettings(tx);
    if (ttl <= WARNING_MINUTES) return [];

    const warned = await tx
      .update(exchangeRequests)
      .set({ expiryWarnedAt: at })
      .where(
        and(
          eq(exchangeRequests.status, 'rate_confirmed'),
          isNull(exchangeRequests.expiryWarnedAt),
          isNotNull(exchangeRequests.requisitesIssuedAt),
          // Уже пора предупреждать, но ещё не пора отменять: заявке,
          // чей срок истёк, предупреждение бессмысленно — её закроет
          // тот же прогон.
          sql`${dueBy(ttl - WARNING_MINUTES)} <= ${moment(at)}`,
          sql`${dueBy(ttl)} > ${moment(at)}`,
        ),
      )
      .returning();

    return warned.map((row) => ({
      kind: 'exchange-request-expiring' as const,
      to: row.clientId,
      requestId: row.id,
      minutesLeft: minutesLeft(row, ttl, at),
    }));
  });
}

/**
 * Сколько минут у клиента осталось. Округляется вверх: сказать «15
 * минут» там, где их четырнадцать с половиной, честнее, чем «14» — но
 * ровно до тех пор, пока округление не переходит через срок, а оно не
 * переходит: условие отбора требует, чтобы срок ещё не истёк.
 */
function minutesLeft(row: ExchangeRequestRow, ttl: number, at: Date): number {
  const issuedAt = row.requisitesIssuedAt?.getTime() ?? at.getTime();
  const left = issuedAt + ttl * 60_000 - at.getTime();
  return Math.max(1, Math.ceil(left / 60_000));
}

function cancelledNotification(row: ExchangeRequestRow): Notification {
  return {
    kind: 'exchange-request-status',
    to: row.clientId,
    requestId: row.id,
    status: 'cancelled',
    cancelReason: EXPIRED_REASON,
  };
}
