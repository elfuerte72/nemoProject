/**
 * Наполнение базы разработки для проверки панели глазами.
 *
 * Запуск из корня: `pnpm tsx --env-file=.env .scratch/lovepay-crm/seed-dev.mts`.
 * Только для `nemo_dev`: заводит клиентов, наличные заявки во всех
 * состояниях, пару обращений, и разбрасывает даты по последним тридцати
 * дням. В прод не запускать — скрипт не проверяет, куда смотрит
 * DATABASE_URL, кроме имени базы.
 */
import { createCore, createDatabase } from '@nemo/core';
import { sql } from 'drizzle-orm';

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
const admin = { type: 'staff' as const, staffId: login.staffId, role: login.role };

const names = [
  'tobee_alisa', 'petr_smirnov', null, 'anna_k', 'maks_dev', 'ivan1990', null,
  'olga_travel', 'dmitry_b', 'kate_th', null, 'sergey_x',
];

const clients: bigint[] = [];
for (const [i, username] of names.entries()) {
  const id = BigInt(5000 + i);
  await core.registerClient({ telegramUserId: id, ...(username ? { username } : {}) });
  clients.push(id);
}

const asClient = (telegramUserId: bigint) => ({ type: 'client' as const, telegramUserId });
const rand = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;

const ids: { id: string; createdDaysAgo: number }[] = [];
for (let n = 0; n < 60; n += 1) {
  const client = clients[n % clients.length]!;
  const toRub = n % 3 !== 0;
  const fromAmount = toRub ? String(rand(40, 900)) : String(rand(4000, 90000));
  const { request } = await core.submitExchangeRequest(asClient(client), {
    kind: 'cash',
    fromCode: toRub ? 'USDT' : 'RUB',
    toCode: toRub ? 'RUB' : 'USDT',
    fromAmount,
  });
  const daysAgo = rand(0, 29);
  ids.push({ id: request.id, createdDaysAgo: daysAgo });

  const fate = n % 5;
  if (fate === 0) continue; // остаётся в очереди
  await core.claimExchangeRequest(admin, request.id);
  if (fate === 1) continue; // в работе
  const rate = toRub ? '81.50' : '0.01227';
  const toAmount = toRub
    ? String(Math.round(Number(fromAmount) * 81.5))
    : (Number(fromAmount) * 0.01227).toFixed(2);
  await core.confirmExchangeRate(admin, request.id, {
    finalRate: rate,
    toAmount,
    paymentInstructions: 'Встречаемся у кассы на Сукхумвит, 21',
  });
  if (fate === 2) continue; // курс подтверждён
  await core.markPaymentReceived(admin, request.id);
  if (fate === 3) {
    await core.completeExchangeRequest(admin, request.id, {
      serviceIncome: toRub ? String(Math.round(Number(toAmount) * 0.02)) : (Number(toAmount) * 0.02).toFixed(2),
      serviceIncomeCode: toRub ? 'RUB' : 'USDT',
    });
    continue;
  }
  await core.cancelExchangeRequest(admin, request.id, { reason: 'Клиент не пришёл на встречу' });
}

for (const { id, createdDaysAgo } of ids) {
  const shift = `${createdDaysAgo} days ${rand(0, 23)} hours`;
  await db.execute(
    sql`update exchange_requests set created_at = created_at - ${shift}::interval, updated_at = updated_at - ${shift}::interval, completed_at = completed_at - ${shift}::interval where id = ${id}`,
  );
  await db.execute(
    sql`update exchange_request_events set created_at = created_at - ${shift}::interval where request_id = ${id}`,
  );
}

await core.receiveClientMessage({ telegramUserId: clients[0]!, body: 'Здравствуйте, когда придут баты?', username: 'tobee_alisa' });
await core.receiveClientMessage({ telegramUserId: clients[3]!, body: 'Можно оплатить отель в Пхукете?', username: 'anna_k', topic: 'hotel' });

console.log(`Готово: ${clients.length} клиентов, ${ids.length} заявок`);
process.exit(0);
