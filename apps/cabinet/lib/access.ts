import { merchantRoleCan, type MerchantAbility } from '@nemo/types';
import { abilityForPath } from '@/lib/nav-by-role';
import { viewer } from '@/lib/reads';

/**
 * Пускает ли роль вошедшего в этот раздел (тикет 17).
 *
 * Раздел, которого нет в меню, открывается прямой ссылкой — её
 * присылают в переписке, она остаётся в закладках, — и операция там
 * откажет. Отказ ядра правилен, но человеку он приходит пятисотым
 * ответом, а «что-то пошло не так» на месте «это может только
 * владелец» означает поломку вместо правила.
 *
 * Право берётся по адресу из той же карты, что собирает меню: одна
 * карта на то, что спрятано, и на то, что отказано.
 */
export type Access =
  | { readonly ok: true }
  /* Размеченным объединением: у отказа право названо всегда, и экрану
   * не приходится доставать его из необязательного поля. */
  | { readonly ok: false; readonly ability: MerchantAbility };

export async function allowedHere(path: string): Promise<Access> {
  const ability = abilityForPath(path);
  if (ability === undefined) return { ok: true };

  const { session } = await viewer();
  return merchantRoleCan(session.role, ability) ? { ok: true } : { ok: false, ability };
}
