'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import type { MessageView } from '@nemo/core';
import { Dialog } from '@/app/ui/dialog';
import { LiveRefresh } from '@/app/ui/live-refresh';

/**
 * Переписка с клиентом и отправка ответа.
 *
 * Клиентский компонент ради одного: ответ уходит запросом и обновляет
 * ленту. Сама лента приходит с сервера готовой.
 *
 * Отдаёт наружу один узел, а не несколько подряд: страница кладёт его
 * в сетку рядом с карточкой клиента, и каждый лишний узел сетка
 * раскладывала бы по своей колонке.
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
  const [typing, setTyping] = useState(false);
  /*
   * Обработчик приходит в `Dialog` зависимостью эффекта: собранный
   * заново на каждый рендер, он звал бы этот эффект на каждую букву.
   */
  const onTyping = useCallback((value: boolean) => setTyping(value), []);

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
    <div className="split__main">
      {/*
        Лента слушает только свой разговор: сообщение другому менеджеру
        перерисовывало бы этот экран под курсором ни за чем.
      */}
      <LiveRefresh
        topic="conversations"
        clientId={clientId}
        busy={switching}
        typing={typing}
      />

      {error ? <p className="error">{error}</p> : undefined}

      <Dialog
        messages={messages}
        // Номер заявки уже в поле: клиент должен понимать, о какой
        // сделке речь, а менеджер — не искать его в соседней вкладке.
        // Вид номера тот же, в каком клиент видит его в приложении, —
        // иначе он ищет в своей истории строку, которой там нет.
        {...(requestId ? { draft: `По заявке № ${requestId.slice(0, 6)}: ` } : {})}
        onReply={reply}
        onTyping={onTyping}
        head={
          /*
           * Кто ведёт разговор — над лентой, а не под ней: решение
           * «отвечаю сам или оставляю помощнику» принимается до чтения.
           */
          <div className="chat__head">
            <span className={handedToHuman ? 'dot' : 'dot dot--off'} aria-hidden />
            <p className="chat__state">
              {handedToHuman
                ? 'Разговор ведёте вы: помощник в нём молчит.'
                : 'На первой линии помощник. Он передаст разговор, если понадобится.'}
            </p>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => void setHandover(!handedToHuman)}
            >
              {switching
                ? 'Переключаю…'
                : handedToHuman
                  ? 'Вернуть помощнику'
                  : 'Взять разговор себе'}
            </button>
          </div>
        }
      />
    </div>
  );
}
