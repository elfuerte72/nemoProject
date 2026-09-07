import { HowTo } from '@nemo/ui';
import { SANDBOX_HOW_TO } from '@/lib/integration-texts';
import { supportUsername, viewer } from '@/lib/reads';
import { DisabledBanner } from '@/app/ui/disabled-banner';
import { SupportLink } from '@/app/ui/support-link';

export const dynamic = 'force-dynamic';

/**
 * Песочница: как получить доступ на тестовый контур.
 *
 * Тестовый контур — отдельный кабинет с той же регистрацией и ключами
 * `sk_test_`: заявки там двигает тот, кто открыл тестовую панель, а
 * деньги не ходят. Адрес — свойство развёртывания (`CABINET_SANDBOX_URL`):
 * не задан — сюда ведёт поддержка.
 */

export default async function SandboxPage() {
  const { session } = await viewer();
  const support = await supportUsername();
  const sandboxUrl = (process.env.CABINET_SANDBOX_URL ?? '').trim().replace(/\/+$/, '');

  return (
    <main className="page page--narrow">
      <DisabledBanner status={session.status} />

      <header className="page__head">
        <div>
          <h1 className="page__title">Песочница</h1>
          <p className="page__sub">Тестовый контур: те же вызовы, ключи sk_test_, без денег.</p>
        </div>
      </header>

      <HowTo title="Как это устроено" sub="Чем отличается и как попасть" items={SANDBOX_HOW_TO} />

      <section className="card">
        <h2 className="card__title">Адрес</h2>
        {sandboxUrl ? (
          <>
            <p className="card__note">
              Кабинет песочницы и её API — на своём домене. Регистрация там отдельная.
            </p>
            <a className="btn btn--gold" href={sandboxUrl} target="_blank" rel="noreferrer noopener">
              {sandboxUrl.replace(/^https?:\/\//, '')} ↗
            </a>
          </>
        ) : (
          <p className="card__note">
            Адрес песочницы сообщит поддержка: напишите, что хотите проверить интеграцию, и
            вам заведут доступ.
          </p>
        )}
        <SupportLink username={support} className="btn btn--soft" />
      </section>
    </main>
  );
}
