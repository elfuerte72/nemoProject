/**
 * Вход в панель без двух факторов — только для разработки.
 *
 * Вход по Telegram Login на своей машине не работает и работать не
 * может: виджет требует настоящий домен, привязанный к боту, и на
 * `localhost` отвечает «Bot domain invalid». Без обхода панель на своей
 * машине не открывается вовсе — то есть не проверяется глазами то, ради
 * чего её и пишут.
 *
 * Пропускаются при этом ровно два фактора — подпись Telegram и
 * одноразовый код. Проверка «сотрудник ли это» остаётся: войти можно
 * только тем, кто заведён, действует и кому выдан ключ, — тем же путём
 * через `beginStaffLogin`, каким входит настоящий вход.
 *
 * Разрешение спрашивается дважды и в двух разных местах: сборка должна
 * быть для разработки, и переменная должна быть заведена руками. Одного
 * `NODE_ENV` мало — `next dev` поднимают и на общей машине, и в
 * контейнере с настоящей базой; одной переменной мало — забытая в
 * окружении, она открыла бы вход на живом сервисе.
 */

export interface DevLoginEnvironment {
  readonly nodeEnv: string | undefined;
  readonly flag: string | undefined;
}

/** Значения, которыми разрешение включают. Прочее — запрет. */
const ALLOWED_FLAGS = new Set(['1', 'true', 'yes']);

export function devLoginAllowed({ nodeEnv, flag }: DevLoginEnvironment): boolean {
  // Незнакомое окружение считается продом: `NODE_ENV` задаётся не
  // только сборкой, и пустое значение при разворачивании — обычное
  // дело. Трактовать его как разработку значило бы открывать вход
  // ровно тогда, когда о нём не подумали.
  if (nodeEnv !== 'development') return false;
  return flag !== undefined && ALLOWED_FLAGS.has(flag.trim().toLowerCase());
}

/** То же по текущему окружению процесса. */
export function devLoginAllowedHere(): boolean {
  return devLoginAllowed({
    nodeEnv: process.env.NODE_ENV,
    flag: process.env.ADMIN_DEV_LOGIN,
  });
}
