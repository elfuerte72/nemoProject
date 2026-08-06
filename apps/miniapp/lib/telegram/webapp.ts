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
  /** Закрыть Mini App. Клиент остаётся там, откуда его открыл. */
  close?(): void;
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
  /**
   * Кнопка возврата в шапке Telegram — и системный жест «назад» на
   * Android, который к ней и приводит.
   *
   * Без неё этот жест закрывает всё приложение целиком: клиент,
   * привыкший так выходить из любого экрана, терял вместо открытого
   * листа весь Mini App вместе с набранным.
   */
  BackButton?: {
    show(): void;
    hide(): void;
    onClick(handler: () => void): void;
    offClick(handler: () => void): void;
  };
  /** Тактильный отклик. Появился в Bot API 6.1. */
  HapticFeedback?: {
    impactOccurred?(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void;
    notificationOccurred?(type: 'error' | 'success' | 'warning'): void;
    selectionChanged?(): void;
  };
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
 * Тактильный отклик на то, что произошло.
 *
 * Скупо и по делу: отклик на каждое касание перестаёт что-либо значить
 * уже через минуту работы. Отвечаем только на исход операции — заявка
 * подана, отказ пришёл — и на два жеста, у которых нет другого
 * подтверждения: разворот направления и копирование.
 *
 * Отсутствие — рабочий случай: на десктопе телефона нет, в клиенте
 * постарше нет метода. Приложение от этого не меняется ничем.
 */
export function haptic(kind: 'success' | 'error' | 'warning' | 'light'): void {
  const api = getWebApp()?.HapticFeedback;
  if (!api) return;
  try {
    if (kind === 'light') api.impactOccurred?.('light');
    else api.notificationOccurred?.(kind);
  } catch {
    // Этот клиент так не умеет — молча, как и остальные необязательные
    // возможности Telegram.
  }
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
 * Уйти в чат с менеджером.
 *
 * Не просто «открыть ссылку»: чат этот — с тем же ботом, из которого
 * приложение и запущено, то есть он лежит прямо под ним. А открытие
 * ссылки с Bot API 7.0 приложение не закрывает — Telegram послушно
 * переходит в чат, но Mini App остаётся поверх, и снаружи это выглядит
 * как несработавшая кнопка.
 *
 * Поэтому сначала переход, потом закрытие. Переход нужен на случай,
 * когда приложение открыли не из чата бота — прямой ссылкой или из
 * вложения в другом чате; закрытие — чтобы клиент этот чат увидел. В
 * клиенте постарше, где открытие само закрывало приложение, второй вызов
 * просто ни к чему не приводит.
 */
export function openSupport(): void {
  const url = supportLink();
  if (!url) return;

  const webApp = getWebApp();
  // Закрываем приложение только вслед за состоявшимся переходом. Клиент
  // постарше `openTelegramLink` не знает, и закрытие вслепую оставило бы
  // его без Mini App и без чата разом — то есть хуже, чем до нажатия.
  if (webApp?.openTelegramLink) {
    webApp.openTelegramLink(url);
    webApp.close?.();
    return;
  }

  window.open(url, '_blank');
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
