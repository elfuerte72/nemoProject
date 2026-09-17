import { HowTo } from '@nemo/ui';
import { allowedHere } from '@/lib/access';
import { getCore } from '@/lib/core';
import { RECIPIENTS_HOW_TO } from '@/lib/exchange-texts';
import { viewer } from '@/lib/reads';
import { toRecipientRow } from '@/lib/recipient-rows';
import { DisabledBanner } from '@/app/ui/disabled-banner';
import { NoAccess } from '@/app/ui/no-access';
import { Recipients } from './recipients';

export const dynamic = 'force-dynamic';

/**
 * Раздел «Получатели»: сохранённые реквизиты мерчанта — свои счета и
 * кошельки, на которые он меняет регулярно. Получатели, названные прямо
 * в заявке, сюда не попадают: они архивируются при подаче, и список не
 * растёт на каждого покупателя.
 */
export default async function RecipientsPage() {
  const access = await allowedHere('/recipients');
  if (!access.ok) return <NoAccess ability={access.ability} />;

  const { actor, session } = await viewer();
  const core = getCore();
  const [requisites, networks] = await Promise.all([
    core.listRequisites(actor),
    core.listActiveNetworks(),
  ]);

  return (
    <main className="page">
      <DisabledBanner status={session.status} />

      <header className="page__head">
        <div>
          <h1 className="page__title">Получатели</h1>
          <p className="page__sub">
            Реквизиты, на которые сервис отправляет деньги по вашим заявкам.
          </p>
        </div>
      </header>

      <HowTo
        title="Как это устроено"
        sub="Что хранится, что видно, как проверяется"
        items={RECIPIENTS_HOW_TO}
      />

      <Recipients
        recipients={requisites.map(toRecipientRow)}
        networks={networks}
        canAdd={session.status === 'active'}
      />
    </main>
  );
}
