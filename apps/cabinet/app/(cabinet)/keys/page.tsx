import { addressAllowed } from '@nemo/core';
import { HowTo } from '@nemo/ui';
import { allowedHere } from '@/lib/access';
import { toAddressRow } from '@/lib/address-rows';
import { requestExamples } from '@/lib/api-examples';
import { getCore } from '@/lib/core';
import { KEYS_HOW_TO } from '@/lib/integration-texts';
import { toKeyRow } from '@/lib/key-rows';
import { viewer } from '@/lib/reads';
import { CodeExamples } from '@/app/ui/code-examples';
import { DisabledBanner } from '@/app/ui/disabled-banner';
import { NoAccess } from '@/app/ui/no-access';
import { AllowedAddresses } from './allowed-addresses';
import { ApiKeys } from './api-keys';
import { Limits } from './limits';
import { RequestChecks } from './request-checks';

export const dynamic = 'force-dynamic';

/**
 * Раздел «API»: ключи, проверки запроса, пределы, разрешённые адреса и
 * пример — в том порядке, в каком их устроил Love&Pay (24 сентября
 * 2026, по просьбе Пенкина).
 *
 * Секрет ключа показывается один раз — при выпуске — и дальше нигде:
 * в списке стоят подпись словами и хвост, по которому ключ узнают.
 * Утёкший ключ не «сбрасывают», а отзывают и выпускают новый: так в
 * журнале остаётся, каким ключом что подавали.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export default async function KeysPage() {
  const access = await allowedHere('/keys');
  if (!access.ok) return <NoAccess ability={access.ability} />;

  const { actor, session } = await viewer();
  const core = getCore();
  const since = new Date(Date.now() - DAY_MS);
  const [keys, profile, addresses, callers, summary] = await Promise.all([
    core.listApiKeys(actor),
    core.getMerchantProfile(actor),
    core.listApiAddresses(actor),
    core.listApiCallerAddresses(actor, { since }),
    core.summarizeApiRequestLog(actor, { since }),
  ]);

  const live = keys.find((one) => one.revokedAt === null);
  const baseUrl = (process.env.CABINET_URL ?? '').replace(/\/+$/, '');
  const listed = addresses.map((one) => one.address);

  return (
    <main className="page">
      <DisabledBanner status={session.status} />

      <header className="page__head">
        <div>
          <h1 className="page__title">API</h1>
          <p className="page__sub">Ключи, проверки запроса, пределы и пример.</p>
        </div>
      </header>

      <HowTo title="Как это устроено" sub="Ключи, подпись, адреса, пределы" items={KEYS_HOW_TO} />

      <ApiKeys keys={keys.map(toKeyRow)} canIssue={session.status === 'active'} />

      <div className="duo">
        <RequestChecks
          signatureRequired={profile.signatureRequired}
          addressCount={addresses.length}
        />
        <Limits rateLimitedToday={summary.rateLimited} />
      </div>

      <AllowedAddresses
        addresses={addresses.map(toAddressRow)}
        callers={callers.map((caller) => ({
          address: caller.address,
          calls: caller.calls,
          admitted: caller.admitted,
          lastAt: caller.lastAt.toISOString(),
          // «В списке» — покрыт записью, а не «пропущен»: при пустом
          // списке пропускается всё, но разрешённым это никто не делал.
          listed: listed.length > 0 && addressAllowed(listed, caller.address),
        }))}
      />

      <section className="card">
        <h2 className="card__title">Пример запроса</h2>
        <p className="card__note">
          {profile.signatureRequired
            ? 'Подпись включена, поэтому пример подписывает запрос. У GET тело пустое — ' +
              'хешируется пустая строка; путь берётся вместе со строкой запроса.'
            : 'Ключ — в заголовке Authorization. Подача заявки устроена так же: ' +
              'POST /api/v1/exchange-requests с заголовком Idempotency-Key.'}
        </p>
        <CodeExamples
          id="request-example"
          examples={requestExamples({
            origin: baseUrl,
            keyHint: live?.hint ?? null,
            signed: profile.signatureRequired,
          })}
        />
      </section>
    </main>
  );
}
