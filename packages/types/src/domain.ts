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

/** Имя получателя: у тайского счёта, PromptPay и Alipay. */
export const MAX_HOLDER_NAME = 100;

/**
 * Реквизит, как он приходит в запросе — из формы Mini App и из тела
 * запроса мерчанта по API.
 *
 * Разобран по способу получения, а не собран из необязательных полей:
 * сеть у карты должна отвергаться уже разбором запроса, а не доходить
 * до ограничения базы. Одна схема на оба пути, потому что путь через
 * API не должен быть слабее пути через форму — и не должен быть
 * другим.
 *
 * Номер карты, адрес, номер счёта и содержимое QR дальше в ответах не
 * появляются никогда; QR приходит строкой — картинку читают на
 * устройстве (docs/adr/0012).
 */
export const requisiteInputSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('phone'),
    bankName: z.string().min(1).max(100),
    phone: z.string().min(1).max(32),
  }),
  z.object({
    kind: z.literal('card'),
    bankName: z.string().min(1).max(100),
    cardNumber: z.string().min(1).max(40),
  }),
  z.object({
    kind: z.literal('wallet'),
    network: networkCodeSchema,
    address: z.string().min(1).max(120),
  }),
  z.object({
    kind: z.literal('account'),
    bankName: z.string().min(1).max(100),
    accountNumber: z.string().min(1).max(40),
    holderName: z.string().min(1).max(MAX_HOLDER_NAME),
  }),
  z.object({
    kind: z.literal('promptpay'),
    qr: z.string().min(1).max(1000),
    holderName: z.string().min(1).max(MAX_HOLDER_NAME),
  }),
  z.object({
    kind: z.literal('alipay'),
    account: z.string().min(1).max(120),
    holderName: z.string().min(1).max(MAX_HOLDER_NAME),
  }),
  z.object({
    kind: z.literal('alipay_qr'),
    qr: z.string().min(1).max(1000),
    holderName: z.string().min(1).max(MAX_HOLDER_NAME),
  }),
]);
export type RequisiteInput = z.infer<typeof requisiteInputSchema>;

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
 * Тип идентификатора словами — так запись узнаётся в списке клиента, в
 * журнале доступа и в карточке менеджера. Слова здесь, как и у курса
 * (`sayRate`): три копии в трёх приложениях разошлись бы первой правкой.
 */
export const PROMPTPAY_ID_LABELS: Record<PromptPayIdType, string> = {
  phone: 'телефон',
  national_id: 'ID-карта',
  ewallet: 'кошелёк',
};

/**
 * Способ получения денег — так, как его выбирают в форме. Не «тип
 * реквизита»: слово «реквизит» в форме означало бы, что человек уже
 * знает, чем они бывают. Одни слова на Mini App и кабинет мерчанта: у
 * панели менеджера подпись своя — там это не выбор, а описание.
 */
export const REQUISITE_KIND_LABELS: Record<RequisiteKind, string> = {
  phone: 'По номеру телефона',
  card: 'На карту',
  wallet: 'На криптокошелёк',
  account: 'На тайский банковский счёт',
  promptpay: 'Thai QR (PromptPay)',
  alipay: 'На Alipay по телефону или e-mail',
  alipay_qr: 'На Alipay по QR',
};

/**
 * Реквизиты одной строкой: банк и телефон, банк и последние цифры карты,
 * сеть и края адреса. По этой подписи запись узнают, не видя её целиком
 * — полное значение расшифровывает только панель менеджера
 * (docs/adr/0002).
 *
 * Здесь, а не в ядре: ядро тянет драйвер базы и в браузер не идёт, а
 * подпись читают и Mini App, и кабинет мерчанта, и журнал доступа в
 * ядре. Копии по приложениям расходились бы заметно: один реквизит
 * назывался бы по-разному.
 */
export function describeRequisites(view: {
  readonly kind: RequisiteKind;
  readonly bankName: string | null;
  readonly phone: string | null;
  readonly cardLast4: string | null;
  readonly network: string | null;
  readonly addressHint: string | null;
  readonly accountLast4: string | null;
  readonly qrHint: string | null;
  readonly promptpayIdType: PromptPayIdType | null;
  readonly alipayAccount: string | null;
}): string {
  switch (view.kind) {
    case 'phone':
      return [view.bankName, view.phone].filter(Boolean).join(' · ');
    case 'card':
      return [view.bankName, `карта •••• ${view.cardLast4 ?? ''}`.trim()]
        .filter(Boolean)
        .join(' · ');
    case 'wallet':
      return [view.network, view.addressHint].filter(Boolean).join(' · ');
    case 'account':
      return [view.bankName, `счёт •••• ${view.accountLast4 ?? ''}`.trim()]
        .filter(Boolean)
        .join(' · ');
    case 'promptpay':
      return [
        'PromptPay',
        `${PROMPTPAY_ID_LABELS[view.promptpayIdType ?? 'phone']} ${view.qrHint ?? ''}`.trim(),
      ].join(' · ');
    case 'alipay':
      return ['Alipay', view.alipayAccount].filter(Boolean).join(' · ');
    case 'alipay_qr':
      return ['Alipay', `QR ${view.qrHint ?? ''}`.trim()].join(' · ');
  }
}

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
  holderName: 'Имя получателя — как его показывает приложение получателя, не по-русски и не длиннее ста знаков',
  alipayAccount: 'Аккаунт Alipay — это телефон или e-mail',
  alipayQr: 'Это не QR приёма Alipay: внутри должна быть ссылка на alipay.com',
  noQr: 'QR на скриншоте не нашёлся. Выберите скриншот, где QR виден целиком и крупно',
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
 * Последние четыре цифры номера карты — всё, что от него видно после
 * записи: узнать свою карту в списке можно, восстановить номер — нет.
 * Разделители в номере не считаются.
 */
export function lastFour(cardNumber: string): string {
  const digits = cardNumber.replace(/\D/g, '');
  if (digits.length < 4) {
    throw new RangeError('В номере карты меньше четырёх цифр');
  }
  return digits.slice(-4);
}

/**
 * Края адреса кошелька — то же, что последние четыре цифры для карты.
 * Начало и конец, а не только хвост: адреса одной сети начинаются
 * одинаково, и по одному началу свой от чужого не отличить. Короткий
 * адрес остаётся целиком — прятать в нём нечего.
 *
 * Здесь, а не только в `@nemo/crypto`: хвосты считает и форма до
 * сохранения, показывая, под какой подписью запись встанет в список.
 */
export function addressEdges(address: string): string {
  const value = address.trim();
  if (value.length <= ADDRESS_EDGE * 2 + 1) {
    return value;
  }
  return `${value.slice(0, ADDRESS_EDGE)}…${value.slice(-ADDRESS_EDGE)}`;
}

const ADDRESS_EDGE = 4;

/** У каких способов нужно имя получателя: менеджер сверяет его перед отправкой. */
export function requisiteHolderRequired(kind: RequisiteKind): boolean {
  return kind === 'account' || kind === 'promptpay' || kind === 'alipay' || kind === 'alipay_qr';
}

/**
 * Черновик записи — то, что набрано в форме до сохранения. Способ
 * бывает ещё не выбран; поля чужих способов остаются в черновике и не
 * мешают: что отправлять, решает способ.
 */
export interface RequisiteDraft {
  readonly kind: RequisiteKind | undefined;
  readonly bankName?: string | undefined;
  readonly phone?: string | undefined;
  readonly cardNumber?: string | undefined;
  readonly network?: string | undefined;
  readonly address?: string | undefined;
  readonly accountNumber?: string | undefined;
  readonly holderName?: string | undefined;
  readonly alipayAccount?: string | undefined;
  /** Строка из QR — PromptPay или Alipay, уже прочитанная на устройстве. */
  readonly qr?: string | undefined;
}

export type RequisiteField = 'phone' | 'card' | 'address' | 'account' | 'alipay' | 'holder';

export interface RequisiteFieldComplaint {
  readonly field: RequisiteField;
  readonly complaint: string;
}

/**
 * Что не так с набранным — по тем же правилам, по которым откажет
 * операция, и теми же словами. Пустое поле замечания не получает:
 * незаполненное — ещё не ошибка, и кнопка о нём говорит тем, что не
 * горит. Порядок — порядок полей в форме: первое замечание и есть то,
 * что показывают под формой; остальные красят свои поля.
 *
 * Одно правило на форму Mini App и форму кабинета: каскад, набранный
 * дважды, разошёлся бы при первом новом способе.
 */
export function requisiteDraftComplaints(draft: RequisiteDraft): readonly RequisiteFieldComplaint[] {
  const { kind } = draft;
  if (kind === undefined) return [];
  const typed = (value: string | undefined): value is string => (value?.trim().length ?? 0) > 0;
  const found: RequisiteFieldComplaint[] = [];

  if (kind === 'phone' && typed(draft.phone) && !looksLikePhone(draft.phone)) {
    found.push({ field: 'phone', complaint: REQUISITE_COMPLAINTS.phone });
  }
  if (kind === 'card' && typed(draft.cardNumber) && !looksLikeCardNumber(draft.cardNumber)) {
    found.push({ field: 'card', complaint: REQUISITE_COMPLAINTS.card });
  }
  if (
    kind === 'wallet' &&
    typed(draft.address) &&
    !looksLikeWalletAddress(draft.network ?? '', draft.address)
  ) {
    found.push({ field: 'address', complaint: REQUISITE_COMPLAINTS.walletAddress(draft.network ?? '') });
  }
  if (
    kind === 'account' &&
    typed(draft.accountNumber) &&
    !looksLikeThaiAccountNumber(draft.accountNumber)
  ) {
    found.push({ field: 'account', complaint: REQUISITE_COMPLAINTS.thaiAccount });
  }
  if (kind === 'alipay' && typed(draft.alipayAccount) && !looksLikeAlipayAccount(draft.alipayAccount)) {
    found.push({ field: 'alipay', complaint: REQUISITE_COMPLAINTS.alipayAccount });
  }
  if (requisiteHolderRequired(kind) && typed(draft.holderName) && !looksLikeHolderName(draft.holderName)) {
    found.push({ field: 'holder', complaint: REQUISITE_COMPLAINTS.holderName });
  }
  return found;
}

/**
 * Что отправлять ядру — решает выбранный способ, а не то, что осталось
 * в полях. Пока заполнено не всё, что нужно способу, отправлять нечего:
 * записи, по которой нельзя отправить деньги, не существует.
 */
export function requisiteInputOf(draft: RequisiteDraft): RequisiteInput | undefined {
  const text = (value: string | undefined) => value?.trim() ?? '';
  const input = ((): RequisiteInput | undefined => {
    switch (draft.kind) {
      case 'phone':
        return { kind: 'phone', bankName: text(draft.bankName), phone: text(draft.phone) };
      case 'card':
        return { kind: 'card', bankName: text(draft.bankName), cardNumber: text(draft.cardNumber) };
      case 'wallet':
        return { kind: 'wallet', network: text(draft.network), address: text(draft.address) };
      case 'account':
        return {
          kind: 'account',
          bankName: text(draft.bankName),
          accountNumber: text(draft.accountNumber),
          holderName: text(draft.holderName),
        };
      case 'promptpay':
        return { kind: 'promptpay', qr: text(draft.qr), holderName: text(draft.holderName) };
      case 'alipay':
        return { kind: 'alipay', account: text(draft.alipayAccount), holderName: text(draft.holderName) };
      case 'alipay_qr':
        return { kind: 'alipay_qr', qr: text(draft.qr), holderName: text(draft.holderName) };
      case undefined:
        return undefined;
    }
  })();
  if (input === undefined) return undefined;
  const complete = Object.values(input).every((value) => String(value).length > 0);
  return complete ? input : undefined;
}

/** Что распозналось из картинки — подтверждается перед сохранением. */
export type QrReading =
  | {
      readonly ok: true;
      readonly kind: 'promptpay';
      readonly idType: PromptPayIdType;
      /** Хвост — тот же, под которым запись встанет в список. */
      readonly hint: string;
    }
  | { readonly ok: true; readonly kind: 'alipay_qr'; readonly hint: string }
  | { readonly ok: false; readonly complaint: string };

/**
 * Прочитанная из QR строка — на подтверждение: тип идентификатора и
 * хвост у PromptPay, хвост кода у Alipay. Картинка не та — форма
 * скажет об этом словами до сохранения, а не в переписке с менеджером.
 */
export function qrReadingOf(kind: RequisiteKind, payload: string): QrReading {
  if (kind === 'promptpay') {
    const parsed = parsePromptPay(payload);
    return parsed.ok
      ? { ok: true, kind, idType: parsed.idType, hint: promptPayHint(parsed.id) }
      : { ok: false, complaint: parsed.complaint };
  }
  if (kind === 'alipay_qr') {
    return looksLikeAlipayQr(payload)
      ? { ok: true, kind, hint: alipayQrHint(payload) }
      : { ok: false, complaint: REQUISITE_COMPLAINTS.alipayQr };
  }
  return { ok: false, complaint: REQUISITE_COMPLAINTS.noQr };
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

const PROMPTPAY_NOT_QR = 'Это не QR для перевода: выберите PromptPay-QR';

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
      complaint: 'QR прочитан не целиком: контрольная сумма не сходится, выберите QR почётче',
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
    return { ok: false, complaint: 'В QR не один получатель: выберите другой QR' };
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
 *
 * Мерчант стоит рядом с клиентом, а не вместо него: заявку он подаёт и
 * отменяет теми же переходами, но в истории должно остаться, кто это
 * был. Одно значение на обоих означало бы, что в разборе спорной сделки
 * «клиент отменил» может значить и «отменил кабинет мерчанта».
 */
export const actorTypes = ['system', 'client', 'merchant', 'manager'] as const;
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

/**
 * Состояния мерчанта — бизнеса, который пользуется сервисом как услугой
 * обмена и подаёт заявки от своего имени (docs/adr/0017).
 *
 * Анкета попадает администратору после подтверждения почты, и до его
 * решения мерчант ничего не может: одобрение открывает право создавать
 * обязательства сервиса по курсу — решение того же рода, что наценка.
 *
 * Отключённый — не отклонённый: ключи API перестают работать сразу, но
 * вход в кабинет остаётся, и открытые заявки доходят до конца. Иначе
 * отключение означало бы, что мерчант перестал видеть деньги, которые
 * уже отправил.
 */
export const merchantStatuses = [
  'pending', // анкета на рассмотрении
  'active', // одобрен
  'rejected', // отклонён с причиной
  'disabled', // отключён администратором
] as const;
export const merchantStatusSchema = z.enum(merchantStatuses);
export type MerchantStatus = z.infer<typeof merchantStatusSchema>;

/**
 * Почта мерчанта — по той же форме, что и аккаунт Alipay: что-то,
 * «собака», домен с точкой. Ловится опечатка, а не подделка: существует
 * ли ящик, знает только письмо с подтверждением, и оно же его и
 * проверяет.
 */
export function looksLikeEmail(value: string): boolean {
  return EMAIL_FORM.test(value.trim());
}

/**
 * Пароль мерчанта. Десять знаков — не оценка стойкости, а нижняя
 * граница, ниже которой перебор по словарю окупается: угнанный аккаунт
 * мерчанта означает подменённые реквизиты получателя, и платит по ним
 * сам мерчант.
 *
 * Состав знаков не требуется: правила вроде «заглавная и цифра» дают
 * «Password1» и ничего больше, а длину человек добирает словами.
 */
export const MIN_MERCHANT_PASSWORD = 10;

export function looksLikePassword(value: string): boolean {
  return value.length >= MIN_MERCHANT_PASSWORD;
}

/**
 * Сайт мерчанта — только `http` и `https`.
 *
 * Строку из анкеты панель рисует ссылкой, а анкету заводит кто угодно
 * снаружи: «javascript:» в этом поле означает клик сотрудника в
 * контексте панели, а строка без схемы («shop.ru») уводит по
 * относительному адресу внутрь неё же. Проверяется схема, а не
 * существование сайта: открыть его — работа администратора, читающего
 * анкету.
 */
export function looksLikeWebsite(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Чем анкета и вход мерчанта отвергаются — словами, одними на операцию
 * и на форму кабинета, по тому же правилу, что и `REQUISITE_COMPLAINTS`.
 */
export const MERCHANT_COMPLAINTS = {
  email: 'Почта не похожа на адрес: проверьте, нет ли опечатки',
  password: `Пароль короче ${MIN_MERCHANT_PASSWORD} знаков — возьмите фразу подлиннее`,
  credentials: 'Почта или пароль не подходят',
  emailTaken: 'На эту почту уже заведён аккаунт',
  site: 'Сайт — целиком, вместе с «https://»',
} as const;
