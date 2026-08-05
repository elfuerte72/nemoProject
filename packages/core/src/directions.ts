import { asc, eq } from 'drizzle-orm';
import { currencyPairs } from '@nemo/db';
import type { ExchangeKind } from '@nemo/types';
import { requireAdmin, type Actor } from './actor.js';
import type { CoreConfig } from './context.js';
import { NotFoundError } from './errors.js';
import { recordSettingsChange } from './settings-audit.js';

/**
 * Справочник направлений обмена глазами администратора.
 *
 * Состав справочника — решение о том, чем сервис торгует, и меняется оно
 * скриптом развёртывания, а не из панели: направление заводят под
 * работающий канал выплаты, и кнопка «добавить» обещала бы, что канал
 * заведётся сам. А вот погасить заведённое — рабочее состояние, и оно
 * здесь: курс безналичной заявки сервис фиксирует при подаче
 * (docs/adr/0006), поэтому направление, на котором цена разошлась с
 * рынком, надо уметь закрыть за секунды, а не за выкатку.
 *
 * Признак активности, а не удаление: на направление ссылаются поданные
 * заявки, а погашенное завтра включат обратно.
 */

export interface DirectionView {
  readonly id: string;
  readonly fromCode: string;
  readonly toCode: string;
  readonly kind: ExchangeKind;
  readonly isActive: boolean;
}

/**
 * Весь справочник — администратору, который им управляет. Клиент видит
 * только включённые направления, и приходят они к нему вместе с
 * условиями обмена (`getExchangeTerms`).
 */
export async function listDirections(
  ctx: CoreConfig,
  actor: Actor,
): Promise<readonly DirectionView[]> {
  requireAdmin(actor);
  return ctx.db
    .select({
      id: currencyPairs.id,
      fromCode: currencyPairs.fromCode,
      toCode: currencyPairs.toCode,
      kind: currencyPairs.kind,
      isActive: currencyPairs.isActive,
    })
    .from(currencyPairs)
    .orderBy(asc(currencyPairs.fromCode), asc(currencyPairs.toCode), asc(currencyPairs.kind));
}

export async function setDirectionActive(
  ctx: CoreConfig,
  actor: Actor,
  directionId: string,
  isActive: boolean,
): Promise<DirectionView> {
  const admin = requireAdmin(actor);

  return ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .update(currencyPairs)
      .set({ isActive })
      .where(eq(currencyPairs.id, directionId))
      .returning({
        id: currencyPairs.id,
        fromCode: currencyPairs.fromCode,
        toCode: currencyPairs.toCode,
        kind: currencyPairs.kind,
        isActive: currencyPairs.isActive,
      });

    if (!row) {
      throw new NotFoundError('Направление не заведено');
    }

    // Направление гасят из-за цены, и разбирать потом придётся именно
    // это: кто закрыл и когда. Журнал настроек у сервиса один, и запись
    // ложится в него рядом с наценкой, которую в тот же час правили.
    await recordSettingsChange(tx, admin.staffId, 'currency_pair', row.id, {
      action: isActive ? 'enabled' : 'disabled',
      direction: `${row.fromCode} → ${row.toCode}`,
      kind: row.kind,
    });
    return row;
  });
}
