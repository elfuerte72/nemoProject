import { ForbiddenError, InvalidInputError } from '@nemo/core';
import {
  merchantAbilityComplaint,
  merchantRoleCan,
  type MerchantStatus,
  type MerchantUserRole,
} from '@nemo/types';

/**
 * Кому можно заводить и менять записи макета: счета и возвраты.
 *
 * За настоящей заявкой стоит операция ядра, и что мерчанту нельзя,
 * решает она — не спрятанные кнопки. За POS-терминалом операции нет,
 * решать некому, и правило приходится держать здесь, у каждого
 * изменяющего маршрута (`guard.test.ts` сверяет это по файлам).
 *
 * Два условия, и оба обязательны. Право `till` — из той же таблицы
 * ролей, что у ядра: 14 сентября 2026 наблюдатель, которого страница
 * `/pos` не пускает, создал счёт прямым запросом, потому что маршрут
 * проверял одно состояние. Кабинет активен — без этого мерчант с
 * неподтверждённой почтой или нерассмотренной анкетой заводил бы счета
 * мимо экрана, на который его не пускают; отключённый новое тоже не
 * начинает — то же правило, что у подачи заявки.
 *
 * Сначала право, потом состояние: наблюдатель неактивного кабинета
 * услышит, что это не его раздел, — это правда при любом состоянии.
 */
export function requireTill(session: {
  readonly role: MerchantUserRole;
  readonly status: MerchantStatus;
}): void {
  if (!merchantRoleCan(session.role, 'till')) {
    throw new ForbiddenError(merchantAbilityComplaint('till'));
  }
  if (session.status !== 'active') {
    throw new InvalidInputError('Кабинет пока не активен: заводить записи нельзя');
  }
}
