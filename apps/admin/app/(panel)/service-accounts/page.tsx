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
 * из него он и выбирает, что выдать по заявке, и увидеть заранее, что
 * там есть, полезнее, чем узнать об этом на первой же выдаче.
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
            Куда клиент отправляет оплату. Менеджер выбирает счёт в заявке, а сообщение с
            реквизитами собирает сервер — номер он не набирает.
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
