'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { MessageView } from '@nemo/core';
import { Dialog } from '@/app/ui/dialog';

/**
 * Переписка с клиентом и отправка ответа.
 *
 * Клиентский компонент ради одного: ответ уходит запросом и обновляет
 * ленту. Сама лента приходит с сервера готовой.
 */
export function ConversationView({
  clientId,
  messages,
  requestId,
}: {
  clientId: string;
  messages: readonly MessageView[];
  /** Заявка, из карточки которой пришёл менеджер. */
  requestId?: string | undefined;
}) {
  const router = useRouter();
  const [error, setError] = useState<string>();

  async function reply(body: string) {
    setError(undefined);
    try {
      const response = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          clientId,
          body,
          ...(requestId ? { exchangeRequestId: requestId } : {}),
        }),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        setError(payload.error ?? 'Ответ не отправлен');
        return;
      }
      router.refresh();
    } catch {
      setError('Не удалось связаться с сервером. Повторите попытку.');
    }
  }

  return (
    <>
      {error ? <p className="error">{error}</p> : undefined}
      <Dialog
        messages={messages}
        // Номер заявки уже в поле: клиент должен понимать, о какой
        // сделке речь, а менеджер — не искать его в соседней вкладке.
        // Вид номера тот же, в каком клиент видит его в приложении, —
        // иначе он ищет в своей истории строку, которой там нет.
        {...(requestId ? { draft: `По заявке № ${requestId.slice(0, 6)}: ` } : {})}
        onReply={reply}
      />
    </>
  );
}
