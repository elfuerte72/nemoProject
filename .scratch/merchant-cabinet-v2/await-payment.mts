/**
 * Довести одну новую заявку демо-мерчанта до «Курс подтверждён» — чтобы
 * карточку заявки, которая ждёт оплаты, было на чём смотреть: срок,
 * остаток, строка пути.
 *
 * Операциями ядра, а не правкой строки: у подправленной руками заявки
 * нет истории, и карточка показывала бы состояние, в которое нельзя
 * прийти. Только локальная база разработки — на контур не годится:
 * заявка через два часа истечёт, и демо-данные там ведёт сид.
 *
 *   pnpm tsx --env-file=.env .scratch/merchant-cabinet-v2/await-payment.mts
 */
import { and, eq } from 'drizzle-orm';
import { exchangeRequests, merchantUsers } from '@nemo/db';
import { createCore, createDatabase } from '@nemo/core';

const url = process.env.DATABASE_URL ?? '';
if (!/@(localhost|127\.0\.0\.1):\d+\/nemo_dev$/.test(url)) {
  throw new Error('Только локальная nemo_dev: на контуре демо-данные ведёт сид.');
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
  .select({ merchantId: merchantUsers.merchantId })
  .from(merchantUsers)
  .where(eq(merchantUsers.email, 'oplatishka@example.com'))
  .limit(1);
if (!shop) throw new Error('Нет демо-мерчанта: сначала seed-dev.mts');

const [fresh] = await db
  .select({ id: exchangeRequests.id, fromCode: exchangeRequests.fromCode })
  .from(exchangeRequests)
  .where(and(eq(exchangeRequests.merchantId, shop.merchantId), eq(exchangeRequests.status, 'new')))
  .limit(1);
if (!fresh) throw new Error('Новых заявок у демо-мерчанта нет.');

await core.claimExchangeRequest(manager, fresh.id);
await core.confirmExchangeRate(manager, fresh.id, {
  // Курс — по направлению: «сколько получаемой валюты за единицу отдаваемой».
  finalRate: fresh.fromCode === 'RUB' ? '0.01227' : '81.5',
  paymentInstructions: 'Сбербанк, карта 2202 2000 0000 1111, получатель ООО «Тоби»',
});

console.log(`ждёт оплаты: /requests/${fresh.id}`);
process.exit(0);
