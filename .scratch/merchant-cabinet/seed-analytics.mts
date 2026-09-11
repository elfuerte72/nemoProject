/**
 * Заявки мерчанта под аналитику — чтобы раздел смотрелся глазами.
 *
 * Запуск из корня: `pnpm tsx --env-file=.env .scratch/merchant-cabinet/seed-analytics.mts`.
 * Только для `nemo_dev`. Дополняет `seed-dev.mts`: тот заводит анкеты,
 * этот раскладывает заявки по дням, направлениям, получателям и
 * источникам, чтобы в разрезах было что читать.
 *
 * Заявки заводятся операциями ядра, а не строками: сцена должна быть
 * достижимой тем же путём, которым её создаст кабинет. Даты правятся
 * после — операции пишут «сейчас», а разрезам нужны дни.
 */
import { eq } from 'drizzle-orm';
import { createCore, createDatabase } from '@nemo/core';
import { exchangeRequests, merchants } from '@nemo/db';

const url = process.env.DATABASE_URL;
if (!url || !url.endsWith('/nemo_dev')) {
  throw new Error('Только для nemo_dev');
}

const db = createDatabase(url);
const core = createCore({
  db,
  requisites: {
    publicKey: process.env.REQUISITES_PUBLIC_KEY,
    privateKey: process.env.REQUISITES_PRIVATE_KEY,
  },
});

const login = await core.beginStaffLogin(100001n);
const manager = { type: 'staff' as const, staffId: login.staffId, role: login.role };

const [shop] = await db
  .select({ id: merchants.id })
  .from(merchants)
  .where(eq(merchants.email, 'oplatishka@example.com'))
  .limit(1);
if (!shop) throw new Error('Сначала заведите мерчантов: seed-dev.mts');
const owner = { type: 'merchant' as const, merchantId: shop.id };

const DAY = 24 * 60 * 60 * 1000;
const at = (daysAgo: number, hour: number) => {
  const date = new Date();
  date.setUTCHours(hour, 0, 0, 0);
  return new Date(date.getTime() - daysAgo * DAY);
};

const CARD = { kind: 'card', bankName: 'Сбербанк', cardNumber: '4111111111111111' } as const;
const OTHER_CARD = { kind: 'card', bankName: 'Т-Банк', cardNumber: '5555555555554444' } as const;
const PHONE = { kind: 'phone', bankName: 'Альфа-Банк', phone: '+79995550101' } as const;
const WALLET = {
  kind: 'wallet',
  network: 'TRC20',
  address: 'TN3W4H6rK2ce4vX9YnFQHwKENnHjJ8nZ3f',
} as const;

type Fate = 'completed' | 'cancelled' | 'open';

const SCENE: readonly {
  from: string;
  to: string;
  amount: string;
  fate: Fate;
  day: number;
  hour: number;
  payout: typeof CARD | typeof OTHER_CARD | typeof PHONE | typeof WALLET;
  source: 'cabinet' | 'api';
}[] = [
  { from: 'USDT', to: 'RUB', amount: '450', fate: 'completed', day: 26, hour: 11, payout: CARD, source: 'api' },
  { from: 'USDT', to: 'RUB', amount: '1200', fate: 'completed', day: 24, hour: 15, payout: CARD, source: 'api' },
  { from: 'RUB', to: 'USDT', amount: '120000', fate: 'completed', day: 22, hour: 10, payout: WALLET, source: 'cabinet' },
  { from: 'USDT', to: 'RUB', amount: '300', fate: 'cancelled', day: 21, hour: 19, payout: OTHER_CARD, source: 'api' },
  { from: 'USDT', to: 'RUB', amount: '800', fate: 'completed', day: 18, hour: 13, payout: PHONE, source: 'api' },
  { from: 'RUB', to: 'USDT', amount: '75000', fate: 'completed', day: 16, hour: 20, payout: WALLET, source: 'cabinet' },
  { from: 'USDT', to: 'RUB', amount: '220', fate: 'completed', day: 14, hour: 9, payout: CARD, source: 'api' },
  { from: 'USDT', to: 'RUB', amount: '640', fate: 'cancelled', day: 12, hour: 17, payout: OTHER_CARD, source: 'cabinet' },
  { from: 'USDT', to: 'RUB', amount: '980', fate: 'completed', day: 9, hour: 12, payout: CARD, source: 'api' },
  { from: 'RUB', to: 'USDT', amount: '43000', fate: 'completed', day: 7, hour: 21, payout: WALLET, source: 'api' },
  { from: 'USDT', to: 'RUB', amount: '150', fate: 'completed', day: 5, hour: 14, payout: PHONE, source: 'cabinet' },
  { from: 'USDT', to: 'RUB', amount: '2400', fate: 'completed', day: 4, hour: 16, payout: CARD, source: 'api' },
  { from: 'USDT', to: 'RUB', amount: '390', fate: 'open', day: 2, hour: 11, payout: OTHER_CARD, source: 'cabinet' },
  { from: 'RUB', to: 'USDT', amount: '58000', fate: 'open', day: 1, hour: 18, payout: WALLET, source: 'api' },
];

let made = 0;
for (const one of SCENE) {
  const key = `seed-${one.day}-${one.hour}-${one.amount}`;
  const { request } = await core.submitExchangeRequest(owner, {
    kind: 'electronic',
    fromCode: one.from,
    toCode: one.to,
    fromAmount: one.amount,
    reference: `order-${1000 + made}`,
    idempotencyKey: key,
    payout: one.payout,
    source: one.source,
  });
  const submitted = at(one.day, one.hour);
  let finished = submitted;
  if (one.fate !== 'open') {
    await core.claimExchangeRequest(manager, request.id);
    await core.confirmExchangeRate(manager, request.id, {
      finalRate: '81.5',
      paymentInstructions: 'Реквизиты в кабинете',
    });
    if (one.fate === 'completed') {
      await core.markPaymentReceived(manager, request.id);
      await core.completeExchangeRequest(manager, request.id, {
        serviceIncome: '3',
        serviceIncomeCode: one.from,
      });
      finished = new Date(submitted.getTime() + (1 + (made % 5)) * 3600_000);
    } else {
      await core.cancelExchangeRequest(manager, request.id, { reason: 'Покупатель не заплатил' });
      finished = new Date(submitted.getTime() + 5 * 3600_000);
    }
  }
  await db
    .update(exchangeRequests)
    .set({
      createdAt: submitted,
      updatedAt: finished,
      ...(one.fate === 'completed' ? { completedAt: finished } : {}),
    })
    .where(eq(exchangeRequests.id, request.id));
  made += 1;
}

console.log(`Заявок заведено: ${made}`);
await db.$client.end();
