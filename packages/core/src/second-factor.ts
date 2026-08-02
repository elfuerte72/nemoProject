import type { StaffRole } from '@nemo/types';

/**
 * Ссылка на секрет второго фактора для приложения-аутентификатора.
 *
 * Форма, в которой выданный секрет попадает в чужое приложение, — часть
 * самой выдачи, а не оформления экрана: её же печатает скрипт
 * развёртывания, у которого экрана нет. Собранная в двух местах, она
 * разошлась бы при первой правке, и разошлась бы молча — подпись записи
 * видна только в приложении сотрудника.
 */

const ISSUER = 'nemo';

export interface SecondFactorSubject {
  readonly telegramUserId: bigint;
  readonly role: StaffRole;
}

/**
 * Подпись записи — Telegram сотрудника и его роль, а не имя. Имена
 * повторяются и меняются, а искать в приложении приходится ровно по
 * тому, чем запись отличается от соседней: у администратора и менеджера
 * с одного телефона иначе две одинаковые строки «nemo».
 *
 * Роль латиницей и без перевода: подпись уезжает в чужое приложение и
 * остаётся там навсегда — переименование ролей в админке её не догонит.
 *
 * Двоеточие в подписи не ставится: в формате otpauth оно разделяет
 * издателя и запись, и второе разбирается приложениями по-разному.
 */
export function otpauthUri(subject: SecondFactorSubject, secret: string): string {
  const account = `${subject.telegramUserId.toString()} · ${subject.role}`;
  const params = new URLSearchParams({
    secret,
    issuer: ISSUER,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${encodeURIComponent(`${ISSUER}:${account}`)}?${params.toString()}`;
}
