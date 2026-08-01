import { renderNotification, type Notification } from '@nemo/core';

/**
 * Доставка уведомлений, которые вернула операция.
 *
 * Общая для обоих приложений: переходы заявки на обмен запускает
 * админка, а регистрацию реферала — Mini App, и клиент должен получать
 * их одинаково. Две копии этой функции успели разойтись в том, как
 * передают идентификатор получателя, — а это ровно то место, где
 * ошибка молча уводит сообщение не туда.
 *
 * Отправка идёт прямым запросом к Bot API, без библиотеки бота:
 * обновления здесь не принимаются, нужна одна команда из всего
 * интерфейса.
 */

export interface DeliveryOptions {
  readonly botToken: string;
}

export async function deliverNotifications(
  notifications: readonly Notification[],
  options: DeliveryOptions,
): Promise<void> {
  if (notifications.length === 0) return;

  await Promise.all(
    notifications.map((notification) => send(notification, options.botToken)),
  );
}

/**
 * Сбой отправки не отменяет уже совершённое действие: заявка исполнена
 * и деньги учтены независимо от того, дошло ли сообщение. Клиент,
 * заблокировавший бота, не должен ломать работу менеджера.
 */
async function send(notification: Notification, botToken: string): Promise<void> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        // Строкой, а не числом: `telegram_user_id` — bigint, и на
        // приведении к `number` он однажды потеряет точность.
        chat_id: notification.to.toString(),
        text: renderNotification(notification),
      }),
    });
    if (!response.ok) {
      console.error('Telegram отклонил уведомление', notification.kind, response.status);
    }
  } catch (error) {
    console.error('Не удалось отправить уведомление', notification.kind, error);
  }
}

/** Токен бота из окружения. Общий у обоих приложений — бот один. */
export function botToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error('Не задан TELEGRAM_BOT_TOKEN');
  }
  return token;
}

export interface BroadcastResult {
  readonly delivered: number;
  readonly failed: number;
}

export interface BroadcastOptions extends DeliveryOptions {
  /**
   * Сколько сообщений отправлять в секунду. Telegram ограничивает
   * массовую рассылку тридцатью — берём с запасом: превышение стоит
   * временной блокировки бота, и пострадает не только рассылка, но и
   * уведомления по заявкам.
   */
  readonly perSecond?: number;
  /** Подменяется в тестах, чтобы не ждать по-настоящему. */
  readonly wait?: (ms: number) => Promise<void>;
}

const DEFAULT_PER_SECOND = 25;

/**
 * Ручная рассылка по списку получателей.
 *
 * Отправка идёт порциями с паузой: список в тысячи человек, посланный
 * разом, приводит к 429 от Telegram и временной блокировке бота —
 * рассылка при этом не доходит ни до кого, а заодно перестают ходить
 * уведомления по заявкам.
 *
 * Отказ по одному получателю не прерывает остальных: клиент,
 * заблокировавший бота, — обычное дело, а не повод оборвать рассылку на
 * нём. Такие получатели считаются недоставленными, и администратор
 * видит их числом.
 */
export async function deliverBroadcast(
  recipients: readonly bigint[],
  body: string,
  options: BroadcastOptions,
): Promise<BroadcastResult> {
  const perSecond = Math.max(1, options.perSecond ?? DEFAULT_PER_SECOND);
  const wait = options.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  let delivered = 0;
  let failed = 0;

  for (let offset = 0; offset < recipients.length; offset += perSecond) {
    const chunk = recipients.slice(offset, offset + perSecond);
    const results = await Promise.all(
      chunk.map((to) => sendText(to, body, options.botToken)),
    );
    for (const ok of results) {
      if (ok) delivered += 1;
      else failed += 1;
    }

    if (offset + perSecond < recipients.length) {
      await wait(1000);
    }
  }

  return { delivered, failed };
}

/** `true`, если Telegram принял сообщение. Ошибки не бросаются наружу. */
async function sendText(to: bigint, text: string, botToken: string): Promise<boolean> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: to.toString(), text }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
