import Link from 'next/link';
import { EmptyState } from '@nemo/ui';
import { merchantAbilityComplaint, type MerchantAbility } from '@nemo/types';

/**
 * Раздел, в который роль не пускает (тикет 17).
 *
 * Внутри кабинета, с меню и шапкой, а не вместо него: человек вошёл, он
 * здесь свой — просто этот раздел не его. Слова те же, которыми
 * откажет операция (`merchantAbilityComplaint`): два текста об одном
 * запрете разошлись бы, и человек услышал бы разное, смотря куда нажал.
 */
export function NoAccess({ ability }: { readonly ability: MerchantAbility }) {
  return (
    <main className="page">
      <EmptyState
        icon="key"
        title="Этот раздел не ваш"
        text={merchantAbilityComplaint(ability)}
        action={
          <Link className="btn btn--soft" href="/dashboard">
            На обзор
          </Link>
        }
      />
    </main>
  );
}
