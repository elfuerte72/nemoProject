import QRCode from 'qrcode';
import { CoreError, createCore, createDatabase } from '@nemo/core';
import { totpCode } from '@nemo/crypto';

/**
 * Выдать сотруднику второй фактор заново из консоли сервера.
 *
 * То же самое умеет администратор в разделе «Сотрудники», и обычно
 * делать это надо там. Скрипт нужен для случая, когда в админку не
 * войти вовсе: администратор потерял телефон, ключ занесён в приложение
 * с ошибкой или сотрудников-администраторов всего один. Тогда сброс
 * изнутри админки недоступен по определению — войти, чтобы починить
 * вход, нельзя.
 *
 * Прав скрипт не спрашивает: его защищает доступ к серверу, как и
 * `create-first-admin`. По той же причине эта операция не выведена в
 * сеть отдельным адресом.
 *
 * Запуск: pnpm reissue-second-factor <telegram_user_id>
 */

const [telegramUserId] = process.argv.slice(2);

if (!telegramUserId || !/^\d+$/.test(telegramUserId)) {
  console.error('Использование: pnpm reissue-second-factor <telegram_user_id>');
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Не задан DATABASE_URL');
  process.exit(1);
}

const publicKey = process.env.REQUISITES_PUBLIC_KEY;
if (!publicKey) {
  // Секрет второго фактора шифруется тем же ключом, что и реквизиты.
  console.error('Не задан REQUISITES_PUBLIC_KEY: секрет второго фактора нечем зашифровать');
  process.exit(1);
}

async function main(): Promise<void> {
  const db = createDatabase(url!);
  const core = createCore({ db, requisites: { publicKey } });

  try {
    const { staff, enrollmentSecret, otpauthUri } = await core.reissueSecondFactorFromConsole(
      BigInt(telegramUserId!),
    );

    console.log(
      `Второй фактор выдан заново: ${staff.displayName} · ${staff.role} · ${staff.telegramUserId}`,
    );
    console.log('Прежний ключ перестал работать прямо сейчас.\n');

    console.log(await QRCode.toString(otpauthUri, { type: 'terminal', small: true }));
    console.log('Наведите камеру приложения-аутентификатора на код выше.');
    console.log(`Либо добавьте ключ вручную: ${enrollmentSecret}`);
    console.log('Показывается один раз — второй раз его не будет.\n');

    /*
     * Код рядом с ключом — не удобство, а проверка. «Код не подходит»
     * бывает и от неверно перенесённого ключа, и от разошедшихся часов
     * телефона, и лечится это по-разному. Совпал показанный ниже код с
     * тем, что в приложении, — часы в порядке, дело было в ключе; не
     * совпал при верно снятом коде для камеры — надо править время на
     * телефоне (в Google Authenticator: «Коррекция времени для кодов»).
     */
    const now = new Date();
    console.log(`Сейчас на сервере: ${now.toISOString()}`);
    console.log(`Код в эту секунду: ${totpCode(enrollmentSecret, { now })}`);
    console.log('Если приложение показывает другой код — разошлись часы, а не ключ.');
  } catch (error) {
    // Отказ операции — не авария скрипта: чаще всего он означает, что
    // Telegram указан не тот. Стек в этом случае только мешает.
    if (error instanceof CoreError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  } finally {
    await db.$client.end();
  }
}

await main();
