import { generateRequisiteKeyPair } from '@nemo/crypto';

/**
 * Выпустить пару ключей шифрования реквизитов (docs/adr/0002).
 *
 * Разовая операция при развёртывании. Публичный ключ едет в оба
 * приложения — им шифруются номера карт, реквизиты вывода и секреты
 * второго фактора. Приватный — только в деплой админ-панели: в
 * клиентском его быть не должно, иначе смысл разделения приложений
 * пропадает.
 *
 * Запуск: pnpm generate-keys
 */
const { publicKey, privateKey } = generateRequisiteKeyPair();

console.log('# В оба приложения:');
console.log(`REQUISITES_PUBLIC_KEY="${publicKey.trim()}"`);
console.log();
console.log('# ТОЛЬКО в деплой админ-панели:');
console.log(`REQUISITES_PRIVATE_KEY="${privateKey.trim()}"`);
