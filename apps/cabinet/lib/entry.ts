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

/**
 * Двери без перенаправления: сюда ведут выход из обоих кабинетов, знак
 * на экранах входа и кабинет амбассадора без входа.
 *
 * Корень уводит вошедшего в его кабинет — письма мерчанту ведут на
 * корень, и выбора, которого перед ним нет, он видеть не должен. Но тот
 * же корень прятал вторую дверь: вошедший мерчант до двери амбассадора
 * не доходил, а вышедший амбассадор при живой сессии мерчанта попадал в
 * чужой кабинет. Поэтому у дверей есть свой адрес, который не уводит
 * никого.
 */
export const DOORS_PATH = '/?doors';

/** Просят ли двери: параметр `doors` есть, значение не важно. */
export function wantsDoors(params: Readonly<Record<string, string | string[] | undefined>>): boolean {
  return params.doors !== undefined;
}

/** Кем вошли за каждой дверью: название кабинета и подпись амбассадора. */
export interface EntrySignedIn {
  readonly merchant: string | null;
  readonly ambassador: string | null;
}

export type EntryRoute =
  | { readonly kind: 'redirect'; readonly to: '/dashboard' | '/ambassador' }
  | { readonly kind: 'doors'; readonly signedIn: EntrySignedIn };

/**
 * Что делать витрине. Мерчант первым — так корень решал и до дверей по
 * ссылке, и письма, ведущие на корень, приводят в тот же кабинет.
 */
export function entryRoute(input: EntrySignedIn & { readonly showDoors: boolean }): EntryRoute {
  const signedIn = { merchant: input.merchant, ambassador: input.ambassador };
  if (!input.showDoors) {
    if (signedIn.merchant !== null) return { kind: 'redirect', to: '/dashboard' };
    if (signedIn.ambassador !== null) return { kind: 'redirect', to: '/ambassador' };
  }
  return { kind: 'doors', signedIn };
}

/** Ссылка на бота — тому, кто пришёл сюда за обменом, а не за кабинетом. */
export function botLink(botUsername: string | null): string | null {
  return botUsername ? `https://t.me/${botUsername}` : null;
}
