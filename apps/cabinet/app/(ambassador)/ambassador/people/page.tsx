import Link from 'next/link';
import type { Metadata } from 'next';
import { EmptyState, HowTo, Moment } from '@nemo/ui';
import { formatAmount } from '@nemo/ui/format';
import { referralLineTitle } from '@nemo/types';
import { readPeopleQuery } from '@/lib/ambassador-params';
import { AMBASSADOR_PEOPLE_HOW_TO } from '@/lib/ambassador-texts';
import { ambassadorAccount, ambassadorPage } from '@/lib/ambassador-reads';
import { getCore } from '@/lib/core';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Мои люди — кабинет амбассадора' };

/** Сколько строк на страницу: столько же берёт ядро по умолчанию. */
const PAGE = 50;

/**
 * Приведённые — обезличенным списком.
 *
 * Ни имени, ни ника, ни идентификатора: то, что человек привёл
 * клиента, не даёт ему права знать, кто этот клиент и на что он меняет
 * деньги. Строка отвечает на то, что амбассадору знать положено: когда
 * пришёл, какой линии, обменивал ли и сколько принёс.
 *
 * Листается смещением, а не курсором: курсор нёс бы идентификатор
 * реферала — ровно то, чего в этом списке быть не должно.
 */
export default async function AmbassadorPeople({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { actor } = await ambassadorPage();
  /*
   * Линия и смещение из адреса чинятся здесь, а не отказом ядра:
   * параметр приходит из адресной строки, и «-1», «1e300» или девятая
   * линия должны показать список, а не страницу аварии.
   */
  const { line, offset } = readPeopleQuery(await searchParams);

  const [page, account] = await Promise.all([
    getCore().listMyReferrals(actor, {
      ...(line ? { line } : {}),
      offset,
      limit: PAGE,
    }),
    // Линии берутся из счёта, а не перечисляются здесь: чипов должно
    // быть столько, сколько линий оплачивает программа, — предлагать
    // пятую там, где платят за две, значит обещать деньги за неё.
    ambassadorAccount(),
  ]);

  const query = (next: { line?: number | undefined; offset?: number | undefined }) => {
    const search = new URLSearchParams();
    const chosen = next.line ?? line;
    if (chosen) search.set('line', String(chosen));
    if (next.offset) search.set('offset', String(next.offset));
    const text = search.toString();
    return text ? `/ambassador/people?${text}` : '/ambassador/people';
  };

  return (
    <main className="page">
      <header className="page__head">
        <div>
          <h1 className="page__title">Мои люди</h1>
          <p className="page__sub">
            {page.total > 0
              ? `${page.total} приведённых по оплачиваемым линиям`
              : 'Приведённых пока нет'}
          </p>
        </div>
      </header>

      <HowTo
        title="Что здесь показано"
        sub="Обезличенный список и что значит «активный»"
        items={AMBASSADOR_PEOPLE_HOW_TO}
      />

      <div className="chips">
        <Link href={query({ line: 0 })} className={line ? 'chip' : 'chip chip--on'}>
          Все линии
        </Link>
        {account.lines.map((one) => (
          <Link
            key={one.line}
            href={`/ambassador/people?line=${one.line}`}
            className={line === one.line ? 'chip chip--on' : 'chip'}
          >
            {referralLineTitle(one.line)} линия
          </Link>
        ))}
      </div>

      {page.items.length ? (
        <section className="card">
          <div className="scroll-x">
            <table className="datatable">
              <thead>
                <tr>
                  <th>Пришёл</th>
                  <th>Линия</th>
                  <th>Обменивал</th>
                  <th className="num">Заявок</th>
                  <th className="num">Принёс</th>
                </tr>
              </thead>
              <tbody>
                {/*
                  Ключ — место в списке: имени и идентификатора у
                  строки нет намеренно, а дата с линией у двоих
                  совпадают, если их привязали в одну миллисекунду.
                */}
                {page.items.map((row, at) => (
                  <tr key={offset + at}>
                    <td>
                      <Moment at={row.joinedAt.toISOString()} mode="day" />
                    </td>
                    <td>{referralLineTitle(row.line)}</td>
                    <td>
                      {row.active && row.lastExchangeAt ? (
                        <Moment at={row.lastExchangeAt.toISOString()} mode="day" />
                      ) : (
                        <span className="muted">ещё нет</span>
                      )}
                    </td>
                    <td className="num">{row.completedCount}</td>
                    <td className="num">{formatAmount(row.brought)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {page.nextOffset === null ? undefined : (
            <div className="actions">
              <Link href={query({ offset: page.nextOffset })} className="btn btn--ghost">
                Показать ещё
              </Link>
            </div>
          )}
        </section>
      ) : offset > 0 && page.total > 0 ? (
        /*
         * Смещение за концом списка — из старой ссылки или набранное
         * руками. «Приведённых пока нет» здесь было бы неправдой: они
         * есть, просто раньше.
         */
        <EmptyState
          icon="user"
          title="Дальше никого"
          text="Список кончился раньше этой страницы."
          action={
            <Link href={query({ offset: 0 })} className="btn btn--soft">
              К началу списка
            </Link>
          }
        />
      ) : (
        <EmptyState
          icon="user"
          title={line ? 'На этой линии никого' : 'Приведённых пока нет'}
          text={
            line
              ? 'Вторая линия набирается сама: она появится, когда ваши люди позовут своих.'
              : 'Поставьте ссылку туда, где вас читают, — она в разделе «Ссылка».'
          }
        />
      )}
    </main>
  );
}
