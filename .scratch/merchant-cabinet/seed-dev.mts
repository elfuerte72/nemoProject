/**
 * Мерчанты в базе разработки — чтобы раздел смотрелся глазами до того,
 * как появится кабинет.
 *
 * Запуск из корня: `pnpm tsx --env-file=.env .scratch/merchant-cabinet/seed-dev.mts`.
 * Только для `nemo_dev`: заводит по мерчанту в каждом состоянии и три
 * заявки у активного. В прод не запускать — скрипт не проверяет, куда
 * смотрит DATABASE_URL, кроме имени базы.
 *
 * Анкеты заводятся операциями ядра, а не записью в таблицы: ровно тем
 * же путём, которым их заведёт кабинет, — иначе сид проверял бы экран
 * на данных, которых в проде не бывает. Почта подтверждается ключом из
 * уведомления: письма здесь никуда не уходят, и ключ берётся оттуда же,
 * откуда его возьмёт доставка.
 */
import { CoreError, createCore, createDatabase } from '@nemo/core';

/**
 * Куда сеять — говорится вслух.
 *
 * Локальная `nemo_dev` разрешена без вопросов: другой базы с таким
 * именем у разработчика нет. База контура называется `nemo` — ровно
 * как продовая, и различить их по имени невозможно, поэтому для неё
 * цель называют руками: `SEED_ALLOW=nemo@localhost:5433`. Строку
 * подтверждения скрипт печатает в отказе, так что случайно она не
 * совпадёт, а осознанно — совпадёт с одного раза.
 *
 * Защита эта от опечатки, а не от злого умысла: тот, кто поднял
 * туннель к проду и повторил строку, снесёт прод. Другой защиты у
 * скрипта, живущего вне приложения, и не бывает.
 */
function seedTarget(url: string): string {
  const withoutUser = url.replace(/^[a-z]+:\/\/[^@]*@/i, '');
  const [hostPort, rest] = [withoutUser.split('/')[0], withoutUser.split('/')[1] ?? ''];
  return `${rest.split('?')[0]}@${hostPort}`;
}

function refuseUnlessAllowed(url: string | undefined): void {
  if (!url) throw new Error('Не задан DATABASE_URL');
  const target = seedTarget(url);
  if (target.startsWith('nemo_dev@')) return;
  if (process.env.SEED_ALLOW === target) return;
  throw new Error(
    `Откажусь сеять в ${target}. Локальная nemo_dev — без вопросов; ` +
      `для контура задайте SEED_ALLOW=${target}, убедившись, что это не прод.`,
  );
}

const url = process.env.DATABASE_URL;
refuseUnlessAllowed(url);

const db = createDatabase(url!);
const core = createCore({
  db,
  requisites: {
    publicKey: process.env.REQUISITES_PUBLIC_KEY,
    privateKey: process.env.REQUISITES_PRIVATE_KEY,
  },
});

/*
 * Сотрудник, от чьего имени сид одобряет анкеты и ведёт заявки. На
 * машине разработчика это тестовый 100001, на контуре — тот, кого там
 * завели первым: сцена одна, а люди в базах разные.
 */
const login = await core.beginStaffLogin(BigInt(process.env.SEED_STAFF_TELEGRAM_ID ?? '100001'));
const admin = { type: 'staff' as const, staffId: login.staffId, role: login.role };

/** Один пароль на всех: сид ставит сцену разработки, а не секреты. */
const PASSWORD = 'правильная лошадь батарейка';

const ANKETY = [
  {
    email: 'oplatishka@example.com',
    name: 'Оплатишка',
    site: 'https://oplatishka.example',
    contactName: 'Пётр Смирнов',
    phone: '+7 999 100-10-10',
    about: 'Оплачиваем подписки клиентов, нужны выплаты в евро и батах.',
  },
  {
    email: 'travelpay@example.com',
    name: 'ТревелПей',
    site: 'https://travelpay.example',
    contactName: 'Анна Ковалёва',
    phone: '+7 999 200-20-20',
    about: 'Бронируем отели в Таиланде, платим за клиентов на месте.',
  },
  {
    email: 'shopdrop@example.com',
    name: 'ШопДроп',
    site: null,
    contactName: 'Максим Дев',
    phone: '+7 999 300-30-30',
    about: 'Выкупаем товары в зарубежных магазинах.',
  },
  {
    email: 'nightbird@example.com',
    name: 'Найтбёрд',
    site: null,
    contactName: 'Сергей Х.',
    phone: '+7 999 400-40-40',
    about: 'Пока не решили, что именно будем делать.',
  },
];

/** Ключ подтверждения почты — из уведомления: письма тут не отправляются. */
function tokenOf(notifications: readonly { kind: string }[]): string {
  const found = notifications.find((one) => one.kind === 'merchant-email-verification');
  if (!found || !('token' in found)) {
    throw new Error('В ответе нет ключа подтверждения почты');
  }
  return found.token as string;
}

/*
 * Второй прогон ничего не делает: почта уже занята, а удалять мерчанта
 * с заявками база не даст — на него ссылаются. Молча падать при этом
 * нельзя: сид зовут после каждой правки, и «ConflictError» в консоли
 * читается как поломка панели.
 */
const ids: string[] = [];
for (const anketa of ANKETY) {
  const registered = await core
    .registerMerchant({
      ...anketa,
      site: anketa.site ?? undefined,
      password: PASSWORD,
    })
    .catch((error: unknown) => {
      if (error instanceof CoreError && error.code === 'conflict') return null;
      throw error;
    });
  if (registered === null) {
    console.log('Мерчанты уже заведены — сид ничего не меняет.');
    await db.$client.end();
    process.exit(0);
  }
  await core.verifyMerchantEmail(tokenOf(registered.notifications));
  ids.push(registered.merchant.id);
}

const [active, disabled, rejected] = ids;

await core.approveMerchant(admin, active!);
await core.approveMerchant(admin, disabled!);
await core.setMerchantActive(admin, disabled!, false);
await core.rejectMerchant(admin, rejected!, {
  reason: 'Не описали, что собираетесь делать. Напишите в поддержку — разберёмся.',
});
// Четвёртый остаётся на рассмотрении: раздел открывается на нём.

// Заявки подаёт владелец активного кабинета: вход отдаёт и человека, и
// его роль — ровно то, из чего актора собирает сам кабинет (тикет 17).
const session = await core.beginMerchantLogin({
  email: 'oplatishka@example.com',
  password: PASSWORD,
});

const REFERENCES = ['booking-1024', 'sub-2026-09', 'order-77'];
for (const reference of REFERENCES) {
  await core.submitExchangeRequest(
    {
      type: 'merchant',
      merchantId: session.merchantId,
      userId: session.userId,
      role: session.role,
    },
    {
      kind: 'electronic',
      fromCode: 'USDT',
      toCode: 'RUB',
      fromAmount: String(100 + REFERENCES.indexOf(reference) * 250),
      reference,
      idempotencyKey: reference,
      payout: { kind: 'phone', bankName: 'Т-Банк', phone: '+79991234567' },
    },
  );
}

console.log(`Заведено мерчантов: ${ids.length}, заявок: ${REFERENCES.length}`);
await db.$client.end();
