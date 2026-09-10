import type { Metadata } from 'next';
import { Money } from '@nemo/types';
import { HowTo } from '@nemo/ui';
import { AMBASSADOR_WITHDRAWAL_HOW_TO } from '@/lib/ambassador-texts';
import { ambassadorAccount, ambassadorPage } from '@/lib/ambassador-reads';
import { getCore } from '@/lib/core';
import { toRecipientRow } from '@/lib/recipient-rows';
import { Withdrawal } from './withdrawal';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Вывод — кабинет амбассадора' };

/**
 * Вывод баллов: остаток, заявка и история выплат.
 *
 * Очередь у менеджера одна на клиентов и амбассадоров: своей очереди
 * здесь не заводится, иначе часть заявок никто бы не видел. Реквизит
 * заводится тут же — у блогера, никогда не открывавшего Mini App,
 * записей нет вовсе, а без записи вывод невозможен.
 */
export default async function AmbassadorWithdrawal() {
  const { actor } = await ambassadorPage();
  const core = getCore();
  const [account, requisites, requests, networks] = await Promise.all([
    ambassadorAccount(),
    core.listRequisites(actor),
    core.listWithdrawalRequests(actor),
    core.listActiveNetworks(),
  ]);

  // Доступное считает ядро тем же счётом, каким проверяет подачу
  // (`bonus-account.ts`); держат остаток открытые заявки, и сколько
  // именно — разница между остатком и доступным.
  const held = Money.subtract(account.balance, account.available);

  return (
    <main className="page">
      <header className="page__head">
        <div>
          <h1 className="page__title">Вывод</h1>
          <p className="page__sub">Заработанное можно забрать на свой реквизит</p>
        </div>
      </header>

      <HowTo
        title="Как получить деньги"
        sub="Остаток, реквизит и сроки"
        items={AMBASSADOR_WITHDRAWAL_HOW_TO}
      />

      <Withdrawal
        balance={account.available}
        held={held}
        minAmount={account.minWithdrawalAmount}
        requisites={requisites.map(toRecipientRow)}
        requests={requests.map((one) => ({
          id: one.id,
          amount: one.amount,
          status: one.status,
          destinationHint: one.destinationHint,
          rejectReason: one.rejectReason,
          createdAt: one.createdAt.toISOString(),
          paidAt: one.paidAt?.toISOString() ?? null,
        }))}
        networks={networks}
      />
    </main>
  );
}
