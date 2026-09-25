import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestDatabase, resetDatabase, testDatabase } from '@nemo/db/testing';
import { addressAllowed, createCore, normalizeApiAddress, type Actor } from './index.js';
import { givenMerchant } from './test-support.js';

/**
 * Разрешённые адреса для вызовов API: ключ, ушедший с сервера мерчанта,
 * без его адреса бесполезен.
 *
 * Разбор и сверка — чистые функции: ими адаптер решает, пускать ли
 * вызов, и ошибка в них либо запирает мерчанта снаружи, либо пускает
 * чужого. Поэтому проверяется каждое написание, которое встречается в
 * жизни, — одиночный адрес, подсеть, IPv6, IPv4 внутри IPv6.
 */

describe('разбор адреса', () => {
  it('одиночный IPv4 — как есть, с маской /32 — без маски', () => {
    expect(normalizeApiAddress('203.0.113.7')).toBe('203.0.113.7');
    expect(normalizeApiAddress(' 203.0.113.7/32 ')).toBe('203.0.113.7');
  });

  it('подсеть приводится к её началу: один адрес не заводится дважды', () => {
    expect(normalizeApiAddress('203.0.113.9/24')).toBe('203.0.113.0/24');
    expect(normalizeApiAddress('198.51.100.200/30')).toBe('198.51.100.200/30');
  });

  it('IPv6 — в сжатой записи строчными', () => {
    expect(normalizeApiAddress('2001:DB8:0:0::1')).toBe('2001:db8::1');
    expect(normalizeApiAddress('2001:db8::1/128')).toBe('2001:db8::1');
    expect(normalizeApiAddress('2001:db8:aa:bb::1/48')).toBe('2001:db8:aa::/48');
  });

  it('IPv4 внутри IPv6 — это IPv4', () => {
    expect(normalizeApiAddress('::ffff:203.0.113.7')).toBe('203.0.113.7');
  });

  it('не адрес — отказ словами', () => {
    for (const bad of ['', 'abc', '203.0.113', '203.0.113.256', '203.0.113.7/33', '1.2.3.4/x']) {
      expect(() => normalizeApiAddress(bad)).toThrow(/адрес|подсеть/i);
    }
  });

  /*
   * Сервер мерчанта ходит к нам через интернет, и приходит запрос с его
   * публичного адреса. Адрес внутренней сети в списке — почти всегда
   * ошибка, которая заперла бы интеграцию целиком.
   */
  it('адрес внутренней сети — отказ с объяснением', () => {
    for (const internal of ['10.1.2.3', '192.168.0.10', '172.16.5.4', '127.0.0.1', '::1', 'fd00::1']) {
      expect(() => normalizeApiAddress(internal)).toThrow(/внутренн/i);
    }
  });

  /*
   * Групповая рассылка и служебные диапазоны отправителем запроса не
   * бывают: в списке это мусор, который владелец принял бы за защиту.
   */
  it('групповой и служебный адрес — отказ: с него запрос не приходит', () => {
    for (const service of ['224.0.0.1', '239.1.2.3', '240.0.0.1', '255.255.255.255', 'ff02::1']) {
      expect(() => normalizeApiAddress(service), service).toThrow(/служебн/i);
    }
    expect(() => normalizeApiAddress('fec0::1')).toThrow(/внутренн/i);
  });

  it('подсеть шире /8 для IPv4 и /32 для IPv6 — отказ: это почти весь интернет', () => {
    expect(() => normalizeApiAddress('0.0.0.0/0')).toThrow(/шире/i);
    expect(() => normalizeApiAddress('8.0.0.0/7')).toThrow(/шире/i);
    expect(() => normalizeApiAddress('2001::/16')).toThrow(/шире/i);
  });
});

describe('сверка адреса со списком', () => {
  it('пустой список пускает всех — так было до списка', () => {
    expect(addressAllowed([], '198.51.100.1')).toBe(true);
  });

  it('пускает адрес из списка и из подсети, не пускает чужой', () => {
    const list = ['203.0.113.0/24', '198.51.100.7'];
    expect(addressAllowed(list, '203.0.113.200')).toBe(true);
    expect(addressAllowed(list, '198.51.100.7')).toBe(true);
    expect(addressAllowed(list, '198.51.100.8')).toBe(false);
    expect(addressAllowed(list, '203.0.114.1')).toBe(false);
  });

  it('IPv6 сверяется со своей подсетью, IPv4 внутри IPv6 — с IPv4', () => {
    expect(addressAllowed(['2001:db8:aa::/48'], '2001:db8:aa:ff::5')).toBe(true);
    expect(addressAllowed(['2001:db8:aa::/48'], '2001:db8:ab::5')).toBe(false);
    expect(addressAllowed(['203.0.113.0/24'], '::ffff:203.0.113.9')).toBe(true);
  });

  it('неизвестный адрес при непустом списке не пускается', () => {
    expect(addressAllowed(['203.0.113.0/24'], 'неизвестный адрес')).toBe(false);
  });
});

const db = testDatabase();
const core = createCore({ db, apiKeyPrefix: 'sk_test_' });

let owner: Actor & { type: 'merchant' };

beforeEach(async () => {
  await resetDatabase(db);
  owner = await givenMerchant({ email: 'shop@example.com' });
});

afterAll(() => closeTestDatabase());

describe('список разрешённых адресов', () => {
  it('владелец заводит адрес с заметкой и видит его в списке', async () => {
    await core.addApiAddress(owner, { address: '203.0.113.9/24', note: 'сервер сайта' });

    const list = await core.listApiAddresses(owner);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ address: '203.0.113.0/24', note: 'сервер сайта' });
  });

  it('тот же адрес другим написанием второй раз не заводится', async () => {
    await core.addApiAddress(owner, { address: '203.0.113.7', note: '' });
    await expect(
      core.addApiAddress(owner, { address: '203.0.113.7/32', note: '' }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('оператору список не открыт: адреса ведёт владелец, как ключи', async () => {
    const operator: Actor = { ...owner, role: 'operator' };
    await expect(core.listApiAddresses(operator)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      core.addApiAddress(operator, { address: '203.0.113.7', note: '' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('чужой адрес не убирается и не показывается: «не найден»', async () => {
    const other = await givenMerchant({ email: 'other@example.com' });
    const added = await core.addApiAddress(owner, { address: '203.0.113.7', note: '' });

    expect(await core.listApiAddresses(other)).toEqual([]);
    await expect(core.removeApiAddress(other, added.id)).rejects.toMatchObject({
      code: 'not-found',
    });

    await core.removeApiAddress(owner, added.id);
    expect(await core.listApiAddresses(owner)).toEqual([]);
  });

  it('узнанный ключ приносит адаптеру список адресов своего мерчанта', async () => {
    const { secret } = await core.issueApiKey(owner, { label: 'сайт' });
    const before = await core.authenticateApiKey(secret);
    expect(before).toMatchObject({ ok: true, allowedAddresses: [] });

    await core.addApiAddress(owner, { address: '203.0.113.7', note: '' });
    const after = await core.authenticateApiKey(secret);
    expect(after).toMatchObject({ ok: true, allowedAddresses: ['203.0.113.7'] });
  });

  it('список не бесконечен', async () => {
    for (let i = 1; i <= 50; i += 1) {
      await core.addApiAddress(owner, { address: `203.0.113.${i}`, note: '' });
    }
    await expect(
      core.addApiAddress(owner, { address: '198.51.100.1', note: '' }),
    ).rejects.toMatchObject({ code: 'invalid-input' });
  });
});
