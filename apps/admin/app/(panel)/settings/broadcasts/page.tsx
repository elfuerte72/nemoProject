import { getCore } from '@/lib/core';
import { BroadcastForm } from '../broadcast-form';
import { SectionLead, SettingsSection, settingsActor } from '../section';

export const dynamic = 'force-dynamic';

export default async function BroadcastsPage() {
  const actor = await settingsActor();
  return (
    <SettingsSection
      load={async () => {
        const [broadcasts, audience] = await Promise.all([
          getCore().listBroadcasts(actor),
          getCore().countBroadcastAudience(actor),
        ]);
        return (
          <>
            <SectionLead href="/settings/broadcasts" />
            <BroadcastForm broadcasts={broadcasts} audience={audience} />
          </>
        );
      }}
    />
  );
}
