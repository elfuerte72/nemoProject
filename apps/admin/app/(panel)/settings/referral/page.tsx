import { HowTo } from '@nemo/ui';
import { getCore } from '@/lib/core';
import { REFERRAL_PROGRAM_HOW_TO } from '@/lib/referral-texts';
import { ReferralProgramForms } from '../referral-program-forms';
import { SectionLead, SettingsSection, settingsActor } from '../section';

export const dynamic = 'force-dynamic';

export default async function ReferralSettingsPage() {
  const actor = await settingsActor();
  return (
    <SettingsSection
      load={async () => {
        const core = getCore();
        const [program, settings] = await Promise.all([
          core.getReferralProgram(actor),
          core.getServiceSettings(actor),
        ]);
        return (
          <>
            <SectionLead href="/settings/referral" />
            <HowTo
              title="Как устроена реферальная программа"
              sub="Линии, уровни, личные ставки"
              items={REFERRAL_PROGRAM_HOW_TO}
            />
            <ReferralProgramForms program={program} settings={settings} />
          </>
        );
      }}
    />
  );
}
