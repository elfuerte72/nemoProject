import { HowTo } from '@nemo/ui';
import { getCore } from '@/lib/core';
import { KEYS_HOW_TO } from '@/lib/integration-texts';
import { toKeyRow } from '@/lib/key-rows';
import { viewer } from '@/lib/reads';
import { DisabledBanner } from '@/app/ui/disabled-banner';
import { ApiKeys } from './api-keys';
import { SignatureToggle } from './signature-toggle';
import { UsageExample } from './usage-example';

export const dynamic = 'force-dynamic';

/**
 * Раздел «API»: ключи, подпись, пределы и пример запроса.
 *
 * Секрет ключа показывается один раз — при выпуске — и дальше нигде:
 * в списке стоят подпись словами и хвост, по которому ключ узнают.
 * Утёкший ключ не «сбрасывают», а отзывают и выпускают новый: так в
 * журнале остаётся, каким ключом что подавали.
 */

export default async function KeysPage() {
  const { actor, session } = await viewer();
  const core = getCore();
  const [keys, profile] = await Promise.all([core.listApiKeys(actor), core.getMerchantProfile(actor)]);

  const live = keys.find((one) => one.revokedAt === null);
  const baseUrl = (process.env.CABINET_URL ?? '').replace(/\/+$/, '');

  return (
    <main className="page">
      <DisabledBanner status={session.status} />

      <header className="page__head">
        <div>
          <h1 className="page__title">API</h1>
          <p className="page__sub">Ключи, подпись запросов, пределы и пример.</p>
        </div>
      </header>

      <HowTo title="Как это устроено" sub="Ключи, подпись, пределы" items={KEYS_HOW_TO} />

      <ApiKeys keys={keys.map(toKeyRow)} canIssue={session.status === 'active'} />

      <SignatureToggle required={profile.signatureRequired} />

      <UsageExample
        baseUrl={baseUrl}
        keyHint={live?.hint ?? null}
        signatureRequired={profile.signatureRequired}
      />
    </main>
  );
}
