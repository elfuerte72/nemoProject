import {
  MERCHANT_LINK_PLACEHOLDER,
  merchantMailSignature,
  renderMerchantMail,
  type MerchantMail,
  type Notification,
} from '@nemo/core';

/**
 * Доставка писем мерчанту — то же место, что `@nemo/telegram` занимает у
 * клиента.
 *
 * Уведомления порождает операция, а доставщик берёт свои: письмо уходит
 * тому, у кого адресат почтовый, клиентское молча пропускается. Решать
 * по виду уведомления, звать ли доставку, значило бы повторять этот
 * выбор в каждом приложении — а видов у заявки шесть.
 *
 * Провайдер — Resend: у него один HTTPS-запрос без SDK, DKIM записями,
 * которые он сам показывает у домена (README, «Почта мерчантам»), и
 * события о доставке вебхуком. Живого запроса в тестах
 * нет: ответы записаны фикстурами.
 */

export interface MailDeliveryProvider {
  readonly mode: 'provider';
  readonly apiKey: string;
  /** Отправитель целиком: «Tobee <noreply@…>» или голый адрес. */
  readonly from: string;
}

/**
 * Письмо целиком — в журнал контейнера, вместе со ссылкой.
 *
 * Режим для контура без своего домена: до покупки домена (решение от
 * 6 сентября 2026) разработка идёт на бесплатном адресе Dokploy, а с
 * него провайдер не отправит — SPF и DKIM в чужой DNS не прописать.
 * Ссылку подтверждения тестирующий забирает из журнала.
 *
 * Выбирается он явно, а не подстановкой при пустом ключе: молча писать
 * письма в журнал на боевом контуре нельзя — так исчезали бы письма
 * настоящим мерчантам.
 */
export interface MailDeliveryLog {
  readonly mode: 'log';
}

/** Почта не настроена. Рабочее состояние деплоя, а не поломка. */
export interface MailDeliveryOff {
  readonly mode: 'off';
  /** Чем именно она не настроена: это видно в `/api/health`. */
  readonly complaint: string;
}

export type MailDelivery = MailDeliveryProvider | MailDeliveryLog | MailDeliveryOff;

export interface MailOptions {
  readonly delivery: MailDelivery;
  /** Корень кабинета: из него собираются ссылки в письмах. */
  readonly cabinetUrl: string;
  /** Ник поддержки из настроек сервиса; пусто — ссылки в письме нет. */
  readonly supportUsername?: string | null | undefined;
  /** Подменяется в тестах: живой запрос к провайдеру они не делают. */
  readonly fetch?: typeof globalThis.fetch | undefined;
}

/** Что о почте известно из окружения: чем отправлять и куда звать. */
export interface MailEnvironment {
  readonly delivery: MailDelivery;
  /** Корень кабинета из `CABINET_URL`; пусто — почта выключена. */
  readonly cabinetUrl: string;
}

/**
 * Почта из окружения.
 *
 * `EMAIL_DELIVERY` — `provider` или `log`; не задана или задана иначе —
 * почта выключена, и об этом говорит `complaint`: регистрация со
 * сбросом пароля отвечают им же, а `/api/health` называет режим.
 *
 * `CABINET_URL` нужен обоим режимам: любое письмо зовёт в кабинет, а
 * подтверждение почты и сброс пароля — это ссылка и есть. Письмо без
 * неё дошло бы, но сделать по нему было бы нечего.
 */
export function readMailEnvironment(env: NodeJS.ProcessEnv = process.env): MailEnvironment {
  const cabinetUrl = (env.CABINET_URL ?? '').trim();
  const delivery = readDelivery(env);
  if (delivery.mode !== 'off' && !cabinetUrl) {
    return {
      delivery: { mode: 'off', complaint: 'почта не настроена: не задан CABINET_URL' },
      cabinetUrl,
    };
  }
  return { delivery, cabinetUrl };
}

function readDelivery(env: NodeJS.ProcessEnv): MailDelivery {
  const mode = (env.EMAIL_DELIVERY ?? '').trim();
  if (mode === 'log') return { mode: 'log' };
  if (mode !== 'provider') {
    return {
      mode: 'off',
      complaint: mode
        ? `EMAIL_DELIVERY: «${mode}» — не режим доставки, бывают «provider» и «log»`
        : 'почта не настроена: не задан EMAIL_DELIVERY',
    };
  }

  const apiKey = (env.EMAIL_API_KEY ?? '').trim();
  const from = (env.EMAIL_FROM ?? '').trim();
  if (!apiKey || !from) {
    return {
      mode: 'off',
      complaint: 'почта не настроена: при EMAIL_DELIVERY=provider нужны EMAIL_API_KEY и EMAIL_FROM',
    };
  }

  return { mode: 'provider', apiKey, from };
}

/** Название режима для `/api/health`: ключ провайдера наружу не уходит. */
export function mailDeliveryName(delivery: MailDelivery): string {
  return delivery.mode;
}

/**
 * Уходят ли письма вообще. Регистрация и сброс пароля спрашивают до
 * того, как заводить запись: аккаунт, чьё письмо некуда отправить, —
 * это мерчант, который никогда не подтвердит адрес.
 */
export function mailWorks(delivery: MailDelivery): boolean {
  return delivery.mode !== 'off';
}

/**
 * Есть ли среди уведомлений письмо. Спрашивается до доставки: без
 * писем незачем ходить в базу за ником поддержки, а заявок клиентов на
 * порядок больше.
 */
export function hasMerchantMail(notifications: readonly Notification[]): boolean {
  return notifications.some((one) => renderMerchantMail(one) !== null);
}

export async function deliverNotifications(
  notifications: readonly Notification[],
  options: MailOptions,
): Promise<void> {
  if (notifications.length === 0) return;

  await Promise.all(notifications.map((notification) => send(notification, options)));
}

/**
 * Сбой отправки не отменяет уже совершённое действие: заявка исполнена и
 * деньги учтены независимо от того, дошло ли письмо. Провайдер, который
 * лежит, не должен ломать работу менеджера — он пишется в журнал.
 */
async function send(notification: Notification, options: MailOptions): Promise<void> {
  const mail = renderMerchantMail(notification);
  // Не наш адресат: клиентские уведомления доставляет бот.
  if (!mail) return;

  const to = addressOf(notification);
  if (!to) return;

  const text = compose(mail, notification, options);

  try {
    if (options.delivery.mode === 'off') {
      console.error('Письмо не отправлено', notification.kind, options.delivery.complaint);
      return;
    }
    if (options.delivery.mode === 'log') {
      // Целиком и со ссылкой: этот режим существует ровно затем, чтобы
      // ссылку из письма можно было забрать из журнала контейнера.
      console.info(
        `[почта:log] ${to} — ${mail.subject}\n${text}`,
      );
      return;
    }

    await sendThroughProvider({ to, subject: mail.subject, text }, options.delivery, options);
  } catch (error) {
    console.error('Не удалось отправить письмо', notification.kind, error);
  }
}

/** Текст письма целиком: тело со ссылкой и подпись под ним. */
function compose(
  mail: MerchantMail,
  notification: Notification,
  options: MailOptions,
): string {
  const body = mail.text.replace(MERCHANT_LINK_PLACEHOLDER, () => linkFor(notification, options));
  return `${body}\n\n${merchantMailSignature({
    cabinetUrl: options.cabinetUrl,
    supportUsername: options.supportUsername,
  })}`;
}

/**
 * Одноразовая ссылка из письма. Собирает её доставка: ядро знает ключ,
 * но не знает, на каком домене стоит кабинет.
 */
function linkFor(notification: Notification, options: MailOptions): string {
  const base = options.cabinetUrl.replace(/\/+$/, '');
  switch (notification.kind) {
    case 'merchant-email-verification':
      return `${base}/verify?token=${encodeURIComponent(notification.token)}`;
    case 'merchant-password-reset':
      return `${base}/reset?token=${encodeURIComponent(notification.token)}`;
    default:
      return base;
  }
}

/**
 * Адрес мерчанта едет вместе с уведомлением: в базу доставщик не ходит,
 * как не ходит в неё и доставщик Telegram.
 */
function addressOf(notification: Notification): string | null {
  const to = notification.to;
  if (typeof to === 'bigint') return null;
  return to.kind === 'merchant' ? to.email : null;
}

interface Letter {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

/**
 * Один запрос к Resend, без SDK: отправка — единственное, что сервису
 * от провайдера нужно, а зависимость ради одного `fetch` живёт дольше
 * своей пользы.
 */
async function sendThroughProvider(
  letter: Letter,
  delivery: MailDeliveryProvider,
  options: MailOptions,
): Promise<void> {
  const call = options.fetch ?? globalThis.fetch;
  const response = await call('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${delivery.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: delivery.from,
      to: [letter.to],
      subject: letter.subject,
      text: letter.text,
    }),
  });

  if (!response.ok) {
    // Слова провайдера в журнал: «422» без них не говорит, что
    // отправитель не подтверждён, а искать это в чужой панели дорого.
    const complaint = await response.text().catch(() => '');
    console.error('Провайдер отклонил письмо', letter.subject, response.status, complaint);
  }
}
