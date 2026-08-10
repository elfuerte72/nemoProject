import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { CoreError } from '@nemo/core';
import { requireStaffActorOrNull } from '@/lib/auth/require-session';
import { getCore } from '@/lib/core';
import { ClientCard } from '@/app/ui/client-card';
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

      <div className="split">
        <ConversationView
          clientId={clientId}
          messages={messages}
          // Карточки может не быть у того, кто только что написал боту:
          // помощник в таком разговоре ведёт первую линию, как и везде.
          handedToHuman={card?.handedToHuman ?? false}
          {...(requestId ? { requestId } : {})}
        />

        <ClientCard
          clientId={clientId}
          client={
            card
              ? {
                  ...card,
                  telegramUserId: card.telegramUserId.toString(),
                  referrerId: card.referrerId?.toString() ?? null,
                  createdAt: card.createdAt.toISOString(),
                }
              : null
          }
        />
      </div>
    </main>
  );
}
