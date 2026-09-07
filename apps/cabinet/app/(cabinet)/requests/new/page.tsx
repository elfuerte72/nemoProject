import Link from 'next/link';
import { HowTo } from '@nemo/ui';
import { getCore } from '@/lib/core';
import { NEW_REQUEST_HOW_TO } from '@/lib/exchange-texts';
import { viewer } from '@/lib/reads';
import { toRecipientRow } from '@/lib/recipient-rows';
import { DisabledBanner } from '@/app/ui/disabled-banner';
import { NewRequestForm } from './new-request-form';

export const dynamic = 'force-dynamic';

/**
 * Страница новой заявки, а не модал: полей здесь больше, чем в
 * подтверждении, — направление, две суммы, получатель, свой номер, — и
 * в окне поверх списка они не помещаются. Условия, сохранённые
 * получатели и сети приходят с сервером; курс форма спрашивает сама и
 * перечитывает по кругу.
 */
export default async function NewRequestPage() {
  const { actor, session } = await viewer();
  const core = getCore();

  const [terms, requisites, networks, recent] = await Promise.all([
    core.getExchangeTerms(),
    core.listRequisites(actor),
    core.listActiveNetworks(),
    // Какая запись шла в последней заявке в каждую валюту: обычная
    // повторная заявка не должна требовать выбора получателя.
    core.listExchangeRequests(actor, { limit: 50 }),
  ]);

  const lastUsed: Record<string, string> = {};
  for (const request of recent) {
    if (request.requisitesId && !(request.toCode in lastUsed)) {
      lastUsed[request.toCode] = request.requisitesId;
    }
  }

  const pairs = terms.pairs
    .filter((pair) => pair.kind === 'electronic')
    .map(({ fromCode, toCode }) => ({ fromCode, toCode }));

  return (
    <main className="page">
      <DisabledBanner status={session.status} />

      <header className="page__head">
        <div>
          <p className="page__eyebrow">
            <Link className="page__back" href="/requests">
              Заявки
            </Link>
          </p>
          <h1 className="page__title">Новая заявка</h1>
          <p className="page__sub">
            Что отдаёте, что должно прийти и кому. Курс фиксируется при подаче.
          </p>
        </div>
      </header>

      <HowTo title="Как это устроено" sub="Стороны, курс, получатель" items={NEW_REQUEST_HOW_TO} />

      <NewRequestForm
        pairs={pairs}
        terms={{
          minAmount: terms.minAmount,
          minAmountCode: terms.minAmountCode,
          unpaidTtlMinutes: terms.unpaidTtlMinutes,
        }}
        recipients={requisites.map(toRecipientRow)}
        networks={networks}
        lastUsed={lastUsed}
        canSubmit={session.status === 'active'}
      />
    </main>
  );
}
