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
  handedToHuman,
}: {
  clientId: string;
  messages: readonly MessageView[];
  /** Заявка, из карточки которой пришёл менеджер. */
  requestId?: string | undefined;
  /** Разговор ведёт человек: помощник в нём молчит. */
  handedToHuman: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [switching, setSwitching] = useState(false);

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

  /**
   * Передать разговор человеку или вернуть помощнику.
   *
   * Кнопка не гаснет на время запроса, а сообщает о работе подписью:
   * погашенная теряет фокус, и работающий с клавиатуры оказывается в
   * начале страницы. Повторное нажатие при этом не проходит — то же
   * состояние держит и его.
   */
  async function setHandover(toHuman: boolean) {
    if (switching) return;
    setSwitching(true);
    setError(undefined);
    try {
      const response = await fetch('/api/conversations/handover', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientId, toHuman }),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        setError(payload.error ?? 'Не удалось переключить');
        return;
      }
      router.refresh();
    } catch {
      setError('Не удалось связаться с сервером. Повторите попытку.');
    } finally {
      setSwitching(false);
    }
  }

  return (
    <>
      {error ? <p className="error">{error}</p> : undefined}

      <div className="handover">
        <p className="handover__state">
          {handedToHuman
            ? 'Разговор ведёте вы: помощник в нём молчит.'
            : 'На первой линии помощник. Он передаст разговор, если понадобится.'}
        </p>
        <button
          type="button"
          className="button button--ghost"
          onClick={() => void setHandover(!handedToHuman)}
        >
          {switching
            ? 'Переключаю…'
            : handedToHuman
              ? 'Вернуть помощнику'
              : 'Взять разговор себе'}
        </button>
      </div>

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
