import { getCore } from '@/lib/core';
import { ConciergeLimits } from '../concierge-limits';
import { KnowledgeForm } from '../knowledge-form';
import { SectionLead, SettingsSection, settingsActor } from '../section';

export const dynamic = 'force-dynamic';

export default async function ConciergePage() {
  const actor = await settingsActor();
  return (
    <SettingsSection
      load={async () => {
        const core = getCore();
        const [settings, knowledge] = await Promise.all([
          core.getServiceSettings(actor),
          core.listKnowledgeArticles(actor),
        ]);
        return (
          <>
            <SectionLead href="/settings/concierge" />
            <ConciergeLimits settings={settings} />
            <KnowledgeForm articles={knowledge} canDraft={core.hasKnowledgeDrafter()} />
          </>
        );
      }}
    />
  );
}
