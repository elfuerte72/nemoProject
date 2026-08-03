import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { CoreError } from '@nemo/core';
import { requireStaffActorOrNull } from '@/lib/auth/require-session';
import { getCore } from '@/lib/core';
import { CopyValue } from '@/app/ui/copy';
import { Moment } from '@/app/ui/moment';
import { ConversationView } from './conversation-view';

export const dynamic = 'force-dynamic';

/**
 * Разговор с одним клиентом.
 *
 * Рядом с лентой — карточка того, с кем разговор: менеджер отвечает на
 * «у меня не работает», и знать, кто спрашивает и давно ли он в
 * сервисе, надо не уходя со страницы.
 *
 * Номер заявки может прийти в адресе: из карточки заявки менеджер
 * попадает сюда с уже подставленным номером, чтобы клиент понимал, о
 * какой сделке речь.
 */
export default async function ConversationPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireStaffActorOrNull();
  if (!actor) {
    redirect('/login');
  }

  const { clientId } = await params;
  // Идентификатор приходит из адреса, а его правит кто угодно: нечисловой
  // уронил бы `BigInt` и показал бы страницу аварии вместо разговора.
  if (!/^\d+$/.test(clientId)) {
    notFound();
  }

  const request = (await searchParams).request;
  const requestId = Array.isArray(request) ? request[0] : request;

  const core = getCore();
  const [messages, card] = await Promise.all([
    core.listConversation(actor, BigInt(clientId)),
    // Карточка не обязана существовать: писать боту может тот, кого ещё
    // не завели. Разговор из-за этого пропадать не должен.
    core.getClientCard(actor, BigInt(clientId)).catch((error: unknown) => {
      if (error instanceof CoreError && error.code === 'not-found') return null;
      throw error;
    }),
  ]);

  return (
    <main className="page page--wide">
      <Link href="/conversations" className="page__back">
        ← К обращениям
      </Link>

      <header className="page__head">
        <div>
          <h1 className="page__title">
            {card?.username ? `@${card.username}` : `Клиент ${clientId}`}
          </h1>
          <p className="page__sub">Ответ придёт клиенту в чат бота.</p>
        </div>
      </header>

      <div className="talk">
        <ConversationView
          clientId={clientId}
          messages={messages}
          {...(requestId ? { requestId } : {})}
        />

        <aside className="card who">
          <h2 className="card__title">Клиент</h2>

          <div className="field">
            <span className="label">Telegram</span>
            {card?.username ? (
              /*
                Ссылка ведёт по нику, а не по номеру: аккаунт по
                числовому идентификатору Telegram не открывает, и
                кнопка «перейти», которая никуда не ведёт, хуже её
                отсутствия. Без ника окликнуть человека можно только
                тем же ботом — то есть этой же перепиской.
              */
              <a
                className="who__link"
                href={`https://t.me/${card.username}`}
                target="_blank"
                rel="noreferrer noopener"
              >
                @{card.username} ↗
              </a>
            ) : (
              <span className="muted">Ника нет — пишет только через бота</span>
            )}
          </div>

          <div className="field">
            <span className="label">Идентификатор</span>
            <CopyValue value={clientId} />
          </div>

          {card ? (
            <>
              <div className="field">
                <span className="label">В сервисе с</span>
                <span>
                  <Moment at={card.createdAt.toISOString()} mode="day" />
                </span>
              </div>

              <div className="field">
                <span className="label">Пригласил</span>
                <span>
                  {card.referrerId
                    ? card.referrerUsername
                      ? `@${card.referrerUsername}`
                      : card.referrerId.toString()
                    : 'Пришёл сам'}
                </span>
              </div>

              <div className="field">
                <span className="label">Рассылка</span>
                <span>{card.marketingConsent ? 'Согласен' : 'Не согласен'}</span>
              </div>

              <div className="field">
                <span className="label">Реферальный код</span>
                <CopyValue value={card.referralCode} />
              </div>
            </>
          ) : (
            <p className="card__note">
              Клиент писал боту, но приложение ещё не открывал — профиля у него нет.
            </p>
          )}
        </aside>
      </div>
    </main>
  );
}
