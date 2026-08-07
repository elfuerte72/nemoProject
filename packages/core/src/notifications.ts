import type {
  Amount,
  CardApplicationStatus,
  ExchangeRequestStatus,
  ReferralLine,
  WithdrawalRequestStatus,
} from '@nemo/types';

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
      readonly preview: string;
    }
  | {
      /**
       * Ответ консьержа. Доставляет его тот же бот, которого клиент
       * запускал, — как и ответ менеджера.
       */
      readonly kind: 'concierge-message';
      readonly to: bigint;
      readonly body: string;
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
    }
  | { readonly kind: 'withdrawal'; readonly id: string; readonly amount: Amount }
  | { readonly kind: 'card'; readonly id: string };

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
  'manager-message',
  'concierge-message',
  'staff-client-message',
  'staff-escalation',
  'staff-new-request',
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
 * Текст сообщения для клиента.
 *
 * Живёт в модуле операций, а не в боте, потому что уведомления
 * отправляют оба приложения: клиентское — о регистрации реферала,
 * админка — о переходах заявки. Два набора формулировок разошлись бы.
 */
export function renderNotification(notification: Notification): string {
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
    case 'manager-message':
      // Текст менеджера уходит как есть: обрамление вроде «менеджер
      // пишет» превратило бы разговор в переписку с автоответчиком.
      return notification.body;
    case 'staff-client-message':
      return (
        `Новое обращение от клиента ${notification.clientUsername ?? notification.clientId}:\n` +
        notification.preview
      );
    case 'concierge-message':
      // Как и текст менеджера, уходит как есть: обрамление вроде
      // «помощник пишет» превратило бы разговор в автоответчик. Кто
      // отвечает, консьерж говорит сам — один раз, в начале разговора.
      return notification.body;
    case 'staff-new-request':
      return (
        `Новая ${renderNewRequestSubject(notification.request)}\n` +
        `Клиент: ${notification.clientUsername ?? notification.clientId}`
      );
    case 'staff-escalation':
      return (
        `Помощник передал разговор: ${notification.reason}.\n` +
        `Клиент ${notification.clientUsername ?? notification.clientId} пишет:\n` +
        notification.preview
      );
  }
}

/**
 * Чем заявка названа сотруднику.
 *
 * Суммой и сторонами, а не идентификатором: менеджер решает по этой
 * строке, бросать ли то, чем занят, и «заявка 8f3c…» на этот вопрос не
 * отвечает.
 */
function renderNewRequestSubject(request: NewRequestSubject): string {
  switch (request.kind) {
    case 'exchange':
      return (
        `заявка на обмен: ${request.fromAmount} ${request.fromCode} → ${request.toCode}` +
        (request.isCash ? ', наличными' : '')
      );
    case 'withdrawal':
      return `заявка на вывод ${request.amount} баллов`;
    case 'card':
      return 'заявка на карту';
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
