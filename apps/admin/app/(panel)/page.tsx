import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ExchangeQueueFilter, ManagerExchangeRequestView } from '@nemo/core';
import { exchangeKinds, inProgressExchangeStatuses } from '@nemo/types';
import { requireStaffViewerOrNull } from '@/lib/auth/require-session';
import { getCore } from '@/lib/core';
import { panelCounts } from '@/lib/counts';
import { KIND_LABELS, STATUS_LABELS, STATUS_TONES } from '@/lib/exchange-request-labels';
import { formatAmount } from '@/lib/format';
import { pillClass } from '@/lib/labels';
import { Moment } from '@/app/ui/moment';
import { HowToRunRequest } from '@/app/ui/how-to';
import { Greeting } from '@/app/ui/greeting';
import { Icon } from '@/app/ui/icons';
import { Stat, Stats } from '@/app/ui/stat';
import { DeskHead } from './desk-head';

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
   * ищет его заявку — и она может оказаться в любом из них.
   * Состояние касается только заявок в работе: у очереди оно одно на
   * все строки, и «новая» там не фильтр, а определение.
   */
  const common: ExchangeQueueFilter = {
    ...(query ? { query } : {}),
    ...(kind ? { kind } : {}),
  };
  const working: ExchangeQueueFilter = {
    ...common,
    ...(status ? { status } : {}),
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
      core.listExchangeRequestsInProgress(actor, { ...working, mine: true }),
      core.listExchangeRequestQueue(actor, common),
      core.listExchangeRequestsInProgress(actor, { ...working, mine: false }),
      core.countExchangeRequestsInProgress(actor, { ...working, mine: true }),
      core.countExchangeRequestQueue(actor, common),
      core.countExchangeRequestsInProgress(actor, { ...working, mine: false }),
      // Те же четыре числа, что в меню, — из памяти запроса, не заново.
      panelCounts(actor),
      // Плитки — про весь сервис, а не про фильтр: сузив стол до одного
      // клиента, менеджер не должен прочитать «у меня в работе: 1».
      core.countExchangeRequestsInProgress(actor, { mine: true }),
      core.countExchangeRequestsInProgress(actor, { mine: false }),
    ]);

  return (
    <main className="page page--wide">
      <DeskHead
        fetchedAt={new Date().toISOString()}
        query={query}
        kind={kind ?? ''}
        status={status ?? ''}
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
        <ExchangeRequestList
          requests={mine}
          total={mineTotal}
          empty="За вами ничего не закреплено. Возьмите заявку из очереди — она встанет сюда."
        />
      </section>

      <section className="section" id="queue">
        <div className="section__head">
          <h2 className="section__title">Очередь</h2>
          <span className="section__count">{queueTotal}</span>
          <span className="section__rule" />
        </div>
        <ExchangeRequestList
          requests={queue}
          total={queueTotal}
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
        <ExchangeRequestList
          requests={others}
          total={othersTotal}
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

function ExchangeRequestList({
  requests,
  total,
  empty,
  showManager = false,
}: {
  requests: readonly ManagerExchangeRequestView[];
  /** Сколько строк всего: у выборки есть предел, и список бывает короче. */
  total: number;
  empty: string;
  /** Колонка «ведёт» — только там, где заявки чужие. */
  showManager?: boolean;
}) {
  if (requests.length === 0) {
    return <p className="empty">{empty}</p>;
  }

  const columns = showManager ? 'table--exchange-taken' : 'table--exchange';

  return (
    <>
      <div aria-hidden className={`table__head ${columns}`}>
        <span>Обмен</span>
        <span>Вид</span>
        <span>Клиент</span>
        <span>Состояние</span>
        {showManager ? <span>Ведёт</span> : undefined}
        <span>Подана</span>
      </div>
      <ul className={`table ${columns}`}>
        {requests.map((request) => (
          <li
            key={request.id}
            className={
              STATUS_TONES[request.status] === 'wait'
                ? 'table__item table__item--fresh'
                : 'table__item table__item--settled'
            }
          >
            {/*
              Ссылка — вся строка, а не сумма в ней: попадать курсором в
              четыре слова текста тридцать раз подряд менеджеру незачем.
            */}
            <Link href={`/exchange-requests/${request.id}`} className="table__row">
              {/*
                Обе стороны сделки: сумма к выдаче посчитана при подаче
                по курсу заявки — это то самое число, которое увидел
                клиент. У наличной заявки его нет: курс называет
                менеджер.
              */}
              <span className="cell cell--num">
                <span className="cell__label">Обмен</span>
                <span className="cell__value">
                  {formatAmount(request.fromAmount)} {request.fromCode} →{' '}
                  {request.toAmount ? `${formatAmount(request.toAmount)} ` : ''}
                  {request.toCode}
                </span>
              </span>
              <span className="cell">
                <span className="cell__label">Вид</span>
                <span className="cell__note">{KIND_LABELS[request.kind]}</span>
              </span>
              {/*
                Ник сверху, номер под ним: в очереди из десятка строк
                номера отличаются друг от друга только цифрами в
                середине, а ник читается сразу.
              */}
              <span className="cell">
                <span className="cell__label">Клиент</span>
                <span className="cell__value">
                  {request.clientUsername ? `@${request.clientUsername}` : 'Без ника'}
                </span>
                <span className="cell__note">{request.clientId.toString()}</span>
              </span>
              <span className="cell">
                <span className="cell__label">Состояние</span>
                <span className={pillClass(STATUS_TONES[request.status])}>
                  {STATUS_LABELS[request.status]}
                </span>
              </span>
              {/*
                Кто ведёт — не первой строкой карточки на узком экране:
                там сверху стоит сама сделка, а имя коллеги отвечает на
                второй вопрос, а не на первый.
              */}
              {showManager ? (
                <span className="cell">
                  <span className="cell__label">Ведёт</span>
                  <span className="cell__note">{request.assignedManagerName ?? '—'}</span>
                </span>
              ) : undefined}
              <span className="cell cell--num">
                <span className="cell__label">Подана</span>
                <span className="cell__note">
                  <Moment at={request.createdAt.toISOString()} />
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {/*
        Об усечении сказано прямо: список, молча обрезанный на полсотне,
        читается как весь — и по нему делают выводы о работе. Сузить его
        поиском или фильтром пока быстрее, чем листать.
      */}
      {requests.length < total ? (
        <p className="table__more">
          Показаны первые {requests.length} из {total}. Сузьте поиском или фильтром.
        </p>
      ) : undefined}
    </>
  );
}
