/**
 * Доступ к тому, что Telegram кладёт в страницу Mini App.
 *
 * Нужны ровно две вещи: строка данных запуска, которой сервер
 * подтверждает, кто пришёл, и пара команд разворачивания окна. Полная
 * типизация SDK здесь была бы обещанием, которого мы не проверяем: за
 * содержимое `window.Telegram` отвечает загруженный с их стороны скрипт.
 */

/**
 * Кто открыл приложение — так, как это называет сам Telegram.
 *
 * Всё необязательно, и это не осторожность в типах: клиент постарше
 * кладёт сюда меньше, а фотографии у аккаунта может не быть вовсе или
 * она закрыта настройками приватности.
 */
export interface TelegramUser {
  readonly first_name?: string;
  readonly last_name?: string;
  readonly username?: string;
  readonly photo_url?: string;
}

interface TelegramWebApp {
  initData: string;
  /**
   * То же, что в `initData`, но разобранное самим Telegram и без
   * подписи. Имени и фотографии в подписанной строке не проверить, и
   * серверу они поэтому не отдаются — но нарисовать шапку профиля
   * этого достаточно: она ничего не решает, а данные и так свои.
   */
  initDataUnsafe?: { user?: TelegramUser };
  ready(): void;
  expand(): void;
  /** Открыть ссылку t.me внутри Telegram, а не во внешнем браузере. */
  openTelegramLink?(url: string): void;
  /**
   * Запретить закрытие приложения свайпом вниз. Экраны здесь длиннее
   * окна, и жест прокрутки от верхнего края Telegram принимает за
   * «закрыть»: клиент теряет заполненную форму, ничего для этого не
   * сделав. Появился в Bot API 7.7 — в старых клиентах его нет.
   */
  disableVerticalSwipes?(): void;
  /**
   * Развернуть на весь экран, убрав шапку Telegram. Появился в Bot API
   * 8.0; на десктопе и в старых клиентах отсутствует или отвечает
   * отказом — приложение остаётся в обычном окне, и это рабочий исход,
   * а не поломка.
   *
   * После разворота под системными часами и кнопками самого Telegram
   * остаётся полоса, которую приложение обязано обойти само: её размер
   * приходит в `--tg-content-safe-area-inset-top`.
   */
  requestFullscreen?(): void;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export function getWebApp(): TelegramWebApp | undefined {
  return typeof window === 'undefined' ? undefined : window.Telegram?.WebApp;
}

/**
 * Имя и фотография открывшего приложение. Берутся у Telegram на месте:
 * запрашивать их у сервера незачем — он их не хранит, а показать нужно
 * ровно тому, чьи они и есть.
 */
export function getTelegramUser(): TelegramUser | undefined {
  return getWebApp()?.initDataUnsafe?.user;
}

/**
 * Открыть ссылку Telegram — внутри клиента, а не во внешнем браузере.
 *
 * Одна на всё приложение: так пересылают реферальную ссылку и так же
 * уходят в чат с ботом. Своя ветка под каждое место означала бы, что
 * однажды одно из них откроет чат в браузере, где клиент не залогинен.
 *
 * Запасной путь — обычное окно: Mini App открывают и на десктопе, где
 * старый клиент этого метода не знает.
 */
export function openTelegram(url: string): void {
  const webApp = getWebApp();
  if (webApp?.openTelegramLink) webApp.openTelegramLink(url);
  else window.open(url, '_blank');
}

/**
 * Чат, в котором клиента читает менеджер, — тот самый бот, которого
 * клиент запускал сам. Отдельного адреса поддержки у сервиса нет и не
 * должно быть: обращение живёт в переписке, одной на клиента.
 *
 * Пусто, когда имя бота не задано развёртыванием: кнопка, ведущая в
 * никуда, хуже её отсутствия.
 */
export function supportLink(): string | undefined {
  const bot = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;
  return bot ? `https://t.me/${bot}` : undefined;
}

/**
 * Строка данных запуска. Пустая означает, что страницу открыли не из
 * Telegram — работать с сервисом в этом случае нельзя: подтвердить, кто
 * перед нами, нечем.
 */
export function getInitData(): string | undefined {
  const raw = getWebApp()?.initData;
  return raw && raw.length > 0 ? raw : undefined;
}
