import { referralLineName, type ReferralLine } from '@nemo/types';

/**
 * Тексты реферального кабинета, которые читает клиент: пустые состояния,
 * подписи под рисунками, строки с числами. В коде рядом с экраном, как
 * тексты бота, и под той же проверкой на машинный набор — строки с
 * числами проверяются на образцах.
 */
export const REFERRAL_TEXTS = {
  noReferrals:
    'Пока никого: отправьте ссылку или назовите промокод, и здесь появится каждый, кто по ним придёт.',
  referralsFailed: 'Не удалось загрузить рефералов. Потяните раздел, чтобы обновить.',
  barsNote: 'Столбики показывают начисленное по дням за две недели, числа под ними — сколько пришло.',
  noTurnover: 'обменов не было',
  topTier: 'Выше уровня нет: это верхний.',
  counting: 'Считаем…',
  notExchanged: 'ещё не обменивал',
  activatedNote: 'по всем линиям',
  shareText: 'Меняю валюту через Tobee — курс видно до подачи, менеджер на связи. Заходи по моей ссылке.',
  promoAccepted: 'Теперь вы в сети того, кто вас позвал: ему начислятся баллы с ваших обменов, а вам — со своих приглашённых.',
  promoHint: 'Промокод от знакомого можно ввести, пока у вас нет заявок.',
  newLink: 'У ссылки будет своё название, чтобы видеть, откуда приходят: сторис, канал, друзья.',
  newPromo: 'Слово от четырёх до шестнадцати латинских букв и цифр. Его называют голосом и вводят в приложении.',
  archiveBody: 'Код уйдёт из списка, новые по нему не придут. Те, кто уже пришёл, остаются вашими рефералами.',
} as const;

/** «До уровня «Золото» ещё 4 активных реферала первой линии, сейчас 6». */
export function nextTierNote(name: string, toNext: number, active: number): string {
  const word = plural(toNext, ['активный реферал', 'активных реферала', 'активных рефералов']);
  return `До уровня «${name}» ещё ${toNext} ${word} первой линии${active > 0 ? `, сейчас ${active}` : ''}`;
}

/** Подпись плитки с суммой: сумму не вычитаем, называем прошлую. */
export function previousNote(previous: string): string {
  return `в прошлый период ${previous}`;
}

export function pendingNote(pending: string): string {
  return `Ждёт выплаты: ${pending}`;
}

export function allReferralsButton(total: number): string {
  return `Все рефералы: ${total}`;
}

/** «первая линия · с 6 сентября · активен, 3 обмена, последний сегодня». */
export function referralRowSub(input: {
  readonly line: ReferralLine;
  readonly since: string;
  readonly completedCount: number;
  readonly last: string | null;
}): string {
  const exchanges =
    input.completedCount === 0
      ? REFERRAL_TEXTS.notExchanged
      : `активен, ${input.completedCount} ${plural(input.completedCount, ['обмен', 'обмена', 'обменов'])}` +
        (input.last ? `, последний ${input.last}` : '');
  return `${referralLineName(input.line)} линия · с ${input.since} · ${exchanges}`;
}

/** «1 обмен», «2 обмена», «5 обменов» — иначе число выглядит опечаткой. */
export function plural(count: number, forms: readonly [string, string, string]): string {
  const tens = count % 100;
  const ones = count % 10;
  if (tens > 10 && tens < 20) return forms[2];
  if (ones === 1) return forms[0];
  if (ones > 1 && ones < 5) return forms[1];
  return forms[2];
}
