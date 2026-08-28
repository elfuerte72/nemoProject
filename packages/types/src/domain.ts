import { z } from 'zod';

/**
 * Перечисления доменного языка проекта. Русские названия терминов —
 * в `CONTEXT.md` в корне репозитория; здесь их машинные соответствия.
 */

/** Идентификатор клиента. Telegram отдаёт число, но оно уже вышло за 32 бита. */
export const telegramUserIdSchema = z.coerce.bigint().positive();
export type TelegramUserId = z.infer<typeof telegramUserIdSchema>;

/**
 * Состояния заявки на обмен.
 *
 * `new` ставит система; все остальные — менеджер. Переход в `completed`
 * — единственная точка, где фиксируется доход по заявке и начисляются
 * реферальные баллы (см. docs/adr/0003).
 */
export const exchangeRequestStatuses = [
  'new', // новая
  'in_progress', // в работе
  'rate_confirmed', // курс подтверждён
  'payment_received', // оплата получена
  'completed', // исполнена
  'cancelled', // отменена
] as const;
export const exchangeRequestStatusSchema = z.enum(exchangeRequestStatuses);
export type ExchangeRequestStatus = z.infer<typeof exchangeRequestStatusSchema>;

/** Допустимые переходы. Всё, чего здесь нет, — ошибка, а не «на всякий случай». */
export const exchangeRequestTransitions: Record<
  ExchangeRequestStatus,
  readonly ExchangeRequestStatus[]
> = {
  new: ['in_progress', 'cancelled'],
  in_progress: ['rate_confirmed', 'cancelled'],
  rate_confirmed: ['payment_received', 'cancelled'],
  payment_received: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

export function canTransition(
  from: ExchangeRequestStatus,
  to: ExchangeRequestStatus,
): boolean {
  return exchangeRequestTransitions[from].includes(to);
}

/** Тип исполнения обмена. У наличных курс называет менеджер после подачи заявки. */
export const exchangeKinds = ['electronic', 'cash'] as const;
export const exchangeKindSchema = z.enum(exchangeKinds);
export type ExchangeKind = z.infer<typeof exchangeKindSchema>;

/** Состояния заявки на вывод бонусных баллов. */
export const withdrawalRequestStatuses = [
  'new', // новая
  'approved', // одобрена
  'paid', // выплачена
  'rejected', // отклонена
] as const;
export const withdrawalRequestStatusSchema = z.enum(withdrawalRequestStatuses);
export type WithdrawalRequestStatus = z.infer<typeof withdrawalRequestStatusSchema>;

/**
 * Допустимые переходы заявки на вывод. Отдельная таблица от заявки на
 * обмен: у них разные жизненные циклы, и объединять их значило бы
 * разрешить «оплата получена» там, где оплаты нет.
 *
 * Баллы списываются в «выплачена» — это состояние конечное, и вернуться
 * из него нельзя: возврат означал бы, что баллы появились обратно, а
 * деньги у клиента уже.
 */
export const withdrawalRequestTransitions: Record<
  WithdrawalRequestStatus,
  readonly WithdrawalRequestStatus[]
> = {
  new: ['approved', 'rejected'],
  approved: ['paid', 'rejected'],
  paid: [],
  rejected: [],
};

export function canTransitionWithdrawal(
  from: WithdrawalRequestStatus,
  to: WithdrawalRequestStatus,
): boolean {
  return withdrawalRequestTransitions[from].includes(to);
}

/** Заявка ещё в работе: из этого состояния куда-то ведёт переход. */
export function isWithdrawalOpen(status: WithdrawalRequestStatus): boolean {
  return withdrawalRequestTransitions[status].length > 0;
}

/** Способ выплаты бонусов. Исполняет менеджер вручную. */
export const withdrawalMethods = ['bank', 'crypto'] as const;
export const withdrawalMethodSchema = z.enum(withdrawalMethods);
export type WithdrawalMethod = z.infer<typeof withdrawalMethodSchema>;

/**
 * Сеть, в которой ждут перевод.
 *
 * Отдельно от адреса, потому что один и тот же адрес живёт в нескольких
 * сетях, а перевод в чужую — потерянные деньги без возврата. Спросить
 * сеть дешевле, чем выяснять её у клиента после отправки.
 *
 * Здесь только форма кода, а не список: сети живут справочником в базе,
 * и администратор гасит ту, в которой кошелёк временно недоступен.
 * Перечисление в коде было бы второй правдой о том, куда сервис умеет
 * отправлять, — и рано или поздно разошлось бы со справочником.
 */
export const networkCodeSchema = z.string().min(2).max(20);

/**
 * Способ, которым клиент получает деньги.
 *
 * Тип записи, а не набор необязательных полей: реквизит, по которому
 * нельзя отправить деньги, не должен существовать. Что обязательно
 * внутри каждого типа, проверяет база — форма всего лишь не даёт
 * составить неполную запись раньше неё.
 */
export const requisiteKinds = [
  'phone', // перевод по номеру телефона
  'card', // перевод на карту
  'wallet', // перевод на криптокошелёк
  'account', // перевод на тайский банковский счёт
  'promptpay', // Thai QR: PromptPay по QR из банка или кошелька
  'alipay', // Alipay по телефону или e-mail аккаунта
  'alipay_qr', // Alipay по QR приёма
] as const;
export const requisiteKindSchema = z.enum(requisiteKinds);
export type RequisiteKind = z.infer<typeof requisiteKindSchema>;

/**
 * Роды записи в валютах сервиса — рублях и USDT, тех, что он держит сам.
 *
 * По ним сервис принимает оплату (счета сервиса) и выплачивает баллы:
 * в батах и юанях он не принимает и баллов не платит, и роды этих валют
 * ни там, ни там не предлагаются.
 */
export const serviceCurrencyRequisiteKinds = ['phone', 'card', 'wallet'] as const;
export type ServiceCurrencyRequisiteKind = (typeof serviceCurrencyRequisiteKinds)[number];

export function isServiceCurrencyRequisiteKind(
  kind: RequisiteKind,
): kind is ServiceCurrencyRequisiteKind {
  return (serviceCurrencyRequisiteKinds as readonly RequisiteKind[]).includes(kind);
}

/**
 * Что внутри PromptPay-QR: к чему привязан получатель.
 *
 * Телефон и ID-карта ведут на банковский счёт, пятнадцатизначный номер —
 * на электронный кошелёк (TrueMoney и подобные). От этого зависит
 * способ выдачи, а с ним и сетка комиссии.
 */
export const promptPayIdTypes = ['phone', 'national_id', 'ewallet'] as const;
export const promptPayIdTypeSchema = z.enum(promptPayIdTypes);
export type PromptPayIdType = z.infer<typeof promptPayIdTypeSchema>;

/**
 * Какими родами записи валюта приходит клиенту.
 *
 * Таблица, а не правило по природе валюты: тайский счёт — фиатный, но
 * рубли на него не приходят, и «фиат — телефон или карта» с валютами
 * выдачи перестало быть правдой. У валюты, которой здесь нет, родов
 * нет вовсе: клиент видит «в разработке», и заявка не подаётся.
 *
 * Живёт в доменных типах рядом с родами: по ней ядро принимает запись к
 * заявке, а экран показывает подходящие записи и роды формы — своя
 * копия у экрана разошлась бы с ядром молча.
 */
const REQUISITE_KINDS_BY_CURRENCY: Readonly<Record<string, readonly RequisiteKind[]>> = {
  RUB: ['phone', 'card'],
  USDT: ['wallet'],
  THB: ['account', 'promptpay'],
  CNY: ['alipay', 'alipay_qr'],
};

export function requisiteKindsFor(currencyCode: string): readonly RequisiteKind[] {
  return REQUISITE_KINDS_BY_CURRENCY[currencyCode.toUpperCase()] ?? [];
}

/** Валюты, у которых есть роды записи: их и предлагает форма в профиле. */
export function requisiteCurrencyCodes(): readonly string[] {
  return Object.keys(REQUISITE_KINDS_BY_CURRENCY);
}

export function requisiteKindSuitsCurrency(kind: RequisiteKind, currencyCode: string): boolean {
  return requisiteKindsFor(currencyCode).includes(kind);
}

/**
 * Куда уходит выдача. От этого зависит ставка комиссии: перевод в
 * тайский банк стоит сервису не столько же, сколько перевод в кошелёк.
 *
 * Способов меньше, чем видов реквизита: перевод по телефону и на карту
 * для сервиса одно и то же — банковский перевод. Наличные стоят
 * третьим: у них своя ставка, а курс называет менеджер.
 */
export const payoutMethods = ['bank', 'wallet', 'cash'] as const;
export const payoutMethodSchema = z.enum(payoutMethods);
export type PayoutMethod = z.infer<typeof payoutMethodSchema>;

/**
 * Каким способом уйдут деньги по этой записи.
 *
 * Из записи, а не из одного рода: у PromptPay способ говорит тип
 * идентификатора внутри QR — телефон и ID-карта привязаны к банку,
 * кошелёк к кошельку. Тайский счёт — банк; оба Alipay — кошелёк.
 *
 * Правило живёт здесь, рядом с родами, а не в ядре: по нему же экран
 * выбирает сетку, чтобы показать клиенту ту цену, по которой заявка и
 * уйдёт.
 */
export function payoutMethodOf(record: {
  readonly kind: RequisiteKind;
  readonly promptpayIdType: PromptPayIdType | null;
}): PayoutMethod {
  switch (record.kind) {
    case 'wallet':
    case 'alipay':
    case 'alipay_qr':
      return 'wallet';
    case 'promptpay':
      return record.promptpayIdType === 'ewallet' ? 'wallet' : 'bank';
    case 'phone':
    case 'card':
    case 'account':
      return 'bank';
  }
}

/** Валюта бывает фиатной и криптовалютной: от этого зависит, куда её отправлять. */
export const currencyKinds = ['fiat', 'crypto'] as const;
export const currencyKindSchema = z.enum(currencyKinds);
export type CurrencyKind = z.infer<typeof currencyKindSchema>;

/**
 * Состояния заявки, которую уже начали вести и ещё не закрыли.
 *
 * Выводится из таблицы переходов: завершённое состояние — то, из
 * которого перейти некуда. Перечисли их руками — и новое состояние
 * молча попало бы в список работ, ничего при этом не сломав.
 *
 * Живёт здесь, а не в ядре: по этому же набору панель наполняет список
 * состояний в фильтре очереди, и вторая копия разошлась бы с выборкой —
 * фильтр предлагал бы состояние, которого в списке не бывает.
 */
export const inProgressExchangeStatuses = exchangeRequestStatuses.filter(
  (status) => status !== 'new' && exchangeRequestTransitions[status].length > 0,
);

/**
 * Подходит ли счёт сервиса валюте, в которой на него принимают.
 *
 * Рубли приходят на карту или по телефону, USDT — на кошелёк. Правило
 * по природе валюты, а не по таблице родов: счета сервиса заводятся
 * только в валютах сервиса, и новые роды — тайский счёт, PromptPay,
 * Alipay — сюда не проходят: в батах и юанях сервис не принимает. Записи
 * клиента подбираются по таблице (`requisiteKindSuitsCurrency`).
 */
export function serviceAccountKindSuits(kind: RequisiteKind, currency: CurrencyKind): boolean {
  if (!isServiceCurrencyRequisiteKind(kind)) return false;
  return currency === 'crypto' ? kind === 'wallet' : kind !== 'wallet';
}

/**
 * Проверки реквизита на правдоподобие.
 *
 * Не на подлинность: существует ли карта и чей это кошелёк, знает только
 * банк и сеть. Ловится другое — опечатка: переставленные цифры,
 * недобитый до конца адрес, номер телефона вместо номера карты. Этого
 * достаточно, потому что цена ошибки здесь — перевод, который не
 * возвращается.
 *
 * Правила живут в доменных типах, а не в форме: форма не единственный
 * способ создать запись, и отказывает всё равно операция. Экран
 * повторяет их, чтобы сказать об ошибке до сохранения, а не после.
 */

/**
 * Номер карты — по контрольной сумме Луна.
 *
 * Ею проверяются все платёжные карты, и одна переставленная пара цифр
 * её не проходит. Длина от тринадцати до девятнадцати — весь диапазон
 * стандарта, от старых Visa до Maestro.
 */
/**
 * Чем человек разделяет цифры, набирая номер: пробел, дефис, скобки,
 * плюс кода страны. Всё остальное в номере — не разделитель, а чужой
 * знак: «карта 4111…» и «+7 900…», вписанные в поле карты, проходили
 * проверку, потому что буквы просто отбрасывались вместе с пробелами.
 */
const NUMBER_NOISE = /^[\d\s()+.-]+$/;

export function looksLikeCardNumber(value: string): boolean {
  if (!NUMBER_NOISE.test(value)) return false;
  const digits = value.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;

  let sum = 0;
  let double = false;
  for (let at = digits.length - 1; at >= 0; at -= 1) {
    let digit = digits.charCodeAt(at) - 48;
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * Телефон — по числу цифр.
 *
 * Формат не проверяется: у сервиса клиенты в разных странах, и
 * российская маска отвергла бы тайский номер. Десять цифр — короткий
 * национальный номер, пятнадцать — потолок международного стандарта.
 */
export function looksLikePhone(value: string): boolean {
  if (!NUMBER_NOISE.test(value)) return false;
  const digits = value.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15;
}

/**
 * Форма адреса в известных сетях.
 *
 * Сеть, которой здесь нет, проверку проходит: справочник ведёт
 * администратор, и запрет на всё незнакомое означал бы, что заведённая
 * им сеть не работает, пока её не впишут в код.
 *
 * TRC20 — тридцать четыре знака base58 от буквы «T». TON — сорок восемь
 * знаков base64 в дружественном виде или «рабочая цепочка: шестьдесят
 * четыре шестнадцатеричных» в сыром. Оба алфавита base64 приняты:
 * кошельки отдают адрес и в url-безопасном виде, и в обычном — с «+» и
 * «/», — и отвергнутый нами настоящий адрес хуже пропущенной опечатки.
 *
 * Проверяется форма, но не контрольная сумма, которая есть у обеих
 * сетей: base58check у TRON, CRC16 у TON. Это отдельная работа — своя
 * реализация SHA-256 и base58 в браузерном пакете, — и она записана в
 * `backlog.md`.
 */
const WALLET_ADDRESS_FORMS: Readonly<Record<string, RegExp>> = {
  TRC20: /^T[1-9A-HJ-NP-Za-km-z]{33}$/,
  TON: /^(?:[A-Za-z0-9_+/-]{48}|-?\d+:[0-9a-fA-F]{64})$/,
};

export function looksLikeWalletAddress(network: string, address: string): boolean {
  const form = WALLET_ADDRESS_FORMS[network.toUpperCase()];
  return form ? form.test(address.trim()) : address.trim().length > 0;
}

/**
 * Номер тайского банковского счёта — по числу цифр.
 *
 * У большинства банков десять, у GSB и BAAC двенадцать; в приложении
 * банка номер напечатан с дефисами — «766-0-246658», — и разделители
 * снимаются. Контрольной суммы у тайского номера счёта не существует,
 * и ловится здесь только не то число цифр.
 */
export function looksLikeThaiAccountNumber(value: string): boolean {
  if (!NUMBER_NOISE.test(value)) return false;
  const digits = value.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 12;
}

/**
 * Имя получателя — как его показывает приложение получателя перед
 * отправкой: менеджер сверяет его глазами. Непустое, не длиннее строки,
 * которую можно сверить, и не кириллицей: тайский банк и Alipay пишут
 * имя латиницей — «ALEKSEI PLOTNIKOV», «IAKHIN RADMIR», — а клиент,
 * набравший его по-русски, сверить менеджеру ничего не даст. Тайское
 * и китайское письмо не запрещены: у местного получателя имя своё.
 */
export const MAX_HOLDER_NAME = 100;
const CYRILLIC = /[\u0400-\u04ff]/;

export function looksLikeHolderName(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_HOLDER_NAME && !CYRILLIC.test(trimmed);
}

/** Форма e-mail: что-то, «собака», домен с точкой. Опечатка, а не подделка. */
const EMAIL_FORM = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Аккаунт Alipay — телефон или e-mail: так в Alipay находят получателя.
 * Телефон — по нынешнему правилу для телефона, e-mail — по форме.
 */
export function looksLikeAlipayAccount(value: string): boolean {
  const trimmed = value.trim();
  return looksLikePhone(trimmed) || EMAIL_FORM.test(trimmed);
}

/**
 * Содержимое QR приёма Alipay — ссылка на домен Alipay.
 *
 * Регистр не важен: сканер часто отдаёт QR прописными. Домен проверяется
 * как хост, а не как подстрока: «alipay.com.example.net» — чужой.
 */
const ALIPAY_QR_FORM = /^https?:\/\/(?:[a-z0-9-]+\.)*alipay\.com\/\S+$/i;

export function looksLikeAlipayQr(value: string): boolean {
  return ALIPAY_QR_FORM.test(value.trim());
}

/**
 * Чем запись отвергается — словами, одними на операцию и на форму.
 *
 * Форма говорит их до сохранения, операция — отказом; живут они здесь,
 * потому что форма в браузере ядра не видит, а разойтись двум наборам
 * слов об одной ошибке нельзя: клиент читал бы два разных объяснения
 * одной опечатки.
 */
export const REQUISITE_COMPLAINTS = {
  phone: 'Телефон не похож на номер: в нём должно быть от 10 до 15 цифр',
  card: 'Номер карты не сходится по контрольной цифре — проверьте, не переставлены ли цифры',
  walletAddress: (network: string) =>
    `Адрес не похож на адрес сети ${network} — проверьте, целиком ли он скопирован`,
  thaiAccount: 'Номер счёта не похож на тайский: в нём от 10 до 12 цифр',
  holderName: 'Имя получателя — как в приложении получателя, латиницей и не длиннее ста знаков',
  alipayAccount: 'Аккаунт Alipay — это телефон или e-mail',
  alipayQr: 'Это не QR приёма Alipay: внутри должна быть ссылка на alipay.com',
  noQr: 'На картинке не нашлось QR. Выберите скриншот, где QR виден целиком и крупно',
} as const;

/**
 * Хвост идентификатора из QR — всё, что о нём видно без расшифровки.
 *
 * Три знака у PromptPay — столько же показывает сам кошелёк
 * («140-*********-614»); четыре — у кода в ссылке Alipay, без параметров
 * и закрывающей косой черты: они одну ссылку от другой не отличают.
 * Считается здесь, чтобы форма показала клиенту ровно тот хвост, под
 * которым запись потом встанет в список.
 */
export function promptPayHint(id: string): string {
  return `…${id.slice(-3)}`;
}

export function alipayQrHint(url: string): string {
  const code = url.trim().replace(/[?#].*$/, '').replace(/\/+$/, '');
  return `…${code.slice(-4)}`;
}

/**
 * Разбор PromptPay-QR — строки по стандарту EMVCo MPM.
 *
 * QR читается на устройстве клиента, и сюда приходит только строка.
 * Внутри — поля «тег, длина, значение»: индикатор формата, шаблон счёта
 * с идентификатором приложения PromptPay и одним идентификатором
 * получателя, валюта, страна, контрольная сумма. Проверяется ровно то,
 * что делает строку переводом на этого получателя: приложение —
 * PromptPay-перевод, а не оплата счёта; идентификатор — ровно один;
 * контрольная сумма сходится — иначе картинка прочитана не целиком;
 * поля суммы нет — QR с зашитой суммой отправит не то, что просили.
 *
 * Отказ — словами: их же показывает форма до сохранения и называет
 * операция при отказе, чтобы клиент выбрал другую картинку, а не
 * гадал, что не так.
 */
export type PromptPayParse =
  | { readonly ok: true; readonly idType: PromptPayIdType; readonly id: string }
  | { readonly ok: false; readonly complaint: string };

/** Идентификатор приложения PromptPay для перевода (credit transfer). */
const PROMPTPAY_TRANSFER_AID = 'A000000677010111';

/** Теги идентификатора получателя внутри шаблона счёта. */
const PROMPTPAY_ID_TAGS: Readonly<Record<string, PromptPayIdType>> = {
  '01': 'phone',
  '02': 'national_id',
  '03': 'ewallet',
};

const PROMPTPAY_NOT_QR = 'Это не QR для перевода: выберите картинку с PromptPay-QR';

/** Поля «тег, длина, значение» подряд; `null`, если строка не разбирается. */
function readTlv(payload: string): Map<string, string> | null {
  const fields = new Map<string, string>();
  let at = 0;
  while (at < payload.length) {
    const tag = payload.slice(at, at + 2);
    const length = Number(payload.slice(at + 2, at + 4));
    if (tag.length < 2 || !/^\d{2}$/.test(payload.slice(at + 2, at + 4))) return null;
    const value = payload.slice(at + 4, at + 4 + length);
    if (value.length !== length) return null;
    fields.set(tag, value);
    at += 4 + length;
  }
  return fields;
}

/**
 * CRC-16/CCITT-FALSE — контрольная сумма стандарта EMVCo: многочлен
 * 0x1021, начальное значение 0xFFFF, без отражения. Считается по байтам
 * UTF-8, а не по знакам строки: QR из банка несёт имя получателя, и
 * тайское имя в нём — три байта на знак.
 */
function crc16(value: string): string {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(value)) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export function parsePromptPay(payload: string): PromptPayParse {
  const value = payload.trim();
  const fields = readTlv(value);
  if (!fields || fields.get('00') !== '01') {
    return { ok: false, complaint: PROMPTPAY_NOT_QR };
  }

  // Контрольная сумма — последнее поле, и считается по всему, что перед
  // её значением, включая её собственные тег и длину.
  const crcAt = value.length - 8;
  if (crcAt < 0 || value.slice(crcAt, crcAt + 4) !== '6304') {
    return { ok: false, complaint: PROMPTPAY_NOT_QR };
  }
  if (crc16(value.slice(0, crcAt + 4)) !== value.slice(crcAt + 4).toUpperCase()) {
    return {
      ok: false,
      complaint: 'QR прочитан не целиком: контрольная сумма не сходится, выберите картинку почётче',
    };
  }

  // Шаблоны счетов живут в тегах 26–51, и их бывает несколько; PromptPay
  // узнаётся по идентификатору приложения в первом поле шаблона.
  const templates = [...fields.entries()]
    .filter(([tag]) => Number(tag) >= 26 && Number(tag) <= 51)
    .map(([, value]) => readTlv(value));
  if (templates.some((template) => template === null)) {
    return { ok: false, complaint: PROMPTPAY_NOT_QR };
  }
  const inner = templates.find((template) => template?.get('00') === PROMPTPAY_TRANSFER_AID);
  if (!inner) {
    return {
      ok: false,
      complaint: 'Это не PromptPay-перевод: нужен QR для перевода на счёт или кошелёк, а не для оплаты',
    };
  }

  const ids = [...inner.entries()].filter(([tag]) => tag in PROMPTPAY_ID_TAGS);
  if (ids.length !== 1) {
    return { ok: false, complaint: 'В QR не один получатель: выберите другую картинку' };
  }

  if (fields.has('54')) {
    return {
      ok: false,
      complaint: 'В этот QR зашита сумма — по нему уйдёт не та сумма, что в заявке. Нужен QR без суммы',
    };
  }

  const [tag, id] = ids[0]!;
  return { ok: true, idType: PROMPTPAY_ID_TAGS[tag]!, id };
}

/**
 * Состояния заявки на карту. Сервис карту не выпускает — статусы
 * отражают то, что сообщил внешний провайдер (см. docs/adr/0004).
 */
export const cardApplicationStatuses = [
  'submitted', // подана
  'processing', // в обработке
  'active', // активна
  'rejected', // отклонена провайдером
  'cancelled', // отозвана клиентом, пока провайдер за неё не взялся
] as const;
export const cardApplicationStatusSchema = z.enum(cardApplicationStatuses);
export type CardApplicationStatus = z.infer<typeof cardApplicationStatusSchema>;

/**
 * Допустимые переходы заявки на карту. Менеджер ведёт их по тому, что
 * сообщил провайдер: сервис карту не выпускает и сам ничего решить не
 * может.
 */
export const cardApplicationTransitions: Record<
  CardApplicationStatus,
  readonly CardApplicationStatus[]
> = {
  submitted: ['processing', 'rejected'],
  processing: ['active', 'rejected'],
  active: [],
  rejected: [],
  // Отзыв клиентом — не переход менеджера: сюда заявку уводит сам
  // клиент, и обратной дороги из этого состояния нет.
  cancelled: [],
};

export function canTransitionCardApplication(
  from: CardApplicationStatus,
  to: CardApplicationStatus,
): boolean {
  return cardApplicationTransitions[from].includes(to);
}

/** Заявка на карту ещё в работе: из этого состояния куда-то ведёт переход. */
export function isCardApplicationOpen(status: CardApplicationStatus): boolean {
  return cardApplicationTransitions[status].length > 0;
}

/**
 * Движение бонусных баллов. Баланс — сумма движений, поэтому списание
 * при выплате хранится отрицательной величиной: отдельного знака у
 * движения нет, иначе баланс пришлось бы считать по правилу «сложить
 * одни виды и вычесть другие», и это правило разошлось бы между местами.
 */
export const bonusTransactionKinds = [
  'accrual', // начисление за исполненную заявку реферала
  'withdrawal', // списание при выплате
  'adjustment', // ручная правка администратором
] as const;
export const bonusTransactionKindSchema = z.enum(bonusTransactionKinds);
export type BonusTransactionKind = z.infer<typeof bonusTransactionKindSchema>;

/** Линия реферальной сети. Глубже второй начисления не идут. */
export const referralLines = [1, 2] as const;
export const referralLineSchema = z.union([z.literal(1), z.literal(2)]);
export type ReferralLine = z.infer<typeof referralLineSchema>;

/**
 * Кто выполнил действие. Система ставит только начальные состояния;
 * клиент подаёт заявку на обмен и отменяет её, пока она новая; всё
 * остальное делает менеджер.
 */
export const actorTypes = ['system', 'client', 'manager'] as const;
export const actorTypeSchema = z.enum(actorTypes);
export type ActorType = z.infer<typeof actorTypeSchema>;

/** Роль сотрудника в админ-панели. */
export const staffRoles = ['manager', 'admin'] as const;
export const staffRoleSchema = z.enum(staffRoles);
export type StaffRole = z.infer<typeof staffRoleSchema>;

/** Валюта: код и число знаков после запятой для показа клиенту. */
export const currencySchema = z.object({
  code: z.string().min(2).max(12),
  decimals: z.number().int().min(0).max(18),
  kind: currencyKindSchema,
});
export type Currency = z.infer<typeof currencySchema>;
