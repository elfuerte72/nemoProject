import {
  Money,
  capitalize,
  sayRate,
  type Amount,
  type CardApplicationStatus,
  type ExchangeRequestStatus,
  type ReferralLine,
  type RequisiteKind,
  type WithdrawalMethod,
  type WithdrawalRequestStatus,
} from '@nemo/types';
import type { InquiryTopic } from './inquiries.js';
import { ATTACHMENT_DOWNLOAD_LIMIT_BYTES, formatFileSize } from './attachments.js';

/**
 * Что нужно сообщить клиенту — следствие операции, а не отдельное
 * действие.
 *
 * Операция возвращает описание сообщения, адаптер его отправляет. Так
 * уведомление нельзя забыть, добавив новый переход: тест видит его в
 * результате операции, не поднимая Telegram. Обратный порядок — «после
 * смены статуса не забыть позвать бота» — держится только на памяти
 * того, кто пишет следующий переход.
 */
export type Notification =
  | {
      readonly kind: 'referral-joined';
      readonly to: bigint;
      readonly line: ReferralLine;
    }
  | {
      readonly kind: 'exchange-request-status';
      readonly to: bigint;
      readonly requestId: string;
      readonly status: ExchangeRequestStatus;
      /** Курс, названный менеджером: только в переходе «курс подтверждён». */
      readonly finalRate?: Amount;
      /** Куда клиенту платить: только в переходе «курс подтверждён». */
      readonly paymentInstructions?: string;
      /**
       * Сколько минут у клиента на оплату. Идёт вместе с реквизитами:
       * узнать о сроке из предупреждения за полчаса до конца — значит
       * узнать о нём слишком поздно.
       */
      readonly payWithinMinutes?: number;
      /** Причина отмены: обязательна, когда отменяет менеджер. */
      readonly cancelReason?: string;
    }
  | {
      /**
       * Срок оплаты подходит к концу. Отдельный вид, а не состояние
       * заявки: состояние её при этом не меняется — меняется только то,
       * сколько у клиента осталось времени.
       */
      readonly kind: 'exchange-request-expiring';
      readonly to: bigint;
      readonly requestId: string;
      readonly minutesLeft: number;
    }
  | {
      readonly kind: 'bonus-accrued';
      readonly to: bigint;
      readonly line: ReferralLine;
      readonly amount: Amount;
    }
  | {
      readonly kind: 'withdrawal-request-status';
      readonly to: bigint;
      readonly status: WithdrawalRequestStatus;
      readonly amount: Amount;
      /** Причина отказа: обязательна при отклонении. */
      readonly rejectReason?: string;
    }
  | {
      readonly kind: 'card-application-status';
      readonly to: bigint;
      readonly status: CardApplicationStatus;
    }
  | {
      /** Подтверждение приёма — однажды на череду сообщений клиента. */
      readonly kind: 'client-message-received';
      readonly to: bigint;
    }
  | {
      /**
       * Файл сверх предела Telegram: боту такой не скачать, и клиенту это
       * говорится сразу — не менеджером через час, когда чек уже нужен.
       */
      readonly kind: 'client-attachment-too-large';
      readonly to: bigint;
    }
  | {
      /** Ответ менеджера. Доставляет его бот, которого клиент запускал. */
      readonly kind: 'manager-message';
      readonly to: bigint;
      readonly body: string;
    }
  | {
      /**
       * Новое обращение — сотруднику. Уходит от бота входа в админку:
       * он уже запущен у каждого, иначе тот не смог бы войти
       * (docs/adr/0005).
       */
      readonly kind: 'staff-client-message';
      readonly to: bigint;
      readonly clientId: bigint;
      readonly clientUsername: string | null;
      /** Просьба из раздела «За границей» — про деньги, и заголовок говорит это первым. */
      readonly topic: InquiryTopic | null;
      readonly preview: string;
      /** Вложение словами, своей строкой, когда у него есть подпись: «вот чек» без имени файла не говорит, что чек пришёл. */
      readonly attachment?: string | undefined;
    }
  | {
      /**
       * Ответ консьержа. Доставляет его тот же бот, которого клиент
       * запускал, — как и ответ менеджера.
       */
      readonly kind: 'concierge-message';
      readonly to: bigint;
      readonly body: string;
      /**
       * Картинка-подсказка «где нажать»: путь в `public/` клиентского
       * приложения. Полный адрес собирает доставка — ядро не знает, на
       * каком домене живёт приложение. Не дошла картинка — уходит один
       * текст: подпись написана так, что работает и без снимка.
       */
      readonly photoPath?: string;
    }
  | {
      /**
       * Консьерж позвал человека — сотруднику, с причиной.
       *
       * Отдельно от обычного обращения: разница в том, что менеджер
       * читает первым. «Клиент говорит, что деньги не дошли» отвечает на
       * вопрос «что случилось» до того, как он откроет переписку, а
       * очередь у него общая.
       */
      readonly kind: 'staff-escalation';
      readonly to: bigint;
      readonly clientId: bigint;
      readonly clientUsername: string | null;
      readonly reason: string;
      readonly preview: string;
      /** Вложение словами, своей строкой, когда у него есть подпись: «вот чек» без имени файла не говорит, что чек пришёл. */
      readonly attachment?: string | undefined;
    }
  | {
      /**
       * Заявку так и не взяли — сотруднику, однажды.
       *
       * Отдельно от «новой»: у той повод — появление, а здесь — что о
       * ней забыли. Смена сменилась, сообщение прокрутилось в чате,
       * менеджер решил «возьму через минуту» — заметит это клиент, если
       * не напомнить.
       */
      readonly kind: 'staff-stale-request';
      readonly to: bigint;
      readonly clientId: bigint;
      readonly clientUsername: string | null;
      readonly request: NewRequestSubject;
      /** Сколько она уже ждёт. Без этого напоминание не отличить от нового. */
      readonly waitingMinutes: number;
    }
  | {
      /** Клиент ждёт ответа дольше положенного — сотруднику, однажды. */
      readonly kind: 'staff-waiting-client';
      readonly to: bigint;
      readonly clientId: bigint;
      readonly clientUsername: string | null;
      readonly preview: string;
      /** Вложение словами, своей строкой, когда у него есть подпись: «вот чек» без имени файла не говорит, что чек пришёл. */
      readonly attachment?: string | undefined;
      readonly waitingMinutes: number;
    }
  | {
      /**
       * Новая заявка — сотруднику. Тем же путём, что и обращение: бот
       * входа, отметка в строке, планировщик.
       *
       * Заявка описана данными, а не готовой строкой: текст уведомления
       * живёт в `renderNotification` рядом с остальными, иначе
       * формулировка про заявку разошлась бы с формулировкой про
       * обращение при первой же правке тона.
       */
      readonly kind: 'staff-new-request';
      readonly to: bigint;
      readonly clientId: bigint;
      readonly clientUsername: string | null;
      readonly request: NewRequestSubject;
    };

/**
 * О какой заявке речь. Три вида, и различаются они не только именем:
 * у обмена называются суммы и стороны, у вывода — сумма баллов, у карты
 * не называется ничего, потому что называть нечего.
 */
export type NewRequestSubject =
  | {
      readonly kind: 'exchange';
      readonly id: string;
      readonly fromAmount: Amount;
      readonly fromCode: string;
      readonly toCode: string;
      /** Наличная заявка: у неё нет курса подачи, и это видно менеджеру сразу. */
      readonly isCash: boolean;
      /**
       * Сумма к выдаче и курс подачи — обязательство сервиса, и менеджер
       * читает их в уведомлении теми же числами, что в карточке. Пусто у
       * наличной: там и то и другое называет менеджер.
       */
      readonly toAmount: Amount | null;
      readonly rate: Amount | null;
      /** Куда клиент получит деньги; пусто, если запись не выбрана. */
      readonly payout: PayoutHint | null;
    }
  | {
      readonly kind: 'withdrawal';
      readonly id: string;
      readonly amount: Amount;
      readonly method: WithdrawalMethod;
      readonly payout: PayoutHint | null;
    }
  | { readonly kind: 'card'; readonly id: string };

/**
 * Запись клиента одним взглядом: вид и банк или сеть — без номера.
 * Номер в уведомление не идёт: оно живёт в чате телефона годами, а
 * реквизиты открываются в панели и с записью в журнал доступа.
 */
export interface PayoutHint {
  readonly kind: RequisiteKind;
  readonly bankName: string | null;
  readonly network: string | null;
}

/**
 * Все виды уведомлений списком.
 *
 * Нужен там, где виды перебирают, — прежде всего в проверке на машинный
 * набор: она идёт по каждому, а перечислены они были руками, и заведённый
 * следом вид проходил бы мимо правила молча. Теперь не пройдёт: список
 * обязан сойтись с типом, и следит за этим строка под ним.
 */
export const notificationKinds = [
  'referral-joined',
  'exchange-request-status',
  'exchange-request-expiring',
  'bonus-accrued',
  'withdrawal-request-status',
  'card-application-status',
  'client-message-received',
  'client-attachment-too-large',
  'manager-message',
  'concierge-message',
  'staff-client-message',
  'staff-escalation',
  'staff-new-request',
  'staff-stale-request',
  'staff-waiting-client',
] as const satisfies readonly Notification['kind'][];

/**
 * Вид, заведённый в типе и забытый в списке. Пока такой есть, тип ниже
 * не сходится и сборка не проходит: список, отставший от типа, — это
 * ровно то молчание, ради которого он и заведён.
 */
type UnlistedKind = Exclude<Notification['kind'], (typeof notificationKinds)[number]>;
type AssertNone<T extends never> = T;
export type EveryKindListed = AssertNone<UnlistedKind>;

/**
 * Сообщение, готовое к отправке: текст и разметка, в которой он набран.
 *
 * Клиенту текст уходит голым: выделять в нём нечего, а слова
 * менеджера со знаком «меньше» под разметкой Telegram не принял бы
 * вовсе. Сотруднику — размеченным: заголовок, ссылка на клиента, его
 * слова цитатой, и всё чужое в нём экранировано здесь же. Разметка
 * объявлена рядом с текстом, а не выбирается отправителем по виду:
 * два места, решающие одно и то же, разошлись бы на первом же новом
 * виде, и он ушёл бы с тегами в голом тексте.
 */
export interface RenderedNotification {
  readonly text: string;
  readonly parseMode?: 'HTML';
}

type StaffNotification = Extract<Notification, { kind: `staff-${string}` }>;

/** Чем подписан ответ сотрудника в чате бота. Одна строка на всех: клиент узнаёт её. */
export const OPERATOR_PREFIX = '[Оператор]: ';

/**
 * Текст сообщения.
 *
 * Живёт в модуле операций, а не в боте, потому что уведомления
 * отправляют оба приложения: клиентское — о регистрации реферала,
 * админка — о переходах заявки. Два набора формулировок разошлись бы.
 */
export function renderNotification(notification: Notification): RenderedNotification {
  switch (notification.kind) {
    case 'staff-client-message':
    case 'staff-escalation':
    case 'staff-new-request':
    case 'staff-stale-request':
    case 'staff-waiting-client':
      return { text: renderStaffNotification(notification), parseMode: 'HTML' };
    default:
      return { text: renderClientNotification(notification) };
  }
}

function renderClientNotification(
  notification: Exclude<Notification, StaffNotification>,
): string {
  switch (notification.kind) {
    case 'referral-joined':
      return notification.line === 1
        ? 'По вашей ссылке зарегистрировался новый клиент. ' +
            'Баллы начислятся, когда он совершит обмен.'
        : 'У вас новый реферал во второй линии: ваш реферал привёл знакомого.';
    case 'exchange-request-status':
      return renderExchangeRequestStatus(notification);
    case 'exchange-request-expiring':
      return (
        `Заявка на обмен ждёт оплаты ещё ${notification.minutesLeft} мин. ` +
        'Курс держится до конца этого срока. Неоплаченную заявку сервис отменит, ' +
        'и подать её можно будет заново, уже по новому курсу.'
      );
    case 'bonus-accrued':
      return (
        `Вам начислено ${notification.amount} баллов за исполненную заявку ` +
        `реферала ${notification.line === 1 ? 'первой' : 'второй'} линии.`
      );
    case 'withdrawal-request-status':
      return renderWithdrawalRequestStatus(notification);
    case 'card-application-status':
      return renderCardApplicationStatus(notification.status);
    case 'client-message-received':
      return (
        'Вопрос принят, менеджер ответит здесь же. ' +
        'Можно закрыть приложение: ответ придёт в этот чат.'
      );
    case 'client-attachment-too-large':
      return (
        `Файл больше ${formatFileSize(ATTACHMENT_DOWNLOAD_LIMIT_BYTES)}, и Telegram не даёт боту его скачать. ` +
        'Пришлите его сжатым или снимком экрана.'
      );
    case 'manager-message':
      // Текст менеджера уходит как есть, но за подписью: в одном чате
      // с клиентом говорят бот, помощник и человек, и ответ человека
      // без подписи читался как ещё одно сообщение автомата. Подпись —
      // часть доставки, а не текста: в базе и в панели её нет, там
      // автора называет имя сотрудника.
      return `${OPERATOR_PREFIX}${notification.body}`;
    case 'concierge-message':
      // Как и текст менеджера, уходит как есть: обрамление вроде
      // «помощник пишет» превратило бы разговор в автоответчик. Кто
      // отвечает, консьерж говорит сам — один раз, в начале разговора.
      return notification.body;
  }
}

/**
 * Сотруднику — что случилось, с чем, с кем и о чём это.
 *
 * Заголовок жирным: читается с телефона между двумя делами, и решение
 * «бросать ли то, чем занят» принимается по одной строке. Под ним то,
 * по чему решают: у обмена обе суммы, курс и куда клиент получит
 * деньги — те же числа, что в карточке; до 4 сентября 2026 уходила одна
 * сумма и пара кодов, и за остальным шли в панель. Клиент — ссылкой по
 * нику: аккаунт по числу Telegram не открывает; число рядом, потому что
 * ник меняется, а панель ищет клиента по числу. Слова клиента —
 * цитатой, чтобы не читались как слова сервиса. Последней строкой —
 * тема хэштегом: в чате с сотнями уведомлений по нему находят все
 * заявки на вывод или все просьбы об оплате одним нажатием.
 */
function renderStaffNotification(notification: StaffNotification): string {
  switch (notification.kind) {
    case 'staff-client-message':
      return lines(
        bold(
          notification.topic === null
            ? 'Новое обращение'
            : `Просьба оплатить ${INQUIRY_WORDS[notification.topic]}`,
        ),
        clientLine(notification),
        quote(notification.preview),
        attachmentLine(notification.attachment),
        tags(notification.topic === null ? 'поддержка' : 'оплата'),
      );
    case 'staff-escalation':
      // Причина в заголовке: «клиент говорит, что деньги не дошли»
      // отвечает на вопрос «что случилось» раньше самих слов клиента.
      return lines(
        bold(capitalize(escapeHtml(notification.reason))),
        clientLine(notification),
        quote(notification.preview),
        attachmentLine(notification.attachment),
        tags('поддержка'),
      );
    case 'staff-new-request':
      return lines(
        bold(`Новая ${requestTitle(notification.request)}`),
        ...requestDetails(notification.request),
        clientLine(notification),
        tags(requestTag(notification.request)),
      );
    case 'staff-stale-request':
      return lines(
        bold(`Заявку никто не взял ${renderWaiting(notification.waitingMinutes)}`),
        requestLine(notification.request),
        clientLine(notification),
        tags(requestTag(notification.request), 'напоминание'),
      );
    case 'staff-waiting-client':
      return lines(
        bold(`Клиент ждёт ответа ${renderWaiting(notification.waitingMinutes)}`),
        clientLine(notification),
        quote(notification.preview),
        attachmentLine(notification.attachment),
        tags('поддержка', 'напоминание'),
      );
  }
}

/** Строки сообщения; `null` — строки нет, и пустой она не остаётся. */
function lines(...parts: readonly (string | null)[]): string {
  return parts.filter((part): part is string => part !== null).join('\n');
}

function bold(text: string): string {
  return `<b>${text}</b>`;
}

function quote(text: string): string {
  return `<blockquote>${escapeHtml(text)}</blockquote>`;
}

/** Вложение — после слов клиента и вне цитаты: это описание, а не его слова. */
function attachmentLine(attachment: string | undefined): string | null {
  return attachment === undefined ? null : `Вложение: ${escapeHtml(attachment)}`;
}

/** Тема хэштегами — Telegram делает их ссылками, и по ним ищут. */
function tags(...names: readonly string[]): string {
  return names.map((name) => `#${name}`).join(' ');
}

function clientLine(client: {
  readonly clientId: bigint;
  readonly clientUsername: string | null;
}): string {
  const id = `ID ${client.clientId}`;
  if (client.clientUsername === null) return id;
  const username = escapeHtml(client.clientUsername);
  return `<a href="https://t.me/${username}">@${username}</a> · ${id}`;
}

/**
 * Разметку сообщения сервис ставит свою, а ник, слова клиента, коды
 * валют, банк и причина эскалации приходят извне: знак «меньше» в любом
 * из них Telegram прочитал бы как начало тега и отверг бы сообщение
 * целиком.
 */
export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Число для человека: разряды через неразрывный пробел, дробная часть
 * через запятую и без хвоста нулей. «10000 USDT» в уведомлении читалось
 * как «1000» — ошибка в порядке величины там, где по числу решают.
 */
export function humanAmount(value: Amount): string {
  const [whole = '0', fraction = ''] = String(value).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
  const tail = fraction.replace(/0+$/, '');
  return tail === '' ? grouped : `${grouped},${tail}`;
}

/**
 * Сколько ждут, словами.
 *
 * В часах, когда их больше одного: «ждёт 214 минут» менеджер переводит в
 * уме, а решение принимает по порядку величины.
 */
function renderWaiting(minutes: number): string {
  if (minutes < 120) return `${minutes} мин`;
  return `больше ${Math.floor(minutes / 60)} ч`;
}

const INQUIRY_WORDS: Readonly<Record<InquiryTopic, string>> = {
  hotel: 'отель',
  purchase: 'покупку',
};

/** Вид записи словами — так, как запись названа клиенту в приложении. */
const PAYOUT_WORDS: Readonly<Record<RequisiteKind, string>> = {
  phone: 'телефон',
  card: 'карта',
  wallet: 'кошелёк',
  account: 'счёт',
  promptpay: 'PromptPay',
  alipay: 'Alipay',
  alipay_qr: 'Alipay QR',
};

const METHOD_WORDS: Readonly<Record<WithdrawalMethod, string>> = {
  bank: 'банковский перевод',
  crypto: 'криптовалюта',
};

/** Куда придут деньги: вид записи и банк или сеть, без номера. */
function payoutWords(payout: PayoutHint): string {
  const where = payout.bankName ?? payout.network;
  return where === null ? PAYOUT_WORDS[payout.kind] : `${PAYOUT_WORDS[payout.kind]} · ${escapeHtml(where)}`;
}

/**
 * Чем заявка названа сотруднику.
 *
 * Суммой и сторонами, а не идентификатором: менеджер решает по этой
 * строке, бросать ли то, чем занят, и «заявка 8f3c…» на этот вопрос не
 * отвечает.
 */
function requestTitle(request: NewRequestSubject): string {
  switch (request.kind) {
    case 'exchange':
      return 'заявка на обмен';
    case 'withdrawal':
      return 'заявка на вывод баллов';
    case 'card':
      return 'заявка на карту';
  }
}

function requestTag(request: NewRequestSubject): string {
  switch (request.kind) {
    case 'exchange':
      return 'обмен';
    case 'withdrawal':
      return 'вывод';
    case 'card':
      return 'карта';
  }
}

/** Суммы и стороны одной строкой: то, чем заявка отличается от других таких же. */
function requestSum(request: NewRequestSubject): string | null {
  switch (request.kind) {
    case 'exchange': {
      const to =
        request.toAmount === null
          ? escapeHtml(request.toCode)
          : `${humanAmount(request.toAmount)} ${escapeHtml(request.toCode)}`;
      return (
        `${humanAmount(request.fromAmount)} ${escapeHtml(request.fromCode)} → ${to}` +
        (request.isCash ? ' наличными' : '')
      );
    }
    case 'withdrawal':
      return `${humanAmount(request.amount)} баллов`;
    case 'card':
      return null;
  }
}

/**
 * Строки о заявке под заголовком: суммы, затем курс и способ сделки,
 * затем куда придут деньги. У карты сказать нечего.
 */
function requestDetails(request: NewRequestSubject): readonly (string | null)[] {
  switch (request.kind) {
    case 'exchange':
      return [
        requestSum(request),
        request.rate === null
          ? 'Курс назовёт менеджер'
          : `Курс ${sayRate(request.rate, request.fromCode, request.toCode, humanAmount)} · ${
              request.isCash ? 'наличные' : 'перевод'
            }`,
        request.payout === null ? null : `Получение: ${payoutWords(request.payout)}`,
      ];
    case 'withdrawal':
      return [
        requestSum(request),
        `Выплата: ${request.payout === null ? METHOD_WORDS[request.method] : payoutWords(request.payout)}`,
      ];
    case 'card':
      return [];
  }
}

/** Заявка одной строкой — там, где заголовок занят другим. */
function requestLine(request: NewRequestSubject): string {
  const sum = requestSum(request);
  switch (request.kind) {
    case 'exchange':
      return `Обмен: ${sum}`;
    case 'withdrawal':
      return `Вывод баллов: ${sum}`;
    case 'card':
      return 'Заявка на карту';
  }
}

function renderExchangeRequestStatus(
  notification: Extract<Notification, { kind: 'exchange-request-status' }>,
): string {
  switch (notification.status) {
    case 'new':
      return 'Заявка на обмен принята. Её возьмёт менеджер, и вы получите сообщение.';
    case 'in_progress':
      return 'Менеджер взял вашу заявку на обмен в работу и скоро пришлёт реквизиты для оплаты.';
    case 'rate_confirmed':
      return [
        notification.finalRate
          ? `Курс по вашей заявке на обмен: ${notification.finalRate}.`
          : undefined,
        notification.paymentInstructions
          ? `Реквизиты для оплаты: ${notification.paymentInstructions}`
          : undefined,
        notification.payWithinMinutes
          ? `Оплатите в течение ${notification.payWithinMinutes} мин: столько держится курс. ` +
            'Неоплаченную заявку сервис отменит.'
          : undefined,
        'После оплаты менеджер подтвердит поступление.',
      ]
        .filter((line) => line !== undefined)
        .join('\n');
    case 'payment_received':
      return 'Ваша оплата получена. Готовим отправку средств.';
    case 'completed':
      return 'Обмен исполнен, средства отправлены. Проверьте поступление и напишите сюда, если что-то не сошлось.';
    case 'cancelled':
      return notification.cancelReason
        ? `Заявка на обмен отменена. Причина: ${notification.cancelReason}`
        : 'Заявка на обмен отменена.';
  }
}

function renderWithdrawalRequestStatus(
  notification: Extract<Notification, { kind: 'withdrawal-request-status' }>,
): string {
  switch (notification.status) {
    case 'new':
      return `Заявка на вывод ${notification.amount} баллов принята. Менеджер её рассмотрит.`;
    case 'approved':
      return `Заявка на вывод ${notification.amount} баллов одобрена. Готовим выплату.`;
    case 'paid':
      return `Выплата ${notification.amount} баллов отправлена. Баллы списаны с бонусного баланса.`;
    case 'rejected':
      // Причина обязательна при отклонении, но тип уведомления допускает
      // её отсутствие: язык не даёт выразить «обязательна только здесь».
      return notification.rejectReason
        ? `Заявка на вывод отклонена. Причина: ${notification.rejectReason}`
        : 'Заявка на вывод отклонена.';
  }
}

function renderCardApplicationStatus(status: CardApplicationStatus): string {
  switch (status) {
    case 'submitted':
      return 'Заявка на карту принята. Мы сообщим, когда она сдвинется.';
    case 'cancelled':
      return 'Заявка на карту отозвана. Подать новую можно в любой момент.';
    case 'processing':
      return 'Заявка на карту в обработке у провайдера.';
    case 'active':
      return 'Карта выпущена и активна. Менеджер свяжется с вами по получению.';
    case 'rejected':
      return 'Заявка на карту отклонена. Менеджер расскажет подробности.';
  }
}
