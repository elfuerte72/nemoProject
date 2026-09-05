import { redirect } from 'next/navigation';
import { requireStaffActorOrNull } from '@/lib/auth/require-session';
import { getCore } from '@/lib/core';
import { HowToServiceAccounts } from '@/app/ui/how-to';
import { ServiceAccountForms } from './service-account-forms';

export const dynamic = 'force-dynamic';

/**
 * Счета сервиса: куда клиент отправляет оплату (docs/adr/0008).
 *
 * Ведёт список администратор — заведение, правка и гашение отказывают
 * менеджеру самой операцией. Смотреть список менеджеру не запрещено:
 * из него он выбирает, что выдать по заявке. Условием выдачи список
 * не является (docs/adr/0015): реквизиты в заявке вставляют и руками.
 */
export default async function ServiceAccountsPage() {
  const actor = await requireStaffActorOrNull();
  if (!actor) {
    redirect('/login');
  }

  const core = getCore();
  const [accounts, terms, networks] = await Promise.all([
    core.listServiceAccounts(actor),
    core.getExchangeTerms(),
    core.listActiveNetworks(),
  ]);

  return (
    <main className="page">
      <header className="page__head">
        <div>
          <h1 className="page__title">Счета сервиса</h1>
          <p className="page__sub">
            Счета, которыми платят чаще всего. Менеджер выбирает счёт в заявке, и сообщение
            с реквизитами собирает сервер. Заводить сюда каждый кошелёк не обязательно: в
            заявке реквизиты можно вставить руками.
          </p>
        </div>
      </header>

      <HowToServiceAccounts />

      <ServiceAccountForms
        accounts={accounts}
        currencies={terms.currencies}
        networks={networks}
        canEdit={actor.role === 'admin'}
      />
    </main>
  );
}
