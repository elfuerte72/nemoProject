import { redirect } from 'next/navigation';
import { CoreError } from '@nemo/core';
import { requireStaffActorOrNull } from '@/lib/auth/require-session';
import { getCore } from '@/lib/core';
import { BroadcastForm } from './broadcast-form';
import { SettingsForms } from './settings-forms';

export const dynamic = 'force-dynamic';

/**
 * Раздел администратора.
 *
 * Менеджеру он не показывается вовсе — но не потому, что скрыт: каждая
 * операция здесь сама отказывает не-администратору. Скрытая ссылка без
 * такого отказа была бы не разграничением доступа, а его видимостью.
 */
export default async function SettingsPage() {
  const actor = await requireStaffActorOrNull();
  if (!actor) {
    redirect('/login');
  }

  const core = getCore();
  try {
    const [settings, pairs, staff, log, broadcasts] = await Promise.all([
      core.getServiceSettings(actor),
      core.listCurrencyPairsForAdmin(actor),
      core.listStaff(actor),
      core.listSettingsAuditLog(actor),
      core.listBroadcasts(actor),
    ]);

    return (
      <main style={styles.page}>
        <h1 style={styles.title}>Настройки</h1>

        <SettingsForms
          settings={settings}
          pairs={pairs}
          staff={staff.map((one) => ({
            ...one,
            telegramUserId: one.telegramUserId.toString(),
          }))}
        />

        <BroadcastForm broadcasts={broadcasts} />

        <section style={styles.block}>
          <h2 style={styles.heading}>Журнал изменений</h2>
          {log.length === 0 ? (
            <p style={styles.muted}>Настройки ещё не меняли.</p>
          ) : (
            <ul style={styles.list}>
              {log.map((entry) => (
                <li key={entry.id} style={styles.item}>
                  <div>
                    {new Date(entry.createdAt).toLocaleString('ru-RU')} — {entry.staffName}
                  </div>
                  <div style={styles.muted}>
                    {entry.subject}: {JSON.stringify(entry.changes)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    );
  } catch (error) {
    // Менеджер сюда зашёл по прямой ссылке: показываем отказ, а не
    // страницу входа — войти он как раз может, просто не сюда.
    if (error instanceof CoreError && error.code === 'forbidden') {
      return (
        <main style={styles.page}>
          <h1 style={styles.title}>Настройки</h1>
          <p style={styles.muted}>Раздел доступен только администратору.</p>
        </main>
      );
    }
    throw error;
  }
}

const styles = {
  page: {
    fontFamily: 'system-ui, sans-serif',
    padding: '2rem 1.5rem',
    maxWidth: 780,
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '2rem',
  },
  title: { fontSize: '1.3rem' },
  block: { display: 'flex', flexDirection: 'column', gap: '0.6rem' },
  heading: { fontSize: '1.05rem' },
  list: { listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '0.6rem' },
  item: { borderTop: '1px solid rgba(128,128,128,0.25)', paddingTop: '0.5rem' },
  muted: { opacity: 0.7, fontSize: '0.85rem', lineHeight: 1.45, wordBreak: 'break-word' },
} satisfies Record<string, React.CSSProperties>;
