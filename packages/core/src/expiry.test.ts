import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { exchangeRequests } from '@nemo/db';
import { closeTestDatabase, resetDatabase, testDatabase } from '@nemo/db/testing';
import { createCore, type Actor } from './index.js';
import {
  asClient,
  givenCurrencyPair,
  givenServiceSettings,
  givenStaff,
} from './test-support.js';

/**
 * Истечение неоплаченной заявки.
 *
 * Момент передаётся операции параметром, поэтому подменять системные
 * часы не нужно ни в одной проверке: «через два часа» здесь — это
 * просто другое значение аргумента.
 *
 * Проверяется поведение, а не устройство: заявка отменена или цела,
 * уведомление вернулось или нет. Как именно операция отбирает строки —
 * условным `update` или чем-то другим — тестам знать незачем; знать им
 * нужно, что два наложившихся вызова не отменят оплаченную заявку и не
 * пришлют два одинаковых предупреждения.
 */

const db = testDatabase();
const core = createCore({ db });

/** Срок жизни неоплаченной заявки в этих проверках. */
const TTL_MINUTES = 120;

let manager: Actor & { type: 'staff' };

/** Когда менеджер выдал реквизиты по заявке, заведённой последней. */
let issuedAt: Date;

/** Момент через столько минут после выдачи реквизитов. */
function minutesAfterIssue(minutes: number): Date {
  return new Date(issuedAt.getTime() + minutes * 60_000);
}

/**
 * Заявка, которой менеджер выдал реквизиты.
 *
 * Момент выдачи не подставляется, а читается из самой заявки: операция
 * записывает его сама, и проверкам достаточно знать, от чего считать.
 * Подменять системные часы при этом не нужно — момент истечения они
 * получают параметром.
 */
async function givenRequestAwaitingPayment(): Promise<string> {
  const { request } = await core.submitExchangeRequest(asClient(100n), {
    kind: 'cash',
    fromCode: 'USDT',
    toCode: 'RUB',
    fromAmount: '100',
  });
  await core.claimExchangeRequest(manager, request.id);
  const { request: confirmed } = await core.confirmExchangeRate(manager, request.id, {
    finalRate: '95',
    paymentInstructions: 'наличными в офисе',
  });
  issuedAt = confirmed.requisitesIssuedAt!;
  return request.id;
}

async function statusOf(requestId: string): Promise<string> {
  const [row] = await db
    .select({ status: exchangeRequests.status })
    .from(exchangeRequests)
    .where(eq(exchangeRequests.id, requestId));
  return row!.status;
}

beforeEach(async () => {
  await resetDatabase();
  await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB', kind: 'cash' });
  await givenServiceSettings({ unpaidExchangeRequestTtlMinutes: TTL_MINUTES });
  await core.registerClient({ telegramUserId: 100n });
  manager = await givenStaff();
});

afterAll(() => closeTestDatabase());

describe('отмена по истечении срока', () => {
  it('отменяет заявку, чей срок истёк к переданному моменту', async () => {
    const requestId = await givenRequestAwaitingPayment();

    const notifications = await core.expireUnpaidExchangeRequests(
      minutesAfterIssue(TTL_MINUTES),
    );

    expect(await statusOf(requestId)).toBe('cancelled');
    expect(notifications).toEqual([
      expect.objectContaining({ kind: 'exchange-request-status', to: 100n, status: 'cancelled' }),
    ]);
  });

  it('называет причину: клиент не должен гадать, что случилось', async () => {
    await givenRequestAwaitingPayment();

    const [notification] = await core.expireUnpaidExchangeRequests(
      minutesAfterIssue(TTL_MINUTES),
    );

    expect(notification).toMatchObject({ cancelReason: expect.stringContaining('срок') });
  });

  it('оставляет заявку, срок которой ещё не истёк', async () => {
    const requestId = await givenRequestAwaitingPayment();

    const notifications = await core.expireUnpaidExchangeRequests(
      minutesAfterIssue(TTL_MINUTES - 1),
    );

    expect(notifications).toEqual([]);
    expect(await statusOf(requestId)).toBe('rate_confirmed');
  });

  it('не трогает оплаченную заявку', async () => {
    const requestId = await givenRequestAwaitingPayment();
    await core.markPaymentReceived(manager, requestId);

    const notifications = await core.expireUnpaidExchangeRequests(
      minutesAfterIssue(TTL_MINUTES * 2),
    );

    expect(notifications).toEqual([]);
    expect(await statusOf(requestId)).toBe('payment_received');
  });

  it('не отменяет заявку, которой реквизиты ещё не выдавали', async () => {
    const { request } = await core.submitExchangeRequest(asClient(100n), {
      kind: 'cash',
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '100',
    });

    // Далёкий момент: платить некуда, и отсчёт не идёт вовсе.
    await core.expireUnpaidExchangeRequests(new Date('2030-01-01T00:00:00.000Z'));

    expect(await statusOf(request.id)).toBe('new');
  });

  it('пишет отмену в историю заявки системным действующим лицом', async () => {
    const requestId = await givenRequestAwaitingPayment();

    await core.expireUnpaidExchangeRequests(minutesAfterIssue(TTL_MINUTES));

    const events = await core.listExchangeRequestEvents(manager, requestId);
    expect(events.at(-1)).toMatchObject({ toStatus: 'cancelled', actorType: 'system' });
  });

  it('не отменяет дважды: повторный вызов не находит уже отменённую', async () => {
    await givenRequestAwaitingPayment();

    const first = await core.expireUnpaidExchangeRequests(minutesAfterIssue(TTL_MINUTES));
    const second = await core.expireUnpaidExchangeRequests(minutesAfterIssue(TTL_MINUTES));

    expect(first).toHaveLength(1);
    expect(second).toEqual([]);
  });

  it('не отменяет заявку, оплаченную между двумя вызовами', async () => {
    const requestId = await givenRequestAwaitingPayment();
    const at = minutesAfterIssue(TTL_MINUTES);

    // Отметка об оплате приходит между прогонами: маршрут защищённый,
    // но не единственный вызывающий, и наложение вызовов — обычное дело.
    await core.markPaymentReceived(manager, requestId);
    const notifications = await core.expireUnpaidExchangeRequests(at);

    expect(notifications).toEqual([]);
    expect(await statusOf(requestId)).toBe('payment_received');
  });
});

describe('предупреждение о скором истечении', () => {
  it('приходит за полчаса до конца срока', async () => {
    const requestId = await givenRequestAwaitingPayment();

    const notifications = await core.warnAboutExpiringExchangeRequests(
      minutesAfterIssue(TTL_MINUTES - 30),
    );

    expect(notifications).toEqual([
      expect.objectContaining({
        kind: 'exchange-request-expiring',
        to: 100n,
        requestId,
        minutesLeft: 30,
      }),
    ]);
  });

  it('не приходит раньше времени', async () => {
    await givenRequestAwaitingPayment();

    expect(
      await core.warnAboutExpiringExchangeRequests(minutesAfterIssue(TTL_MINUTES - 31)),
    ).toEqual([]);
  });

  it('отправляется однажды: два наложившихся вызова не дают двух сообщений', async () => {
    await givenRequestAwaitingPayment();
    const at = minutesAfterIssue(TTL_MINUTES - 30);

    const first = await core.warnAboutExpiringExchangeRequests(at);
    const second = await core.warnAboutExpiringExchangeRequests(at);

    expect(first).toHaveLength(1);
    expect(second).toEqual([]);
  });

  it('не приходит по заявке, срок которой уже истёк: её закроет тот же прогон', async () => {
    await givenRequestAwaitingPayment();

    expect(
      await core.warnAboutExpiringExchangeRequests(minutesAfterIssue(TTL_MINUTES)),
    ).toEqual([]);
  });

  it('не приходит вовсе при сроке короче получаса', async () => {
    // «За полчаса» пришлось бы на момент выдачи реквизитов или раньше:
    // это не предупреждение, а второе сообщение подряд.
    await givenServiceSettings({ unpaidExchangeRequestTtlMinutes: 20 });
    await givenRequestAwaitingPayment();

    expect(await core.warnAboutExpiringExchangeRequests(minutesAfterIssue(19))).toEqual([]);
  });

  it('не приходит по оплаченной заявке', async () => {
    const requestId = await givenRequestAwaitingPayment();
    await core.markPaymentReceived(manager, requestId);

    expect(
      await core.warnAboutExpiringExchangeRequests(minutesAfterIssue(TTL_MINUTES - 30)),
    ).toEqual([]);
  });
});
