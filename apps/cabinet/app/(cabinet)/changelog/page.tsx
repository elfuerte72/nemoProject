import { Fragment, type ReactNode } from 'react';
import { HowTo } from '@nemo/ui';
import { allowedHere } from '@/lib/access';
import {
  API_CHANGES,
  CHANGE_KIND_LABELS,
  CHANGELOG_HOW_TO,
  changeDate,
} from '@/lib/api-changelog';
import { viewer } from '@/lib/reads';
import { DisabledBanner } from '@/app/ui/disabled-banner';
import { NoAccess } from '@/app/ui/no-access';

export const dynamic = 'force-dynamic';

/**
 * «Изменения API»: что менялось в договоре и что с этим делать (24
 * сентября 2026, по образцу «API Changelog» Love&Pay). Переключателя
 * версий, как у образца, нет: версия у нас одна.
 */
export default async function ChangelogPage() {
  const access = await allowedHere('/changelog');
  if (!access.ok) return <NoAccess ability={access.ability} />;

  const { session } = await viewer();

  return (
    <main className="page">
      <DisabledBanner status={session.status} />

      <header className="page__head">
        <div>
          <h1 className="page__title">Изменения API</h1>
          <p className="page__sub">Что менялось в API v1 и что сделать вашей интеграции.</p>
        </div>
      </header>

      <HowTo title="Как это устроено" sub="Что здесь публикуется" items={CHANGELOG_HOW_TO} />

      <ol className="changes">
        {API_CHANGES.map((change) => (
          <li key={`${change.date} ${change.title}`} className="card change">
            <div className="change__head">
              <time className="change__date" dateTime={change.date}>
                {changeDate(change.date)}
              </time>
              <span className="pill">{CHANGE_KIND_LABELS[change.kind]}</span>
              {change.breaking ? (
                <span className="pill pill--wait">ломает совместимость</span>
              ) : (
                <span className="pill pill--done">совместимо</span>
              )}
            </div>
            <h2 className="card__title">{change.title}</h2>
            <ul className="change__items">
              {change.items.map((item) => (
                <li key={item}>{inline(item)}</li>
              ))}
            </ul>
            <p className="change__action">
              <span className="change__label">Что сделать</span>
              {inline(change.action)}
            </p>
          </li>
        ))}
      </ol>
    </main>
  );
}

/** Обратные кавычки — кодом, как в документации. */
function inline(text: string): ReactNode {
  return text.split(/(`[^`]+`)/).map((part, index) =>
    part.startsWith('`') && part.endsWith('`') ? (
      <code key={index} className="mono op__code">
        {part.slice(1, -1)}
      </code>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    ),
  );
}
