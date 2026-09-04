import { getCore } from '@/lib/core';
import { Moment } from '@/app/ui/moment';
import { SectionLead, SettingsSection, settingsActor } from '../section';

export const dynamic = 'force-dynamic';

/**
 * Журнал изменений настроек. Вопрос «почему за эту заявку начислили
 * столько» должен иметь ответ — каждая правка ставок, наценки и
 * справочников встаёт сюда.
 */
export default async function SettingsLogPage() {
  const actor = await settingsActor();
  return (
    <SettingsSection
      load={async () => {
        const log = await getCore().listSettingsAuditLog(actor);
        return (
          <>
            <SectionLead href="/settings/log" />
            {log.length === 0 ? (
              <p className="empty">
                Настройки ещё не меняли. Каждая правка ставок, наценки и счетов встанет сюда —
                вопрос «почему за эту заявку начислили столько» должен иметь ответ.
              </p>
            ) : (
              <ul className="rows">
                {log.map((entry) => (
                  <li key={entry.id} className="row">
                    <div className="row__main">
                      <span className="row__title">{entry.staffName}</span>
                      <span className="row__meta row__meta--lines">
                        {entry.subject}: {JSON.stringify(entry.changes)}
                      </span>
                    </div>
                    <span className="row__meta">
                      <Moment at={new Date(entry.createdAt).toISOString()} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        );
      }}
    />
  );
}
