import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { inArray } from 'drizzle-orm';
import { exchangeRequests } from '@nemo/db';
import { closeTestDatabase, resetDatabase, testDatabase } from '@nemo/db/testing';
import { createCore, type Actor } from './index.js';
import { asClient, givenCurrencyPair, givenStaff } from './test-support.js';

/**
 * Очередь заявок под рост: кто ведёт, что моё, поиск, фильтры и предел.
 *
 * Проверяется не разметка, а выборка: менеджер, открывающий чужую
 * заявку только затем, чтобы узнать, что она чужая, теряет минуту на
 * каждой строке, а очередь без предела однажды отдаёт тысячу строк в
 * один экран.
 */

const core = createCore({ db: testDatabase() });

let petr: Actor & { type: 'staff' };
let anna: Actor & { type: 'staff' };
let requisitesId: string;

async function givenNewRequest(options: { kind?: 'electronic' | 'cash' } = {}): Promise<string> {
  const kind = options.kind ?? 'electronic';
  const { request } = await core.submitExchangeRequest(asClient(100n), {
    kind,
    fromCode: 'USDT',
    toCode: 'RUB',
    fromAmount: '1000',
    // Наличную заявку клиент получает на руки: реквизитов у неё нет.
    ...(kind === 'electronic' ? { requisitesId } : {}),
  });
  return request.id;
}

beforeEach(async () => {
  await resetDatabase();
  await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB', kind: 'electronic' });
  await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB', kind: 'cash' });
  await core.registerClient({ telegramUserId: 100n, username: 'elfuerte' });
  await core.registerClient({ telegramUserId: 200n, username: 'petrov' });
  const requisites = await core.saveRequisites(asClient(100n), {
    kind: 'phone',
    bankName: 'Сбербанк',
    phone: '+79990000000',
  });
  requisitesId = requisites.id;
  petr = await givenStaff({ displayName: 'Пётр' });
  anna = await givenStaff({ displayName: 'Анна' });
});

afterAll(() => closeTestDatabase());

describe('кто ведёт заявку', () => {
  it('называет менеджера по имени, а не идентификатором', async () => {
    const id = await givenNewRequest();
    await core.claimExchangeRequest(petr, id);

    const [taken] = await core.listExchangeRequestsInProgress(anna);

    expect(taken?.assignedManagerName).toBe('Пётр');
  });

  /*
   * Первый вопрос смены — «что моё», второй — «что вообще есть».
   * Разделить их должна выборка: открывать чужую заявку затем, чтобы
   * узнать, что она чужая, менеджер не должен.
   */
  it('чужая заявка есть в общем списке и нет в моём', async () => {
    const mine = await givenNewRequest();
    const hers = await givenNewRequest();
    await core.claimExchangeRequest(petr, mine);
    await core.claimExchangeRequest(anna, hers);

    const all = await core.listExchangeRequestsInProgress(petr);
    const own = await core.listExchangeRequestsInProgress(petr, { mine: true });
    const others = await core.listExchangeRequestsInProgress(petr, { mine: false });

    expect(all.map((one) => one.id).sort()).toEqual([mine, hers].sort());
    expect(own.map((one) => one.id)).toEqual([mine]);
    expect(others.map((one) => one.id)).toEqual([hers]);
  });
});

describe('фильтры', () => {
  it('по состоянию не отдают чужих состояний', async () => {
    const taken = await givenNewRequest();
    const confirmed = await givenNewRequest();
    await core.claimExchangeRequest(petr, taken);
    await core.claimExchangeRequest(petr, confirmed);
    await core.confirmExchangeRate(petr, confirmed, {
      finalRate: '95',
      paymentInstructions: 'куда платить',
    });

    const found = await core.listExchangeRequestsInProgress(petr, { status: 'in_progress' });

    expect(found.map((one) => one.id)).toEqual([taken]);
  });

  it('по виду отделяют наличные от безналичных', async () => {
    const cash = await givenNewRequest({ kind: 'cash' });
    await givenNewRequest();

    const found = await core.listExchangeRequestQueue(petr, { kind: 'cash' });

    expect(found.map((one) => one.id)).toEqual([cash]);
  });
});

describe('поиск', () => {
  it('находит по нику клиента', async () => {
    await givenNewRequest();
    const { request } = await core.submitExchangeRequest(asClient(200n), {
      kind: 'cash',
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '500',
    });

    const found = await core.listExchangeRequestQueue(petr, { query: 'petrov' });

    expect(found.map((one) => one.id)).toEqual([request.id]);
  });

  /*
   * Ник у клиента бывает не всегда, а номер есть у каждого: клиент,
   * написавший «что с моей заявкой», опознаётся по нему.
   */
  it('находит по номеру клиента', async () => {
    const id = await givenNewRequest();

    const found = await core.listExchangeRequestQueue(petr, { query: '100' });

    expect(found.map((one) => one.id)).toEqual([id]);
  });

  /*
   * Номер сравнивается целиком: «100» внутри «21005» — чужая заявка,
   * показанная в ответ на точный вопрос. Менеджер присылает номер
   * копированием и ждёт по нему одну строку.
   */
  it('по номеру не отдаёт чужие заявки с похожим номером', async () => {
    await core.registerClient({ telegramUserId: 21_005n, username: 'sosed' });
    await core.submitExchangeRequest(asClient(21_005n), {
      kind: 'cash',
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '500',
    });
    const mine = await givenNewRequest();

    const found = await core.listExchangeRequestQueue(petr, { query: '100' });

    expect(found.map((one) => one.id)).toEqual([mine]);
  });

  /*
   * Процент в поиске означает «что угодно» только для базы: человек,
   * набравший его, ищет именно этот знак — и получил бы в ответ всю
   * очередь.
   */
  it('знаки образца в запросе ищет как знаки', async () => {
    await givenNewRequest();

    const found = await core.listExchangeRequestQueue(petr, { query: '%' });

    expect(found).toHaveLength(0);
  });

  it('не путает регистр ника', async () => {
    await core.submitExchangeRequest(asClient(200n), {
      kind: 'cash',
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '500',
    });

    const found = await core.listExchangeRequestQueue(petr, { query: 'PeTr' });

    expect(found).toHaveLength(1);
  });
});

describe('предел и курсор', () => {
  it('отдаёт не больше запрошенного', async () => {
    await givenNewRequest();
    await givenNewRequest();
    await givenNewRequest();

    const page = await core.listExchangeRequestQueue(petr, { limit: 2 });

    expect(page).toHaveLength(2);
  });

  /*
   * Счётчик считает весь список, а не показанную страницу: «50» и на
   * пятидесяти заявках, и на пятистах — это число, по которому решают,
   * за что браться, и оно обязано быть настоящим.
   */
  it('счётчик не обрезается пределом выборки', async () => {
    await givenNewRequest();
    await givenNewRequest();
    await givenNewRequest();

    const page = await core.listExchangeRequestQueue(petr, { limit: 2 });
    const total = await core.countExchangeRequestQueue(petr);

    expect(page).toHaveLength(2);
    expect(total).toBe(3);
  });

  it('счётчик считает по тому же сужению, что и список', async () => {
    await givenNewRequest();
    await givenNewRequest({ kind: 'cash' });

    expect(await core.countExchangeRequestQueue(petr, { kind: 'cash' })).toBe(1);
  });

  /*
   * Заявки, поданные в одну миллисекунду, — обычное дело при подаче из
   * скрипта и не редкость под нагрузкой. Курсор только по времени на
   * такой границе либо теряет строку, либо отдаёт её дважды: обе беды
   * молчаливые.
   */
  it('не теряет и не дублирует строки на границе страницы', async () => {
    const ids = [await givenNewRequest(), await givenNewRequest(), await givenNewRequest()];
    await sameCreatedAt(ids);

    const first = await core.listExchangeRequestQueue(petr, { limit: 2 });
    const last = first[first.length - 1]!;
    const second = await core.listExchangeRequestQueue(petr, {
      limit: 2,
      after: { createdAt: last.createdAt, id: last.id },
    });

    const seen = [...first, ...second].map((one) => one.id);
    expect(seen).toHaveLength(3);
    expect(new Set(seen).size).toBe(3);
    expect(seen.slice().sort()).toEqual(ids.slice().sort());
  });
});

/** Свести время подачи в одну отметку — так проверяется граница страницы. */
async function sameCreatedAt(ids: readonly string[]): Promise<void> {
  await testDatabase()
    .update(exchangeRequests)
    .set({ createdAt: new Date('2026-08-06T10:00:00Z') })
    .where(inArray(exchangeRequests.id, [...ids]));
}
