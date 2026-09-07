import { getCore } from '@/lib/core';
import { MerchantSupport } from '../merchant-support';
import { SectionLead, SettingsSection, settingsActor } from '../section';

export const dynamic = 'force-dynamic';

export default async function MerchantSettingsPage() {
  const actor = await settingsActor();
  return (
    <SettingsSection
      load={async () => {
        const settings = await getCore().getServiceSettings(actor);
        return (
          <>
            <SectionLead href="/settings/merchants" />
            <MerchantSupport settings={settings} />
          </>
        );
      }}
    />
  );
}
