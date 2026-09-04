import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  CoreError,
  WAITING_CLIENT_MINUTES,
  type ConversationTopicFilter,
  type ConversationView,
} from '@nemo/core';
import { requireStaffActorOrNull } from '@/lib/auth/require-session';
import { getCore } from '@/lib/core';
import { INQUIRY_TOPIC_LABELS, pillClass } from '@/lib/labels';
import { Moment } from '@/app/ui/moment';
import { TopicFilter } from './topic-filter';

export const dynamic = 'force-dynamic';

/**
 * Обращения клиентов.
 *
 * Список разделён на то, что ждёт ответа, и то, что уже разобрано:
 * очередь общая, и первый вопрос менеджера — не «кто писал», а «где я
 * нужен». Порядок внутри — тот, что задаёт ядро: последнее сообщение
 * сверху.
 *
 * Отдельного «прочитано» здесь нет и не выводится: панель не знает,
 * читал ли менеджер разговор, — она знает, ответил ли кто-то. Отметка
 * о прочтении, которую никто не ставит, врала бы о состоянии работы.
 */
export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireStaffActorOrNull();
  if (!actor) {
    redirect('/login');
  }

  const params = await searchParams;
  const asked = (Array.isArray(params.topic) ? params.topic[0] : params.topic) ?? '';
  // Незнакомая тема отбрасывается молча: параметр приходит из адресной
  // строки, и отказом на опечатку в ней менеджеру отвечать незачем.
  const topic: ConversationTopicFilter | undefined =
    asked === 'support' || asked === 'payment' ? asked : undefined;

  try {
    const conversations = await getCore().listConversations(
      actor,
      topic ? { topic } : {},
    );
    const waiting = conversations.filter((one) => one.isUnanswered);
    const settled = conversations.filter((one) => !one.isUnanswered);

    return (
      <main className="page page--wide">
        <header className="page__head">
          <div>
            <h1 className="page__title">Обращения</h1>
            <p className="page__sub">
              Клиент пишет боту, ответ уходит туда же — тем ботом, которого он запускал.
            </p>
          </div>
          <TopicFilter topic={topic ?? ''} />
        </header>

        {/*
          Подписки спрашивают здесь же, а ведёт их партнёр — и менеджеру
          на этот вопрос отвечать нечем, кроме адреса. Подсказка стоит
          рядом с работой, а не в вики: вики расходится с интерфейсом
          через месяц.
        */}
        <p className="card__note">
          Спросили про подписку — это «Оплатишка», отдельный сервис того же владельца:
          ведите клиента в её бот <code className="mono">@oplatishkaa_bot</code>. Про
          иностранную карту тоже отвечать не нужно: у неё своя заявка, и она видна в
          разделе «Карты».
        </p>

        <section className="section">
          <div className="section__head">
            <h2 className="section__title">Ждут ответа</h2>
            <span className="section__count">{waiting.length}</span>
            <span className="section__rule" />
          </div>
          <ConversationTable
            conversations={waiting}
            empty="Никто не ждёт ответа. Клиент напишет боту — разговор встанет сюда, и в Telegram придёт уведомление."
          />
        </section>

        {settled.length > 0 ? (
          <section className="section">
            <div className="section__head">
              <h2 className="section__title">Разобранные</h2>
              <span className="section__count">{settled.length}</span>
              <span className="section__rule" />
            </div>
            <ConversationTable conversations={settled} empty="Разобранных разговоров нет: сюда уходят те, на которые уже ответили." />
          </section>
        ) : undefined}
      </main>
    );
  } catch (error) {
    if (error instanceof CoreError && error.code === 'forbidden') {
      return (
        <main className="page">
          <h1 className="page__title">Обращения</h1>
          <p className="empty">
            Раздел доступен сотрудникам: сюда приходят сообщения клиентов, и отвечает на них
            тот, кто вошёл в панель.
          </p>
        </main>
      );
    }
    throw error;
  }
}

function ConversationTable({
  conversations,
  empty,
}: {
  conversations: readonly ConversationView[];
  empty: string;
}) {
  if (conversations.length === 0) {
    return <p className="empty">{empty}</p>;
  }

  return (
    <>
      <div aria-hidden className="table__head table--chats">
        <span />
        <span>Клиент</span>
        <span>Последнее сообщение</span>
        <span>Состояние</span>
        <span>Когда</span>
      </div>
      <ul className="table table--chats">
        {conversations.map((one) => (
          <li
            key={one.clientId.toString()}
            className={
              one.isUnanswered ? 'table__item table__item--fresh' : 'table__item table__item--settled'
            }
          >
            {/*
              Ссылка — вся строка, а не имя в ней: имя короткое, строка
              широкая, и выцеливать курсором надпись менеджеру незачем.
            */}
            <Link href={`/conversations/${one.clientId}`} className="table__row">
              <span className={one.isUnanswered ? 'dot' : 'dot dot--off'} aria-hidden />
              {/*
                Имя и номер — обе строки всегда: у клиента без ника
                строка иначе становится ниже соседних, и список
                перестаёт читаться столбцом.
              */}
              <span className="cell">
                <span className="cell__label">Клиент</span>
                <span className="cell__value">
                  {one.username ? `@${one.username}` : 'Без ника'}
                </span>
                <span className="cell__note">{one.clientId.toString()}</span>
              </span>
              {/*
                Тема — впереди текста: просьба про деньги отличается от
                «а какой курс» до того, как менеджер прочитал строку.
              */}
              <span className="cell">
                <span className="cell__label">Последнее сообщение</span>
                {one.topic ? (
                  <span className={pillClass('wait')}>{INQUIRY_TOPIC_LABELS[one.topic]}</span>
                ) : undefined}
                <span className="cell__note">{one.lastMessageBody ?? one.lastAttachment}</span>
              </span>
              <span className="cell">
                <span className="cell__label">Состояние</span>
                {one.isUnanswered ? (
                  /*
                    Сколько ждёт — рядом с состоянием, и тем же порогом,
                    по которому сотрудникам уходит напоминание в
                    Telegram: просроченное горит золотом и в панели.
                    Минуты считает сервер на каждой перерисовке — экран
                    перечитывается сам раз в полминуты.
                  */
                  <span
                    className={
                      waitedMinutes(one.lastMessageAt) >= WAITING_CLIENT_MINUTES
                        ? 'cell__value cell__value--late'
                        : 'cell__value'
                    }
                  >
                    Ждёт ответа · {waitedMinutes(one.lastMessageAt)} мин
                  </span>
                ) : (
                  <span className="cell__note">
                    {one.lastAuthorName ? `Ответил ${one.lastAuthorName}` : 'Отвечено'}
                  </span>
                )}
                {/*
                  Кем занят разговор. Здесь, а не отдельной колонкой:
                  вопрос «кто отвечает» — тот же, что и «отвечено ли», и
                  разносить их значило бы спрашивать дважды об одном.
                */}
                <span className="cell__note">
                  {one.handedToHuman ? 'Ведёт менеджер' : 'На помощнике'}
                </span>
              </span>
              <span className="cell cell--num">
                <span className="cell__label">Когда</span>
                <span className="cell__note">
                  <Moment at={one.lastMessageAt.toISOString()} />
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Сколько минут прошло с сообщения: разница времён, пояс не нужен. */
function waitedMinutes(since: Date): number {
  return Math.max(0, Math.floor((Date.now() - since.getTime()) / 60_000));
}
