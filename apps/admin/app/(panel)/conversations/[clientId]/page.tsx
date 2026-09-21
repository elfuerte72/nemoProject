import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isCoreError } from '@nemo/http';
import { parseTelegramUserId } from '@nemo/types';
import { requireStaffPage } from '@/lib/auth/require-session';
import { toClientCardData } from '@/lib/client-card';
import { getCore } from '@/lib/core';
import { ClientCard } from '@/app/ui/client-card';
import { ConversationView } from '@/app/ui/conversation-view';

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
  const { actor } = await requireStaffPage();

  const { clientId } = await params;
  // Идентификатор приходит из адреса, а его правит кто угодно: нечисловой
  // уронил бы `BigInt`, а длиннее bigint — запрос к базе, и вместо
  // разговора была бы страница аварии.
  const telegramUserId = parseTelegramUserId(clientId);
  if (telegramUserId === null) {
    notFound();
  }

  const request = (await searchParams).request;
  const requestId = Array.isArray(request) ? request[0] : request;

  const core = getCore();
  const [messages, card] = await Promise.all([
    core.listConversation(actor, telegramUserId),
    // Карточка не обязана существовать: писать боту может тот, кого ещё
    // не завели. Разговор из-за этого пропадать не должен.
    core.getClientCard(actor, telegramUserId).catch((error: unknown) => {
      if (isCoreError(error) && error.code === 'not-found') return null;
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

        <ClientCard clientId={clientId} client={card ? toClientCardData(card) : null} />
      </div>
    </main>
  );
}
