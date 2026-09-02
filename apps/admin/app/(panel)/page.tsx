import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { exchangeKinds, inProgressExchangeStatuses } from '@nemo/types';
import { requireStaffViewerOrNull } from '@/lib/auth/require-session';
import { getCore } from '@/lib/core';
import { panelCounts } from '@/lib/counts';
import { coreFilterFor, toExchangeRow, type DeskFilter } from '@/lib/exchange-rows';
import { HowToRunRequest } from '@/app/ui/how-to';
import { Greeting } from '@/app/ui/greeting';
import { Icon } from '@/app/ui/icons';
import { Stat, Stats } from '@/app/ui/stat';
import { TABLE_PREFS_COOKIE, readTablePrefs } from '@/lib/table-prefs';
import { DeskHead } from './desk-head';
import { ExchangeTable } from './exchange-table';
import { TablePrefsSheet } from './table-prefs-sheet';

export const dynamic = 'force-dynamic';

/**
 * Рабочий стол менеджера: что моё, что ничьё и что у коллег.
 *
 * Порядок разделов повторяет порядок вопросов смены. Первый — «что
 * моё»: незакрытая заявка, которую ведёт этот менеджер, ждёт именно
 * его. Второй — «что ничьё»: очередь общая, и заявку ведёт тот, кто
 * взял её первым. Третий — «что у коллег»: это не работа, а обзор, и
 * потому он последний.
 *
 * Свои и чужие разделены выборкой, а не отметкой в строке: один и тот
 * же ряд, показанный в двух списках, читается как две заявки.
 */
export default async function DeskPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireStaffViewerOrNull();
  if (!viewer) {
    redirect('/login');
  }
  const { actor, displayName } = viewer;

  const params = await searchParams;
  // Личные настройки таблицы — из куки этого сотрудника; чужая или испорченная — по умолчанию.
  const prefs = readTablePrefs((await cookies()).get(TABLE_PREFS_COOKIE)?.value, actor.staffId);
  const query = single(params.q);
  const kind = pick(single(params.kind), exchangeKinds);
  /*
   * Состояния — только те, что бывают у заявки в работе: тот же набор,
   * из которого выбирает фильтр на экране. Иначе `?status=completed` из
   * адресной строки давал бы пустой экран и выбор без совпадающей
   * строки.
   */
  const status = pick(single(params.status), inProgressExchangeStatuses);

  /*
   * Одно сужение на все три списка: менеджер, набравший ник клиента,
   * ищет его заявку — и она может оказаться в любом из них. Как оно
   * превращается в фильтр ядра для каждого раздела, знает
   * `coreFilterFor` — та же функция, что у маршрута дочитывания.
   */
  const filter: DeskFilter = { q: query, kind: kind ?? '', status: status ?? '' };
  const limit = prefs.pageSize;
  const common = { ...coreFilterFor('queue', filter), limit };
  const working = {
    mine: { ...coreFilterFor('mine', filter), limit },
    others: { ...coreFilterFor('others', filter), limit },
  };

  const core = getCore();
  /*
   * Счётчик считает весь список, а выборка отдаёт страницу: у выборки
   * есть предел, и счётчик по её длине показывал бы «50» и на
   * пятидесяти заявках, и на пятистах. По этому числу решают, за что
   * браться, — врать оно не должно.
   */
  const [mine, queue, others, mineTotal, queueTotal, othersTotal, counts, mineAll, othersAll] =
    await Promise.all([
      core.listExchangeRequestsInProgress(actor, working.mine),
      core.listExchangeRequestQueue(actor, common),
      core.listExchangeRequestsInProgress(actor, working.others),
      core.countExchangeRequestsInProgress(actor, coreFilterFor('mine', filter)),
      core.countExchangeRequestQueue(actor, coreFilterFor('queue', filter)),
      core.countExchangeRequestsInProgress(actor, coreFilterFor('others', filter)),
      // Те же четыре числа, что в меню, — из памяти запроса, не заново.
      panelCounts(actor),
      // Плитки — про весь сервис, а не про фильтр: сузив стол до одного
      // клиента, менеджер не должен прочитать «у меня в работе: 1».
      core.countExchangeRequestsInProgress(actor, { mine: true }),
      core.countExchangeRequestsInProgress(actor, { mine: false }),
    ]);

  // Ключ списка: сменился фильтр — дочитанный хвост сбрасывается.
  const signature = `${filter.q}|${filter.kind}|${filter.status}`;

  return (
    <main className="page page--wide">
      <DeskHead
        fetchedAt={new Date().toISOString()}
        query={query}
        kind={kind ?? ''}
        status={status ?? ''}
        tools={<TablePrefsSheet prefs={prefs} staffId={actor.staffId} />}
        heading={
          <div>
            <Greeting name={displayName} />
            <p className="page__sub">Очередь общая: заявку ведёт тот, кто взял её первым.</p>
          </div>
        }
        overview={
          <>
            {/*
        Обзор над столом, а не вместо него: плитки отвечают на «как дела»,
        а стол — на «за что браться», и второй вопрос важнее. Числа те
        же, что в меню; отфильтрованный стол их не меняет — они про весь
        сервис, и подпись под ними говорит об этом прямо.
      */}
            <Stats>
              <Stat
                label="Ждут в очереди"
                value={counts.exchange}
                note={counts.exchange ? 'ничьи — возьмите первым' : 'новых заявок нет'}
                tone={counts.exchange ? 'wait' : 'plain'}
                href="/#queue"
              />
              <Stat
                label="У меня в работе"
                value={mineAll}
                note={mineAll ? 'ждут вашего шага' : 'ничего не закреплено'}
                tone={mineAll ? 'up' : 'plain'}
                href="/#mine"
              />
              <Stat
                label="У коллег"
                value={othersAll}
                note={othersAll ? 'в работе у других' : 'коллеги ничего не ведут'}
                href="/#others"
              />
              <Stat
                label="Без ответа"
                value={counts.conversations}
                note={
                  counts.conversations ? 'обращений, клиент ждёт в чате' : 'все обращения отвечены'
                }
                tone={counts.conversations ? 'wait' : 'plain'}
                href="/conversations"
              />
              <Stat
                label="Выводов ждут"
                value={counts.withdrawals}
                note={counts.withdrawals ? 'баллы к выплате' : 'открытых заявок нет'}
                tone={counts.withdrawals ? 'wait' : 'plain'}
                href="/withdrawals"
              />
              <Stat
                label="Карт ждут"
                value={counts.cards}
                note={counts.cards ? 'заявки на карту' : 'открытых заявок нет'}
                tone={counts.cards ? 'wait' : 'plain'}
                href="/card-applications"
              />
            </Stats>

            <nav className="quick" aria-label="Быстрые переходы">
              <Link href="/conversations" className="quick__link">
                <Icon name="chat" size={15} />
                Обращения
              </Link>
              <Link href="/withdrawals" className="quick__link">
                <Icon name="withdrawal" size={15} />
                Вывод баллов
              </Link>
              <Link href="/card-applications" className="quick__link">
                <Icon name="card" size={15} />
                Карты
              </Link>
              <Link href="/service-accounts" className="quick__link">
                <Icon name="account" size={15} />
                Счета сервиса <span className="quick__note">администратор</span>
              </Link>
              <Link href="/settings" className="quick__link">
                <Icon name="settings" size={15} />
                Настройки <span className="quick__note">администратор</span>
              </Link>
            </nav>
          </>
        }
      />

      <section className="section" id="mine">
        <div className="section__head">
          <h2 className="section__title">Мои</h2>
          <span className="section__count">{mineTotal}</span>
          <span className="section__rule" />
        </div>
        <ExchangeTable
          key={`mine:${signature}`}
          rows={mine.map(toExchangeRow)}
          total={mineTotal}
          scope="mine"
          filter={filter}
          prefs={prefs}
          empty="За вами ничего не закреплено. Возьмите заявку из очереди — она встанет сюда."
        />
      </section>

      <section className="section" id="queue">
        <div className="section__head">
          <h2 className="section__title">Очередь</h2>
          <span className="section__count">{queueTotal}</span>
          <span className="section__rule" />
        </div>
        <ExchangeTable
          key={`queue:${signature}`}
          rows={queue.map(toExchangeRow)}
          total={queueTotal}
          scope="queue"
          filter={filter}
          prefs={prefs}
          empty="Новых заявок нет. Появится — встанет здесь; экран перечитывает очередь сам."
        />
        {/*
          Памятка стоит под очередью, а не поверх экрана: свободная
          минута у менеджера ровно тогда, когда брать нечего, — и
          читают её в эту минуту.
        */}
        <HowToRunRequest />
      </section>

      <section className="section" id="others">
        <div className="section__head">
          <h2 className="section__title">У коллег</h2>
          <span className="section__count">{othersTotal}</span>
          <span className="section__rule" />
        </div>
        <ExchangeTable
          key={`others:${signature}`}
          rows={others.map(toExchangeRow)}
          total={othersTotal}
          scope="others"
          filter={filter}
          prefs={prefs}
          empty="Коллеги ничего не ведут — вся работа либо у вас, либо ещё в очереди."
          showManager
        />
      </section>
    </main>
  );
}

/** Значение параметра адреса: повторённый параметр берётся первым. */
function single(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? '';
}

/**
 * Значение из известного набора. Незнакомое отбрасывается молча:
 * параметр приходит из адресной строки, и отказом на опечатку в ней
 * менеджеру отвечать незачем — он увидит очередь без фильтра.
 */
function pick<T extends string>(value: string, allowed: readonly T[]): T | undefined {
  return (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}
