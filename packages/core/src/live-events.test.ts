import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestDatabase, resetDatabase, testDatabase } from '@nemo/db/testing';
import { createCore, type LiveEvent } from './index.js';
import { asClient, givenCurrencyPair, givenStaff } from './test-support.js';

/**
 * Толчок о событии, который панель ждёт открытым соединением.
 *
 * Проверяется против настоящей базы: событие едет каналом Postgres, и
 * его доставка — свойство базы, а не кода. Мок здесь проверял бы, что
 * функция вызвана, — то есть ровно то, что и так видно глазом.
 *
 * Ждём с потолком: молчание канала должно валить тест, а не держать
 * прогон до общего срока.
 */

const core = createCore({ db: testDatabase() });

/** Событие, пришедшее подписчику, или отказ по истечении срока. */
function nextEvent(
  events: LiveEvent[],
  matches: (event: LiveEvent) => boolean,
  timeoutMs = 3000,
): Promise<LiveEvent> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = setInterval(() => {
      const found = events.find(matches);
      if (found) {
        clearInterval(tick);
        resolve(found);
        return;
      }
      if (Date.now() - started > timeoutMs) {
        clearInterval(tick);
        reject(new Error(`События не дождались за ${timeoutMs} мс: ${JSON.stringify(events)}`));
      }
    }, 20);
  });
}

beforeEach(async () => {
  await resetDatabase();
  await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB', kind: 'cash' });
});

afterAll(() => closeTestDatabase());

describe('толчок о событии', () => {
  it('доходит до подписчика, когда клиент написал боту', async () => {
    const events: LiveEvent[] = [];
    const stop = await core.subscribeToLiveEvents((event) => events.push(event));

    try {
      await core.receiveClientMessage({ telegramUserId: 100n, body: 'Здравствуйте' });

      const event = await nextEvent(events, (one) => one.topic === 'conversations');
      expect(event.clientId).toBe('100');
    } finally {
      await stop();
    }
  });

  it('доходит до подписчика, когда подана заявка', async () => {
    await core.registerClient({ telegramUserId: 100n });
    const events: LiveEvent[] = [];
    const stop = await core.subscribeToLiveEvents((event) => events.push(event));

    try {
      await core.submitExchangeRequest(asClient(100n), {
        kind: 'cash',
        fromCode: 'USDT',
        toCode: 'RUB',
        fromAmount: '100',
      });

      await expect(nextEvent(events, (one) => one.topic === 'exchange')).resolves.toEqual({
        topic: 'exchange',
      });
    } finally {
      await stop();
    }
  });

  it('доходит и на действие сотрудника: коллега видит его у себя', async () => {
    await core.registerClient({ telegramUserId: 100n });
    const manager = await givenStaff({ displayName: 'Пётр' });
    const { request } = await core.submitExchangeRequest(asClient(100n), {
      kind: 'cash',
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '100',
    });

    const events: LiveEvent[] = [];
    const stop = await core.subscribeToLiveEvents((event) => events.push(event));

    try {
      await core.claimExchangeRequest(manager, request.id);

      await expect(nextEvent(events, (one) => one.topic === 'exchange')).resolves.toEqual({
        topic: 'exchange',
      });
    } finally {
      await stop();
    }
  });

  it('вторая подписка не удваивает событие: канал заводится один раз', async () => {
    // Снятый слушатель и пришедший ему на смену — обычная жизнь панели:
    // менеджер закрыл вкладку и открыл заново. Каждая такая пара, заведи
    // она второй `listen`, доставляла бы событие лишний раз, а вкладка
    // столько же раз перечитывала бы экран.
    const stopFirst = await core.subscribeToLiveEvents(() => {});
    await stopFirst();

    const events: LiveEvent[] = [];
    const stop = await core.subscribeToLiveEvents((event) => events.push(event));

    try {
      await core.receiveClientMessage({ telegramUserId: 100n, body: 'Здравствуйте' });
      await nextEvent(events, (one) => one.topic === 'conversations');
      // Дубль пришёл бы следом за первым, а не вместо него.
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(events.filter((one) => one.topic === 'conversations')).toHaveLength(1);
    } finally {
      await stop();
    }
  });

  it('после отписки не будит того, кто ушёл', async () => {
    const events: LiveEvent[] = [];
    const stop = await core.subscribeToLiveEvents((event) => events.push(event));
    await stop();

    await core.receiveClientMessage({ telegramUserId: 100n, body: 'Здравствуйте' });
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(events).toEqual([]);
  });
});
