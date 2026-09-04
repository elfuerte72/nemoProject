import { getCore } from '@/lib/core';
import { EconomyForms } from '../economy-forms';
import { SectionLead, SettingsSection, settingsActor } from '../section';

export const dynamic = 'force-dynamic';

export default async function EconomyPage() {
  const actor = await settingsActor();
  return (
    <SettingsSection
      load={async () => {
        const settings = await getCore().getServiceSettings(actor);
        return (
          <>
            <SectionLead href="/settings/economy" />
            <EconomyForms settings={settings} />
          </>
        );
      }}
    />
  );
}
