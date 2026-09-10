/**
 * Витрина: чем она располагает и что из этого можно показать.
 *
 * Вынесено из разметки, потому что решение здесь одно и важное: без
 * настроенного виджета кнопка Telegram молчала бы, а молчащая кнопка
 * хуже отсутствующей — человек жмёт её и решает, что сломан он.
 * Правило проверяется тестом; вид — глазами.
 */

export interface EntryEnvironment {
  /** Имя бота, чей виджет ставит кнопку входа. */
  readonly botUsername: string | undefined;
  /** Токен того же бота: им проверяется подпись. Сюда не попадает — только «есть ли». */
  readonly botTokenSet: boolean;
}

export interface EntryDoors {
  /** Имя бота для виджета; пусто — вход амбассадора не настроен. */
  readonly botUsername: string | null;
  /** Что сказать вместо кнопки. Пусто — показывается кнопка. */
  readonly ambassadorNote: string | null;
}

const NOT_CONFIGURED =
  'Вход для амбассадоров пока не настроен на этом адресе. Напишите нам — откроем доступ.';

export function entryDoors(env: EntryEnvironment): EntryDoors {
  const bot = env.botUsername?.trim().replace(/^@/, '');
  // Обе половины или ничего: имя без токена соберёт кнопку, подпись
  // которой некому проверить, а токен без имени не соберёт и кнопки.
  if (!bot || !env.botTokenSet) {
    return { botUsername: null, ambassadorNote: NOT_CONFIGURED };
  }
  return { botUsername: bot, ambassadorNote: null };
}

/** Ссылка на бота — тому, кто пришёл сюда за обменом, а не за кабинетом. */
export function botLink(botUsername: string | null): string | null {
  return botUsername ? `https://t.me/${botUsername}` : null;
}
