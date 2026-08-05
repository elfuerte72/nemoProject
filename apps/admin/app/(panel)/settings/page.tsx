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
    const [settings, staff, log, broadcasts, networks, directions] = await Promise.all([
      core.getServiceSettings(actor),
      core.listStaff(actor),
      core.listSettingsAuditLog(actor),
      core.listBroadcasts(actor),
      core.listNetworks(actor),
      core.listDirections(actor),
    ]);

    return (
      <main className="page">
        <header className="page__head">
          <div>
            <h1 className="page__title">Настройки</h1>
            <p className="page__sub">
              Экономика сервиса и сотрудники. Изменения действуют вперёд и попадают в журнал.
            </p>
          </div>
        </header>

        <SettingsForms
          settings={settings}
          networks={networks}
          directions={directions}
          staff={staff.map((one) => ({
            ...one,
            telegramUserId: one.telegramUserId.toString(),
          }))}
        />

        <BroadcastForm broadcasts={broadcasts} />

        <section className="section">
          <div className="section__head">
            <h2 className="section__title">Журнал изменений</h2>
            <span className="section__rule" />
          </div>
          {log.length === 0 ? (
            <p className="empty">Настройки ещё не меняли.</p>
          ) : (
            <ul className="rows">
              {log.map((entry) => (
                <li key={entry.id} className="row">
                  <div className="row__main">
                    <span className="row__title">{entry.staffName}</span>
                    <span className="row__meta">
                      {entry.subject}: {JSON.stringify(entry.changes)}
                    </span>
                  </div>
                  <span className="row__meta">
                    {new Date(entry.createdAt).toLocaleString('ru-RU')}
                  </span>
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
        <main className="page">
          <h1 className="page__title">Настройки</h1>
          <p className="empty">Раздел доступен только администратору.</p>
        </main>
      );
    }
    throw error;
  }
}
