import type { Notification } from './notifications.js';

/**
 * Письма мерчанту — тексты, которыми сервис говорит с бизнесом.
 *
 * В коде и рядом с текстами бота (`bot-texts.ts`), а не в справочнике с
 * правкой из панели: их полтора десятка, меняются они вместе с тоном
 * всего сервиса и проходят то же ревью и ту же проверку на машинный
 * набор (`bot-slop.ts`).
 *
 * Голым текстом, без вёрстки: письмо читают и в почтовом клиенте, и в
 * веб-интерфейсе, и на телефоне, а вёрстка письма — отдельная работа,
 * которая ничего не добавляет к трём строкам и ссылке.
 *
 * Реквизитов для оплаты здесь нет ни в одном письме, и это правило, а
 * не пропуск: почтовый ящик мерчанта сервису не принадлежит, а перевод
 * по подменённым реквизитам не возвращается. Письмо зовёт в кабинет,
 * где реквизиты показаны за паролем.
 *
 * Ссылки собирает доставка: адрес кабинета и ник поддержки — свойства
 * развёртывания, ядро их не знает. В тексте стоит место под ссылку,
 * потому что порядок слов вокруг неё — часть текста, и решать его
 * отправителю нельзя.
 */

/** Письмо: тема в строке списка и текст под ней. */
export interface MerchantMail {
  readonly subject: string;
  readonly text: string;
}

/** Место, куда доставка подставит одноразовую ссылку из письма. */
export const MERCHANT_LINK_PLACEHOLDER = '{{ссылка}}';

/** Уведомления об аккаунте: они и есть письмо, другого адресата у них нет. */
export type MerchantAccountNotification = Extract<
  Notification,
  { kind: `merchant-${string}` }
>;

/**
 * Письмо по уведомлению — или `null`, если оно не мерчанту.
 *
 * Решает адресат, а не вид: заявка на обмен бывает и клиентской, и
 * мерчантской, а слова у них разные — клиенту реквизиты уходят в чат,
 * мерчанта письмо зовёт в кабинет.
 */
export function renderMerchantMail(notification: Notification): MerchantMail | null {
  switch (notification.kind) {
    case 'merchant-email-verification':
    case 'merchant-password-reset':
    case 'merchant-application-decided':
    case 'merchant-api-key-issued':
    case 'merchant-api-key-revoked':
    case 'merchant-webhook-failing':
      return merchantAccountMail(notification);
    case 'exchange-request-status':
      return notification.to.kind === 'merchant' ? exchangeMail(notification) : null;
    case 'exchange-request-expiring':
      return notification.to.kind === 'merchant'
        ? {
            subject: 'Срок оплаты заявки истекает',
            text:
              `Заявка ждёт оплаты ещё ${notification.minutesLeft} мин: столько ` +
              'держится курс. Неоплаченную заявку сервис отменит, и подать её ' +
              'можно будет заново, уже по новому курсу.',
          }
        : null;
    default:
      return null;
  }
}

/** Письма об аккаунте: подтверждение адреса, сброс пароля, решение по анкете. */
export function merchantAccountMail(
  notification: MerchantAccountNotification,
): MerchantMail {
  switch (notification.kind) {
    case 'merchant-email-verification':
      return {
        subject: 'Подтвердите почту',
        text:
          'Вы завели кабинет мерчанта Tobee. Подтвердите адрес, и анкета ' +
          'уйдёт на рассмотрение:\n' +
          `${MERCHANT_LINK_PLACEHOLDER}\n` +
          'Ссылка работает сутки. Если кабинет заводили не вы, письмо можно ' +
          'выбросить: без подтверждения анкета никуда не пойдёт.',
      };
    case 'merchant-password-reset':
      return {
        subject: 'Смена пароля',
        text:
          'Кто-то попросил сменить пароль от кабинета мерчанта Tobee. Если ' +
          'это были вы, задайте новый:\n' +
          `${MERCHANT_LINK_PLACEHOLDER}\n` +
          'Ссылка работает час. Если не вы — ничего делать не нужно, старый ' +
          'пароль остаётся в силе.',
      };
    case 'merchant-application-decided':
      return notification.rejectionReason === undefined
        ? {
            subject: 'Анкета одобрена',
            text:
              'Анкета одобрена: кабинет открыт, ключи API выпускаются в ' +
              'разделе «API». Курс, минимальную сумму и срок оплаты ' +
              'смотрите в разделе «Курсы».',
          }
        : {
            subject: 'Анкета отклонена',
            text:
              `Анкета отклонена. Причина: ${notification.rejectionReason}\n` +
              'Написать по этому поводу можно в поддержку — ссылка есть в ' +
              'кабинете.',
          };
    /*
     * Самого ключа в письмах нет: он показан один раз в кабинете, и
     * почтовый ящик — не место для него. Письмо нужно тому, кто ключ
     * не выпускал: это повод отозвать его и сменить пароль.
     */
    case 'merchant-api-key-issued':
      return {
        subject: 'Выпущен ключ API',
        text:
          `В кабинете выпущен ключ API «${notification.label}» (${notification.hint}). ` +
          'Сам ключ показан один раз при выпуске и письмом не отправляется.\n' +
          'Если ключ выпускали не вы, отзовите его в разделе «API» и смените ' +
          'пароль.',
      };
    case 'merchant-api-key-revoked':
      return {
        subject: 'Ключ API отозван',
        text:
          `Ключ API «${notification.label}» (${notification.hint}) отозван и больше ` +
          'не принимается. Запросы с ним получают отказ; новый ключ выпускается ' +
          'в разделе «API».',
      };
    case 'merchant-webhook-failing':
      return {
        subject: 'Вебхук не доставляется',
        text:
          `Пять попыток доставить событие «${notification.event}» на ${notification.url} ` +
          'не получили ответа 2xx: приёмник отвечает ошибкой или молчит. Новые события ' +
          'будут отправляться дальше, по пять попыток каждое, но пока приёмник не починен, ' +
          'они тоже пропадут. Ответы приёмника и пробная доставка ждут в разделе «Вебхуки».',
      };
  }
}

/**
 * Переходы заявки. Своими словами, а не клиентскими: мерчант платит сам
 * и следит за заявкой в кабинете, а не в чате, — и звать его надо туда.
 *
 * Первых двух состояний в письмах нет намеренно: заявку он только что
 * подал сам и видел ответ, а «менеджер взял в работу» — событие для
 * вебхука, а не повод для письма. Письмо приходит там, где от мерчанта
 * ждут действия или где деньги сменили хозяина.
 */
function exchangeMail(
  notification: Extract<Notification, { kind: 'exchange-request-status' }>,
): MerchantMail | null {
  switch (notification.status) {
    case 'new':
    case 'in_progress':
      return null;
    case 'rate_confirmed':
      return {
        subject: 'Курс подтверждён, заявка ждёт оплаты',
        text: [
          notification.finalRate
            ? `Курс по заявке: ${notification.finalRate}.`
            : 'Курс по заявке подтверждён.',
          'Реквизиты для оплаты ждут в кабинете — письмом они не ' +
            'отправляются: перевод по чужим реквизитам не возвращается.',
          notification.payWithinMinutes
            ? `Оплатите в течение ${notification.payWithinMinutes} мин: столько ` +
              'держится курс. Неоплаченную заявку сервис отменит.'
            : undefined,
        ]
          .filter((line) => line !== undefined)
          .join('\n'),
      };
    case 'payment_received':
      return {
        subject: 'Оплата получена',
        text: 'Оплата по заявке получена. Готовим отправку средств получателю.',
      };
    case 'completed':
      return {
        subject: 'Заявка исполнена',
        text:
          'Заявка исполнена, средства отправлены получателю. Суммы и курс — ' +
          'в кабинете; если что-то не сошлось, напишите в поддержку.',
      };
    case 'cancelled':
      return {
        subject: 'Заявка отменена',
        text: notification.cancelReason
          ? `Заявка отменена. Причина: ${notification.cancelReason}`
          : 'Заявка отменена.',
      };
  }
}

/**
 * Подпись письма: куда идти дальше.
 *
 * Кабинет — в каждом письме: любое из них про то, что там показано, и
 * искать закладку мерчант не должен. Поддержка — только когда ник задан
 * в настройках: ссылка на пустой чат хуже её отсутствия.
 */
export function merchantMailSignature(links: {
  readonly cabinetUrl: string;
  readonly supportUsername?: string | null | undefined;
}): string {
  const lines = [`Кабинет: ${links.cabinetUrl.replace(/\/+$/, '')}`];
  if (links.supportUsername) {
    lines.push(`Поддержка: https://t.me/${links.supportUsername.replace(/^@/, '')}`);
  }
  return lines.join('\n');
}
