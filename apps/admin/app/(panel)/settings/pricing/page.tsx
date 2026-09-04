import { getCore } from '@/lib/core';
import { PricingForms } from '../pricing-page';
import { SectionLead, SettingsSection, settingsActor } from '../section';

export const dynamic = 'force-dynamic';

export default async function PricingPage() {
  const actor = await settingsActor();
  return (
    <SettingsSection
      load={async () => {
        const core = getCore();
        const [networks, directions, feeSchedules] = await Promise.all([
          core.listNetworks(actor),
          core.listDirections(actor),
          core.listFeeSchedules(actor),
        ]);
        return (
          <>
            <SectionLead href="/settings/pricing" />
            <PricingForms networks={networks} directions={directions} feeSchedules={feeSchedules} />
          </>
        );
      }}
    />
  );
}
