import { HowTo } from '@nemo/ui';
import { getCore } from '@/lib/core';
import { deviceLabel } from '@/lib/device';
import { viewer } from '@/lib/reads';
import { SESSIONS_HOW_TO } from '@/lib/security-texts';
import { DisabledBanner } from '@/app/ui/disabled-banner';
import { SessionsList } from './sessions-list';

export const dynamic = 'force-dynamic';

/**
 * «Сессии»: где вошедший открыл кабинет и чем отключить незнакомое
 * устройство (24 сентября 2026, по образцу Love&Pay).
 *
 * Раздел личный и открыт каждой роли: входы — свойство человека
 * (ADR-0023), и наблюдателю они важны не меньше, чем владельцу. Чужие
 * сессии не показываются никому: владелец закрывает доступ человеку
 * целиком в «Сотрудниках».
 */
export default async function SessionsPage() {
  const { actor, session } = await viewer();
  const sessions = await getCore().listMerchantSessions(actor);

  return (
    <main className="page">
      <DisabledBanner status={session.status} />

      <header className="page__head">
        <div>
          <h1 className="page__title">Сессии</h1>
          <p className="page__sub">Устройства, где вы вошли в кабинет.</p>
        </div>
      </header>

      <HowTo title="Как это устроено" sub="Как понять, что доступ под контролем" items={SESSIONS_HOW_TO} />

      <SessionsList
        sessions={sessions.map((one) => ({
          id: one.id,
          device: deviceLabel(one.userAgent),
          address: one.address,
          createdAt: one.createdAt.toISOString(),
          lastSeenAt: one.lastSeenAt.toISOString(),
          current: one.id === session.sessionId,
        }))}
      />
    </main>
  );
}
