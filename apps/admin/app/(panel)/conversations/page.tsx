import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CoreError } from '@nemo/core';
import { requireStaffActorOrNull } from '@/lib/auth/require-session';
import { getCore } from '@/lib/core';
import { pillClass } from '@/lib/labels';

export const dynamic = 'force-dynamic';

/**
 * Обращения клиентов.
 *
 * Список тех, с кем есть переписка, — ждущие ответа сверху и отмечены
 * пилюлей: менеджер должен видеть работу, не открывая каждый разговор.
 */
export default async function ConversationsPage() {
  const actor = await requireStaffActorOrNull();
  if (!actor) {
    redirect('/login');
  }

  try {
    const conversations = await getCore().listConversations(actor);

    return (
      <main className="page">
        <header className="page__head">
          <div>
            <h1 className="page__title">Обращения</h1>
            <p className="page__sub">
              Клиент пишет боту, ответ уходит туда же — тем ботом, которого он запускал.
            </p>
          </div>
          <span className="section__count">{conversations.length}</span>
        </header>

        {conversations.length === 0 ? (
          <p className="empty">Клиенты пока не писали.</p>
        ) : (
          <ul className="rows">
            {conversations.map((one) => (
              <li key={one.clientId.toString()} className="row row--hover">
                <div className="row__main">
                  <Link href={`/conversations/${one.clientId}`} className="row__title">
                    {one.username ? `@${one.username}` : `Клиент ${one.clientId}`}
                  </Link>
                  <span className="row__meta">{one.lastMessageBody ?? 'Изображение'}</span>
                </div>
                <div className="row__side">
                  {one.isUnanswered ? (
                    <span className={pillClass('wait')}>Ждёт ответа</span>
                  ) : undefined}
                  <span className="row__meta">
                    {new Date(one.lastMessageAt).toLocaleString('ru-RU')}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
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
