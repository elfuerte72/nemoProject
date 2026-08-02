import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireStaffActorOrNull } from '@/lib/auth/require-session';
import { getCore } from '@/lib/core';
import { ConversationView } from './conversation-view';

export const dynamic = 'force-dynamic';

/**
 * Разговор с одним клиентом.
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

  const messages = await getCore().listConversation(actor, BigInt(clientId));

  return (
    <main className="page page--narrow">
      <Link href="/conversations" className="page__back">
        ← К обращениям
      </Link>

      <header className="page__head">
        <div>
          <h1 className="page__title">Клиент {clientId}</h1>
          <p className="page__sub">Ответ придёт клиенту в чат бота.</p>
        </div>
      </header>

      <ConversationView
        clientId={clientId}
        messages={messages}
        {...(requestId ? { requestId } : {})}
      />
    </main>
  );
}
