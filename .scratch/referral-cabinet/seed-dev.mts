/**
 * Сеть рефералов, уровни и личная ставка в базе разработки — чтобы
 * смотреть панель и Mini App глазами. Только для `nemo_dev`, нужен
 * заведённый администратор 100001 (Максим из базы разработки); запуск:
 * `pnpm tsx --env-file=.env .scratch/referral-cabinet/seed-dev.mts`.
 */
import { createCore, createDatabase } from '@nemo/core';

const url = process.env.DATABASE_URL;
if (!url || !url.endsWith('/nemo_dev')) throw new Error('Только для nemo_dev');
const db = createDatabase(url);
const core = createCore({ db, requisites: { publicKey: process.env.REQUISITES_PUBLIC_KEY } });
const login = await core.beginStaffLogin(100001n);
const admin = { type: 'staff' as const, staffId: login.staffId, role: login.role };

const top = await core.registerClient({ telegramUserId: 777001n, username: 'referrer_demo' });
const code = top.client.referralCode;
await core.createReferralCode({ type: 'client', telegramUserId: 777001n }, { kind: 'promo', label: 'Лето', code: 'SUMMER26' });
const second = await core.registerClient({ telegramUserId: 777002n, username: 'ref_a', referralCode: code });
await core.registerClient({ telegramUserId: 777003n, username: 'ref_b', referralCode: 'summer26' });
await core.registerClient({ telegramUserId: 777004n, username: 'ref_c', referralCode: second.client.referralCode });
await core.upsertReferralTier(admin, { name: 'Серебро', minActiveReferrals: 1, rates: [{ line: 1, rateBps: 800 }] });
await core.upsertReferralTier(admin, { name: 'Золото', minActiveReferrals: 5, rates: [{ line: 1, rateBps: 1000 }, { line: 2, rateBps: 300 }] });

for (const id of [777002n, 777003n]) {
  const { request } = await core.submitExchangeRequest({ type: 'client', telegramUserId: id }, {
    kind: 'cash', fromCode: 'USDT', toCode: 'RUB', fromAmount: '1000',
  });
  await core.claimExchangeRequest(admin, request.id);
  await core.confirmExchangeRate(admin, request.id, { finalRate: '95', paymentInstructions: 'наличными' });
  await core.markPaymentReceived(admin, request.id);
  await core.completeExchangeRequest(admin, request.id, { serviceIncome: '1000', serviceIncomeCode: 'RUB' });
}
await core.setClientReferralRates(admin, 777001n, [{ line: 2, rateBps: 400 }]);
console.log('готово: реферер 777001');
await db.$client.end();
