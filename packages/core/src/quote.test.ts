import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestDatabase, resetDatabase, testDatabase } from '@nemo/db/testing';
import { createCore, type RatePair, type RateQuote, type RateSource } from './index.js';
import { asClient, givenCurrencyPair, givenServiceSettings } from './test-support.js';

/**
 * Котировка для электронных переводов и курс, с которым уходит заявка.
 *
 * Котировка до подачи ни к чему не обязывает, но подача по ней —
 * обязательство сервиса (docs/adr/0006): курс записывается в заявку и
 * дальше не меняется. Поэтому проверки здесь требуют двух вещей —
 * чтобы курс попадал в заявку и чтобы его отсутствие не мешало её
 * подать.
 */

/** Источник, отвечающий заданной котировкой. Считает обращения к себе. */
function givenRateSource(rate: string | null): RateSource & { calls: RatePair[] } {
  const calls: RatePair[] = [];
  return {
    calls,
    async quote(pair: RatePair): Promise<RateQuote | null> {
      calls.push(pair);
      return rate === null
        ? null
        : { rate: rate as RateQuote['rate'], asOf: new Date('2026-01-01T00:00:00Z') };
    },
  };
}

const db = testDatabase();

beforeEach(async () => {
  await resetDatabase();
  await db.execute('select 1');
});

afterAll(() => closeTestDatabase());

describe('электронный перевод', () => {
  it('пересчитывает сумму по котировке с наценкой сервиса', async () => {
    await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB', kind: 'electronic' });
    await givenServiceSettings({ markupBps: 200 });
    const core = createCore({ db, rateSource: givenRateSource('100') });

    const quote = await core.getQuote({
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '10',
    });

    // Наценка 2% от котировки 100 — курс 98, за 10 USDT дадут 980.
    // Посчитано вручную от правила, а не тем же выражением, что в коде.
    expect(quote).toMatchObject({ rate: '98', toAmount: '980', markupBps: 200 });
  });

  it('берёт наценку из настроек сервиса, а не из справочника направлений', async () => {
    await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB', kind: 'electronic' });
    await givenServiceSettings({ markupBps: 1000 });
    const core = createCore({ db, rateSource: givenRateSource('100') });

    const quote = await core.getQuote({ fromCode: 'USDT', toCode: 'RUB' });

    expect(quote?.rate).toBe('90');
  });

  it('одна наценка действует на оба направления пары', async () => {
    await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB', kind: 'electronic' });
    await givenCurrencyPair({ fromCode: 'RUB', toCode: 'USDT', kind: 'electronic' });
    await givenServiceSettings({ markupBps: 500 });
    const core = createCore({ db, rateSource: givenRateSource('100') });

    const forward = await core.getQuote({ fromCode: 'USDT', toCode: 'RUB' });
    const backward = await core.getQuote({ fromCode: 'RUB', toCode: 'USDT' });

    // 5% с котировки 100 — курс 95 в обе стороны: асимметричный спред
    // сознательно не делается.
    expect(forward?.rate).toBe('95');
    expect(backward?.rate).toBe('95');
  });

  it('отдаёт курс и без суммы: клиент ещё ничего не ввёл', async () => {
    await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB' });
    await givenServiceSettings({ markupBps: 0 });
    const core = createCore({ db, rateSource: givenRateSource('95.5') });

    const quote = await core.getQuote({ fromCode: 'USDT', toCode: 'RUB' });

    expect(quote).toMatchObject({ rate: '95', toAmount: null });
  });
});

/**
 * Курс называется целым числом — и им же считается.
 *
 * Округлить только показ нельзя: клиент увидел бы «95 ₽ за 1 USDT», а
 * получил бы по 95,48, и сумма к выдаче перестала бы сходиться с
 * курсом, по которому он согласился. Проверяется поэтому не вид, а сам
 * курс и посчитанная по нему выдача.
 */
describe('целый курс', () => {
  it('отбрасывает дробную часть, когда платит сервис', async () => {
    await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB', kind: 'electronic' });
    await givenServiceSettings({ markupBps: 0 });
    const core = createCore({ db, rateSource: givenRateSource('95.987') });

    const quote = await core.getQuote({ fromCode: 'USDT', toCode: 'RUB', fromAmount: '10' });

    // Клиент получает рубли: округление вниз оставляет наценку целой.
    expect(quote).toMatchObject({ rate: '95', toAmount: '950' });
  });

  it('поднимает мелкую сторону вверх: там платит клиент', async () => {
    await givenCurrencyPair({ fromCode: 'RUB', toCode: 'USDT', kind: 'electronic' });
    await givenServiceSettings({ markupBps: 0 });
    // 1/95,987 — столько USDT дают за рубль.
    const core = createCore({ db, rateSource: givenRateSource('0.010418') });

    const quote = await core.getQuote({ fromCode: 'RUB', toCode: 'USDT' });

    // Крупная сторона — 95,98 рубля за монету; вверх это 96, и обратный
    // курс выводится из неё, а не округляется сам: целое из 0,0104 было
    // бы нулём.
    expect(quote?.rate).toBe('0.010416666666666666');
  });

  /*
   * Округление до целого имеет смысл, пока единица — малая часть курса.
   * У пары с курсом около единицы целое отнимает почти половину: 1,9
   * превратилось бы в 1. Сервис торгует одной парой, где курс за
   * восемьдесят, но справочник направлений открыт, и следующая пара
   * пришла бы сюда молча.
   */
  it('не трогает курс, у которого единица — заметная часть', async () => {
    await givenCurrencyPair({ fromCode: 'AAA', toCode: 'BBB', kind: 'electronic' });
    await givenServiceSettings({ markupBps: 0 });
    const core = createCore({ db, rateSource: givenRateSource('1.9') });

    const quote = await core.getQuote({ fromCode: 'AAA', toCode: 'BBB' });

    expect(quote?.rate).toBe('1.9');
  });

  it('то же с мелкой стороны: 0,9 не должно стать половиной', async () => {
    await givenCurrencyPair({ fromCode: 'AAA', toCode: 'BBB', kind: 'electronic' });
    await givenServiceSettings({ markupBps: 0 });
    const core = createCore({ db, rateSource: givenRateSource('0.9') });

    const quote = await core.getQuote({ fromCode: 'AAA', toCode: 'BBB' });

    expect(quote?.rate).toBe('0.9');
  });

  /*
   * Выдача называется с точностью самой валюты, а не целым числом
   * единиц. Целое отдавало бы сервису хвост до единицы — у монеты это
   * около доллара с каждой сделки, — а клиент считает по названной
   * комиссии и вправе получить ровно то, что из неё выходит.
   * Округляется при этом сама величина, а не её показ: она уходит в
   * заявку, и по ней выдают деньги.
   */
  it('выдаёт с точностью валюты: у монеты шесть знаков', async () => {
    await givenCurrencyPair({ fromCode: 'RUB', toCode: 'USDT', kind: 'electronic' });
    await givenServiceSettings({ markupBps: 0 });
    // 1/85 — столько монет дают за рубль.
    const core = createCore({ db, rateSource: givenRateSource('0.011764705882352941') });

    const quote = await core.getQuote({ fromCode: 'RUB', toCode: 'USDT', fromAmount: '50000' });

    // 50 000 / 85 = 588,23529411…, у монеты шесть знаков, седьмой —
    // единица, и он уходит вниз.
    expect(quote?.toAmount).toBe('588.235294');
  });

  it('целую сумму не удлиняет нулями', async () => {
    await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB', kind: 'electronic' });
    await givenServiceSettings({ markupBps: 0 });
    const core = createCore({ db, rateSource: givenRateSource('80') });

    const quote = await core.getQuote({ fromCode: 'USDT', toCode: 'RUB', fromAmount: '10' });

    // Ровно 800, а не «800,00»: сумма уходит в заявку строкой.
    expect(quote?.toAmount).toBe('800');
  });

  it('нулевой курс не роняет котировку делением на ноль', async () => {
    await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB', kind: 'electronic' });
    // Стопроцентная наценка обнуляет курс, и до округления он доходит.
    await givenServiceSettings({ markupBps: 10_000 });
    const core = createCore({ db, rateSource: givenRateSource('95') });

    const quote = await core.getQuote({ fromCode: 'USDT', toCode: 'RUB' });

    expect(quote?.rate).toBe('0');
  });

  it('сумма к выдаче сходится с показанным курсом устно', async () => {
    await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB', kind: 'electronic' });
    await givenServiceSettings({ markupBps: 200 });
    const core = createCore({ db, rateSource: givenRateSource('83.17') });

    const quote = await core.getQuote({ fromCode: 'USDT', toCode: 'RUB', fromAmount: '1000' });

    // 83,17 минус 2% — 81,5066, вниз — 81. Тысяча по 81 это 81 000, и
    // это ровно то, что человек посчитает в уме, увидев курс 81.
    expect(quote).toMatchObject({ rate: '81', toAmount: '81000' });
  });
});

describe('наличные', () => {
  it('котировку не запрашивают: финальный курс называет менеджер', async () => {
    await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB', kind: 'cash' });
    const source = givenRateSource('100');
    const core = createCore({ db, rateSource: source });

    const quote = await core.getQuote({ fromCode: 'USDT', toCode: 'RUB' });

    expect(quote).toBeNull();
    expect(source.calls).toEqual([]);
  });
});

describe('недоступность провайдера', () => {
  it('оставляет клиента без курса, но не без заявки', async () => {
    await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB', kind: 'electronic' });
    const core = createCore({ db, rateSource: givenRateSource(null) });
    await core.registerClient({ telegramUserId: 100n });
    const requisites = await core.saveRequisites(asClient(100n), {
      kind: 'phone',
      bankName: 'Сбербанк',
      phone: '+79990000000',
    });

    expect(await core.getQuote({ fromCode: 'USDT', toCode: 'RUB' })).toBeNull();

    const { request } = await core.submitExchangeRequest(asClient(100n), {
      kind: 'electronic',
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '100',
      requisitesId: requisites.id,
    });
    expect(request.status).toBe('new');
    expect(request.requestRate).toBeNull();
  });

  it('то же, когда источник курса вовсе не настроен', async () => {
    await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB', kind: 'electronic' });
    const core = createCore({ db });

    expect(await core.getQuote({ fromCode: 'USDT', toCode: 'RUB' })).toBeNull();
  });
});

describe('неактивное направление', () => {
  it('курса не имеет', async () => {
    await givenCurrencyPair({
      fromCode: 'USDT',
      toCode: 'RUB',
      kind: 'electronic',
      isActive: false,
    });
    const core = createCore({ db, rateSource: givenRateSource('100') });

    expect(await core.getQuote({ fromCode: 'USDT', toCode: 'RUB' })).toBeNull();
  });
});

describe('поданная заявка', () => {
  it('запоминает курс на момент подачи — от чего отталкивался клиент', async () => {
    await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB', kind: 'electronic' });
    await givenServiceSettings({ markupBps: 200 });
    const core = createCore({ db, rateSource: givenRateSource('100') });
    await core.registerClient({ telegramUserId: 100n });
    const requisites = await core.saveRequisites(asClient(100n), {
      kind: 'phone',
      bankName: 'Сбербанк',
      phone: '+79990000000',
    });

    const { request } = await core.submitExchangeRequest(asClient(100n), {
      kind: 'electronic',
      fromCode: 'USDT',
      toCode: 'RUB',
      // Сотня USDT — выше минимальной суммы обмена: проверяется здесь
      // запись курса, а не порог.
      fromAmount: '100',
      requisitesId: requisites.id,
    });

    expect(request.requestRate).toBe('98');
  });

  it('наличными идёт с курсом — тем же, что видел клиент', async () => {
    // Раньше наличная заявка уходила без курса вовсе, и провайдера ради
    // неё не спрашивали. Теперь цена у неё такая же, как у перевода:
    // наценка поверх котировки, пока администратор не завёл наличную
    // сетку.
    await givenCurrencyPair({ fromCode: 'USDT', toCode: 'RUB', kind: 'cash' });
    await givenServiceSettings({ markupBps: 200 });
    const source = givenRateSource('100');
    const core = createCore({ db, rateSource: source });
    await core.registerClient({ telegramUserId: 100n });

    const { request } = await core.submitExchangeRequest(asClient(100n), {
      kind: 'cash',
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: '100',
    });

    expect(request.requestRate).toBe('98');
    expect(request.toAmount).toBe('9800');
  });
});
