import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { apiKeys } from '@nemo/db';
import { closeTestDatabase, resetDatabase, testDatabase } from '@nemo/db/testing';
import { CoreError, createCore, type Actor } from './index.js';
import { givenMerchant, givenStaff } from './test-support.js';

/**
 * Ключи API мерчанта: чем он подписывает запросы к сервису.
 *
 * Секрет показывается один раз и в базе не лежит; ключ узнаётся по
 * хешу; отозванный и ключ отключённого мерчанта перестают работать в
 * ту же секунду. Всё это правила ядра, а не адаптера: путь через
 * маршрут — не единственный путь к операции.
 */

const db = testDatabase();
const core = createCore({ db, apiKeyPrefix: 'sk_test_' });

let merchant: Actor & { type: 'merchant' };

beforeEach(async () => {
  await resetDatabase(db);
  merchant = await givenMerchant({ email: 'shop@example.com' });
});

afterAll(() => closeTestDatabase());

describe('выпуск ключа', () => {
  it('отдаёт секрет один раз, а хранит только хеш и хвост', async () => {
    const issued = await core.issueApiKey(merchant, { label: 'сайт' });

    expect(issued.secret.startsWith('sk_test_')).toBe(true);
    expect(issued.secret.length).toBeGreaterThan(30);
    expect(issued.key.label).toBe('сайт');
    // Хвост — чтобы узнать ключ в списке, не видя его целиком.
    expect(issued.key.hint).toBe(`sk_test_…${issued.secret.slice(-4)}`);

    const [row] = await db.select().from(apiKeys).where(eq(apiKeys.id, issued.key.id));
    expect(row!.secretHash).not.toBe(issued.secret);
    expect(JSON.stringify(row)).not.toContain(issued.secret.slice(8, 24));

    const listed = await core.listApiKeys(merchant);
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain(issued.secret.slice(8, 24));
  });

  it('о выпуске уходит письмо с подписью и хвостом ключа', async () => {
    const issued = await core.issueApiKey(merchant, { label: 'бухгалтерия' });

    expect(issued.notifications).toEqual([
      expect.objectContaining({
        kind: 'merchant-api-key-issued',
        to: expect.objectContaining({ kind: 'merchant', merchantId: merchant.merchantId }),
        label: 'бухгалтерия',
        hint: issued.key.hint,
      }),
    ]);
  });

  it('без подписи не выпускается: два безымянных ключа не отличить', async () => {
    await expect(core.issueApiKey(merchant, { label: '  ' })).rejects.toMatchObject({
      code: 'invalid-input',
    });
  });

  it.each(['pending', 'disabled', 'rejected'] as const)(
    'мерчант в состоянии «%s» ключ не выпускает',
    async (status) => {
      const other = await givenMerchant({ email: `${status}@example.com`, status });
      await expect(core.issueApiKey(other, { label: 'сайт' })).rejects.toMatchObject({
        code: 'forbidden',
      });
    },
  );

  it('клиент и сотрудник ключей не выпускают', async () => {
    const staff = await givenStaff({ role: 'admin' });
    await expect(core.issueApiKey(staff, { label: 'сайт' })).rejects.toBeInstanceOf(CoreError);
    await expect(
      core.issueApiKey({ type: 'client', telegramUserId: 1n }, { label: 'сайт' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('без префикса в конфигурации — ошибка развёртывания, а не отказ мерчанту', async () => {
    const bare = createCore({ db });
    await expect(bare.issueApiKey(merchant, { label: 'сайт' })).rejects.toThrow(/префикс/i);
  });
});

describe('узнавание ключа', () => {
  it('по секрету находит мерчанта и говорит, нужна ли подпись', async () => {
    const issued = await core.issueApiKey(merchant, { label: 'сайт' });

    const auth = await core.authenticateApiKey(issued.secret);
    expect(auth).toMatchObject({
      ok: true,
      merchantId: merchant.merchantId,
      keyId: issued.key.id,
      signatureRequired: false,
    });
  });

  it('незнакомый секрет — ничей: ни мерчанта, ни ключа', async () => {
    await core.issueApiKey(merchant, { label: 'сайт' });
    expect(await core.authenticateApiKey('sk_test_' + 'x'.repeat(32))).toEqual({
      ok: false,
      reason: 'unknown',
    });
  });

  it('отозванный ключ узнаётся, но не пускает: мерчант увидит отказ в журнале', async () => {
    const issued = await core.issueApiKey(merchant, { label: 'сайт' });
    await core.revokeApiKey(merchant, issued.key.id);

    const auth = await core.authenticateApiKey(issued.secret);
    expect(auth).toMatchObject({
      ok: false,
      reason: 'revoked',
      merchantId: merchant.merchantId,
      keyId: issued.key.id,
    });
  });

  it('ключ отключённого мерчанта перестаёт работать в ту же секунду', async () => {
    const issued = await core.issueApiKey(merchant, { label: 'сайт' });
    const admin = await givenStaff({ role: 'admin' });
    await core.setMerchantActive(admin, merchant.merchantId, false);

    const auth = await core.authenticateApiKey(issued.secret);
    expect(auth).toMatchObject({ ok: false, reason: 'merchant-inactive', keyId: issued.key.id });

    // Включённый обратно — работает без перевыпуска ключа.
    await core.setMerchantActive(admin, merchant.merchantId, true);
    expect(await core.authenticateApiKey(issued.secret)).toMatchObject({ ok: true });
  });

  it('отмечает, когда ключом ходили в последний раз', async () => {
    const issued = await core.issueApiKey(merchant, { label: 'сайт' });
    expect(issued.key.lastUsedAt).toBeNull();

    await core.authenticateApiKey(issued.secret);

    const [listed] = await core.listApiKeys(merchant);
    expect(listed!.lastUsedAt).toBeInstanceOf(Date);
  });

  it('требование подписи включается мерчантом и видно при узнавании', async () => {
    const issued = await core.issueApiKey(merchant, { label: 'сайт' });

    await core.setSignatureRequired(merchant, true);
    expect(await core.authenticateApiKey(issued.secret)).toMatchObject({
      ok: true,
      signatureRequired: true,
    });
    expect((await core.getMerchantProfile(merchant)).signatureRequired).toBe(true);

    await core.setSignatureRequired(merchant, false);
    expect(await core.authenticateApiKey(issued.secret)).toMatchObject({
      ok: true,
      signatureRequired: false,
    });
  });
});

describe('отзыв ключа', () => {
  it('отзывает свой ключ и пишет об этом письмом', async () => {
    const issued = await core.issueApiKey(merchant, { label: 'сайт' });

    const revoked = await core.revokeApiKey(merchant, issued.key.id);
    expect(revoked.key.revokedAt).toBeInstanceOf(Date);
    expect(revoked.notifications).toEqual([
      expect.objectContaining({ kind: 'merchant-api-key-revoked', label: 'сайт' }),
    ]);

    // Отозванный остаётся в списке: на него ссылается журнал.
    const listed = await core.listApiKeys(merchant);
    expect(listed.map((one) => one.revokedAt !== null)).toEqual([true]);
  });

  it('чужой ключ — «не найден», чтобы не подтверждать его существование', async () => {
    const issued = await core.issueApiKey(merchant, { label: 'сайт' });
    const other = await givenMerchant({ email: 'other@example.com' });

    await expect(core.revokeApiKey(other, issued.key.id)).rejects.toMatchObject({
      code: 'not-found',
    });
    expect(await core.authenticateApiKey(issued.secret)).toMatchObject({ ok: true });
  });

  it('дважды не отзывается', async () => {
    const issued = await core.issueApiKey(merchant, { label: 'сайт' });
    await core.revokeApiKey(merchant, issued.key.id);

    await expect(core.revokeApiKey(merchant, issued.key.id)).rejects.toMatchObject({
      code: 'conflict',
    });
  });

  /*
   * Отключённый мерчант в кабинет входит и ключи видит: отозвать ключ,
   * ушедший на чужую машину, он должен и при закрытом доступе.
   */
  it('отключённый мерчант свой ключ отзывает', async () => {
    const issued = await core.issueApiKey(merchant, { label: 'сайт' });
    const admin = await givenStaff({ role: 'admin' });
    await core.setMerchantActive(admin, merchant.merchantId, false);

    const revoked = await core.revokeApiKey(merchant, issued.key.id);
    expect(revoked.key.revokedAt).toBeInstanceOf(Date);
  });
});

describe('ключи глазами сотрудника', () => {
  it('сотрудник видит ключи мерчанта без секретов', async () => {
    const issued = await core.issueApiKey(merchant, { label: 'сайт' });
    const manager = await givenStaff();

    const listed = await core.listMerchantApiKeys(manager, merchant.merchantId);
    expect(listed.map((one) => one.label)).toEqual(['сайт']);
    expect(JSON.stringify(listed)).not.toContain(issued.secret.slice(8, 24));
  });

  it('мерчанту чужие ключи не показываются', async () => {
    const other = await givenMerchant({ email: 'other@example.com' });
    await expect(core.listMerchantApiKeys(other, merchant.merchantId)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });
});
