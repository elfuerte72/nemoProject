import { NotFoundError } from '@nemo/core';
import { isUuid } from '@nemo/types';

/**
 * Номер из пути запроса к API — до обращения к ядру.
 *
 * Договор (`docs/api/merchant-v1.yaml`) обещает на чужой и
 * несуществующий номер `404 not_found`. Номер не того вида база не
 * ищет, а отвергает ошибкой, и мерчант, подставивший свой номер брони
 * вместо нашего, получал `500 internal`. Здесь такой номер отвечает тем
 * же отказом и теми же словами, что ядро на несуществующий: обёртка
 * узнаёт его по коду, пишет в журнал и отдаёт телом договора.
 */

export function requireRequestId(id: string): string {
  // Слова — как у `getExchangeRequest` и `cancelOwnExchangeRequest`.
  if (!isUuid(id)) throw new NotFoundError('Заявка на обмен не найдена');
  return id;
}

export function requireRequisitesId(id: string): string {
  // Слова — как у `archiveRequisites`.
  if (!isUuid(id)) throw new NotFoundError('Реквизиты не найдены');
  return id;
}
