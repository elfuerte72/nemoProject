/**
 * Изменяющий запрос к панели — только со страницы самой панели.
 *
 * Само правило — в `@nemo/http/same-origin`, одно на панель и кабинет;
 * там же записано, почему `SameSite=Lax` не хватает, пока сервис живёт
 * на `*.sslip.io`. Здесь состав панели и её слова отказа.
 *
 * У панели цена подделки выше, чем у кабинета: запросом от имени
 * вошедшего администратора заводится новый администратор, от имени
 * менеджера — называются реквизиты для оплаты и уходит ответ клиенту за
 * подписью «[Оператор]». До 17 сентября 2026 этой проверки у панели не
 * было вовсе.
 */

import {
  crossSiteComplaint as complaintBy,
  publicHost,
  type RequestFacts,
  type SameOriginRules,
} from '@nemo/http/same-origin';

export const CROSS_SITE_COMPLAINT =
  'Запрос пришёл не со страницы панели. Откройте панель и повторите действие там.';

export const PANEL_RULES: SameOriginRules = {
  complaint: CROSS_SITE_COMPLAINT,
  /*
   * Не на куке: вебхук бота входа — секретом Telegram; толчок о новой
   * заявке и его прежний адрес, которым ещё ходит планировщик, —
   * секретом планировщика. Адреса записаны целиком, без косой черты на
   * конце: `/api/staff/notify` ходит по секрету, а `/api/staff` — по
   * куке, и это тот самый маршрут, которым заводят администратора.
   */
  notCookie: ['/api/bot', '/api/staff/notify', '/api/conversations/notify'],
  /*
   * Файл клиенту (docs/adr/0020) и документ в базу знаний
   * (docs/adr/0016). Список сверяется с маршрутами тестом: забытый
   * здесь маршрут отвечал бы отказом на каждую отправку.
   */
  multipart: ['/api/conversations/attachments', '/api/concierge/knowledge/draft'],
};

export function crossSiteComplaint(facts: RequestFacts): string | null {
  return complaintBy(facts, PANEL_RULES);
}

export { publicHost, type RequestFacts };
