import { z } from 'zod';

/**
 * Реферальная программа: линии, коды, промокоды.
 *
 * Правила лежат здесь, а не в ядре, потому что их читают трое: ядро при
 * привязке и начислении, Mini App до отправки формы, панель в
 * настройках. Форма, проверяющая промокод не тем правилом, каким его
 * отвергает операция, приняла бы код, который ядро вернёт отказом.
 */

/**
 * Глубже пятой линии сервис не платит никогда: цепочка предков пишется
 * при регистрации до этой глубины (docs/adr/0019), а сколько из них
 * оплачивается, задаёт администратор.
 */
export const MAX_REFERRAL_DEPTH = 5;

/** Линия реферальной сети: расстояние от реферера до реферала в цепочке. */
export const referralLines = [1, 2, 3, 4, 5] as const;
export const referralLineSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);
export type ReferralLine = z.infer<typeof referralLineSchema>;

export function isReferralLine(value: number): value is ReferralLine {
  return (referralLines as readonly number[]).includes(value);
}

const LINE_WORDS: Record<ReferralLine, string> = {
  1: 'первой',
  2: 'второй',
  3: 'третьей',
  4: 'четвёртой',
  5: 'пятой',
};

/** «Реферал первой линии» — линия словом в родительном падеже, для текстов. */
export function referralLineWord(line: ReferralLine): string {
  return LINE_WORDS[line];
}

const LINE_NAMES: Record<ReferralLine, string> = {
  1: 'первая',
  2: 'вторая',
  3: 'третья',
  4: 'четвёртая',
  5: 'пятая',
};

/** «Первая линия» — подпись плитки и колонки, в именительном падеже. */
export function referralLineName(line: ReferralLine): string {
  return LINE_NAMES[line];
}

/**
 * Вид кода: ссылка — сгенерированный код в `startapp`, промокод — слово,
 * которое клиент выбрал сам и которое знакомый вводит руками.
 */
export const referralCodeKinds = ['link', 'promo'] as const;
export const referralCodeKindSchema = z.enum(referralCodeKinds);
export type ReferralCodeKind = z.infer<typeof referralCodeKindSchema>;

/** Сколько действующих кодов у клиента может быть разом. */
export const REFERRAL_CODE_LIMIT = 10;

/**
 * Слова сервиса промокодом не отдаются: «TOBEE» или «SUPPORT» в чужой
 * ссылке читались бы как код самого сервиса.
 */
export const PROMO_CODE_STOP_LIST = ['TOBEE', 'ADMIN', 'SUPPORT', 'NEMO'] as const;

/** Регистр и пробелы по краям не различаются: код набирают руками. */
export function normalizeReferralCode(code: string): string {
  return code.trim().toUpperCase();
}

/**
 * Промокод — слово от четырёх до шестнадцати знаков, латиница и цифры.
 * Хранится в верхнем регистре: сравнение без учёта регистра держит
 * индекс базы, а показывать одно и то же слово двумя написаниями
 * незачем.
 */
export const promoCodeSchema = z
  .string()
  .trim()
  .min(4, 'Промокод — от 4 знаков')
  .max(16, 'Промокод — до 16 знаков')
  .regex(/^[A-Za-z0-9]+$/, 'Промокод — латиница и цифры, без пробелов')
  .transform((value) => value.toUpperCase())
  .refine((value) => !(PROMO_CODE_STOP_LIST as readonly string[]).includes(value), {
    message: 'Это слово занято сервисом — выберите другое',
  });
