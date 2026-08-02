import QRCode from 'qrcode';
import { CoreError, createCore, createDatabase } from '@nemo/core';

/**
 * Завести первого администратора при развёртывании.
 *
 * Второй фактор сотруднику выдаёт администратор, а первого
 * администратора выдать некому: пока список сотрудников пуст, войти в
 * админку нельзя вовсе. Этот скрипт — единственный выход из тупика, и
 * работает он ровно один раз: на непустом списке операция отказывает.
 *
 * Скрипт, а не экран: развёртывание выполняет тот, у кого есть доступ к
 * серверу, и открытый в сети адрес «сделать себя администратором» на
 * свежем деплое достался бы тому, кто нашёл его первым.
 *
 * Запуск: pnpm create-first-admin <telegram_user_id> "<Имя>"
 */

const [telegramUserId, displayName] = process.argv.slice(2);

if (!telegramUserId || !displayName) {
  console.error('Использование: pnpm create-first-admin <telegram_user_id> "<Имя>"');
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
    const { staff, enrollmentSecret, otpauthUri } = await core.enrollFirstAdmin({
      telegramUserId: BigInt(telegramUserId!),
      displayName: displayName!,
    });

    console.log(`Администратор «${staff.displayName}» заведён.\n`);

    // Код прямо в терминале: переписывать тридцать два знака руками —
    // занятие, на котором ошибаются, а ошибка выглядит как «код не
    // подходит» и уводит разбираться не туда.
    console.log(await QRCode.toString(otpauthUri, { type: 'terminal', small: true }));
    console.log('Наведите камеру приложения-аутентификатора на код выше.');
    console.log(`Либо добавьте ключ вручную: ${enrollmentSecret}`);
    console.log('Показывается один раз — второй раз его не будет.');
  } catch (error) {
    // Отказ операции — не авария скрипта: чаще всего он означает, что
    // сотрудники уже заведены. Стек в этом случае только мешает.
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
