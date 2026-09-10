import type { Metadata } from 'next';
import { CopyValue, EmptyState, HowTo } from '@nemo/ui';
import { formatAmount } from '@nemo/ui/format';
import { AMBASSADOR_LINK_HOW_TO } from '@/lib/ambassador-texts';
import { ambassadorAccount, ambassadorPage } from '@/lib/ambassador-reads';
import { referralLink, shareLink } from '@/lib/referral-link';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Ссылка — кабинет амбассадора' };

/**
 * Реферальная ссылка: скопировать и переслать.
 *
 * Промокодов здесь нет: они отложены (`backlog.md`) — у канала с
 * аудиторией ссылка в закреплённом сообщении работает лучше слова,
 * которое надо не забыть ввести.
 *
 * Ставки линий показаны рядом: программа, условий которой не видно, не
 * работает — звать людей, не зная, сколько за это платят, никто не
 * станет.
 */
export default async function AmbassadorLink() {
  await ambassadorPage();
  const account = await ambassadorAccount();
  const link = referralLink(account.referralCode);

  return (
    <main className="page">
      <header className="page__head">
        <div>
          <h1 className="page__title">Ссылка</h1>
          <p className="page__sub">По ней приходят те, кто станет вашей первой линией</p>
        </div>
      </header>

      <HowTo
        title="Как это работает"
        sub="Привязка и где ставить ссылку"
        items={AMBASSADOR_LINK_HOW_TO}
      />

      {link ? (
        <section className="card">
          <h2 className="card__title">Ваша ссылка</h2>
          <p className="card__note">Открывается в Telegram — ставить ничего не нужно</p>
          <CopyValue value={link} />
          <div className="actions">
            <a
              className="btn btn--gold"
              href={shareLink(link)}
              target="_blank"
              rel="noreferrer noopener"
            >
              Поделиться в Telegram
            </a>
          </div>
        </section>
      ) : (
        <EmptyState
          icon="spark"
          title="Ссылку пока не собрать"
          text="Имя бота не задано на этом адресе — напишите нам, и мы это поправим."
        />
      )}

      <section className="card">
        <h2 className="card__title">Ваши ставки</h2>
        <p className="card__note">Доля от заработка сервиса на заявке — по каждой линии</p>
        <div className="scroll-x">
          <table className="datatable">
            <thead>
              <tr>
                <th>Линия</th>
                <th className="num">Ставка</th>
                <th className="num">Приведено</th>
              </tr>
            </thead>
            <tbody>
              {account.lines.map((line) => (
                <tr key={line.line}>
                  <td>{line.line} линия</td>
                  <td className="num">{(line.rateBps / 100).toString().replace('.', ',')} %</td>
                  <td className="num">{line.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="card__note">
          Заработано за всё время: {formatAmount(account.earned)}. Ставку меняет менеджер — с ним
          же о ней и договариваются.
        </p>
      </section>
    </main>
  );
}
