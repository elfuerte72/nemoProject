import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CoreError, type ConversationView } from '@nemo/core';
import { requireStaffActorOrNull } from '@/lib/auth/require-session';
import { getCore } from '@/lib/core';
import { Moment } from '@/app/ui/moment';

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
export default async function ConversationsPage() {
  const actor = await requireStaffActorOrNull();
  if (!actor) {
    redirect('/login');
  }

  try {
    const conversations = await getCore().listConversations(actor);
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
        </header>

        <section className="section">
          <div className="section__head">
            <h2 className="section__title">Ждут ответа</h2>
            <span className="section__count">{waiting.length}</span>
            <span className="section__rule" />
          </div>
          <ConversationTable
            conversations={waiting}
            empty="Никто не ждёт ответа."
          />
        </section>

        {settled.length > 0 ? (
          <section className="section">
            <div className="section__head">
              <h2 className="section__title">Разобранные</h2>
              <span className="section__count">{settled.length}</span>
              <span className="section__rule" />
            </div>
            <ConversationTable conversations={settled} empty="Разобранных разговоров нет." />
          </section>
        ) : undefined}
      </main>
    );
  } catch (error) {
    if (error instanceof CoreError && error.code === 'forbidden') {
      return (
        <main className="page">
          <h1 className="page__title">Обращения</h1>
          <p className="empty">Раздел доступен сотрудникам.</p>
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
      <div className="table__head table--chats">
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
              <span className="cell" data-label="Клиент">
                <span className="cell__value">
                  {one.username ? `@${one.username}` : 'Без ника'}
                </span>
                <span className="cell__note">{one.clientId.toString()}</span>
              </span>
              <span className="cell" data-label="Последнее сообщение">
                <span className="cell__note">{one.lastMessageBody ?? 'Изображение'}</span>
              </span>
              <span className="cell" data-label="Состояние">
                {one.isUnanswered ? (
                  <span className="cell__value">Ждёт ответа</span>
                ) : (
                  <span className="cell__note">
                    {one.lastAuthorName ? `Ответил ${one.lastAuthorName}` : 'Отвечено'}
                  </span>
                )}
              </span>
              <span className="cell cell--num" data-label="Когда">
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
