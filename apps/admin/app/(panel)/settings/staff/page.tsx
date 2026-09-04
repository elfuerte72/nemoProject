import { getCore } from '@/lib/core';
import { SectionLead, SettingsSection, settingsActor } from '../section';
import { StaffForm } from '../staff-form';

export const dynamic = 'force-dynamic';

export default async function StaffPage() {
  const actor = await settingsActor();
  return (
    <SettingsSection
      load={async () => {
        const staff = await getCore().listStaff(actor);
        return (
          <>
            <SectionLead href="/settings/staff" />
            <StaffForm
              staff={staff.map((one) => ({
                ...one,
                telegramUserId: one.telegramUserId.toString(),
              }))}
            />
          </>
        );
      }}
    />
  );
}
