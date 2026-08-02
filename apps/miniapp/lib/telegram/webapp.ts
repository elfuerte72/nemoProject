/**
 * Доступ к тому, что Telegram кладёт в страницу Mini App.
 *
 * Нужны ровно две вещи: строка данных запуска, которой сервер
 * подтверждает, кто пришёл, и пара команд разворачивания окна. Полная
 * типизация SDK здесь была бы обещанием, которого мы не проверяем: за
 * содержимое `window.Telegram` отвечает загруженный с их стороны скрипт.
 */

interface TelegramWebApp {
  initData: string;
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
 * Строка данных запуска. Пустая означает, что страницу открыли не из
 * Telegram — работать с сервисом в этом случае нельзя: подтвердить, кто
 * перед нами, нечем.
 */
export function getInitData(): string | undefined {
  const raw = getWebApp()?.initData;
  return raw && raw.length > 0 ? raw : undefined;
}
