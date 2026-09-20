'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import type { MessageView } from '@nemo/core';
import { Dialog } from '@/app/ui/dialog';
import { LiveRefresh } from '@/app/ui/live-refresh';
import { sendOutcome, type SendOutcome } from '@/lib/send-outcome';

/**
 * Переписка с клиентом и отправка ответа.
 *
 * Клиентский компонент ради одного: ответ уходит запросом и обновляет
 * ленту. Сама лента приходит с сервера готовой.
 *
 * Отдаёт наружу один узел, а не несколько подряд: страница кладёт его
 * в сетку рядом с карточкой клиента, и каждый лишний узел сетка
 * раскладывала бы по своей колонке.
 *
 * Стоит он на двух экранах — в разделе «Обращения» и в карточке заявки,
 * — и потому лежит в общих деталях панели, а не в папке раздела.
 * Отличаются они местом и тем, кто слушает события: в карточке колонку
 * задаёт она сама, а поток событий там один на оба своих предмета.
 */
export function ConversationView({
  clientId,
  messages,
  requestId,
  handedToHuman,
  inline = false,
  listens = true,
  onTypingChange,
  onBusyChange,
}: {
  clientId: string;
  messages: readonly MessageView[];
  /** Заявка, из карточки которой пришёл менеджер. */
  requestId?: string | undefined;
  /** Разговор ведёт человек: помощник в нём молчит. */
  handedToHuman: boolean;
  /**
   * Лента стоит внутри чужого экрана: колонку и высоту задаёт он.
   * На своём экране разговор занимает всё, что осталось от окна, — в
   * карточке заявки он один из блоков работы, и в полный экран отодвинул
   * бы историю заявки на вторую прокрутку.
   */
  inline?: boolean;
  /**
   * Слушать события самому. На чужом экране — нет: там поток один, и
   * открывает его хозяин экрана, иначе вкладка держала бы два сокета.
   */
  listens?: boolean;
  /**
   * В поле ответа набирают. Наружу — хозяину экрана: обновление, пришедшее
   * посреди набранного, отнимает у менеджера написанное клиенту.
   */
  onTypingChange?: ((typing: boolean) => void) | undefined;
  /**
   * Идёт собственное действие ленты — переключение первой линии.
   * Наружу по той же причине, что и набор: обновление, пришедшее
   * посреди него, показало бы состояние до нажатия.
   */
  onBusyChange?: ((busy: boolean) => void) | undefined;
}) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [switching, setSwitching] = useState(false);
  const [typing, setTyping] = useState(false);
  /*
   * Обработчик приходит в `Dialog` зависимостью эффекта: собранный
   * заново на каждый рендер, он звал бы этот эффект на каждую букву.
   */
  const onTyping = useCallback(
    (value: boolean) => {
      setTyping(value);
      onTypingChange?.(value);
    },
    [onTypingChange],
  );

  /*
   * Переключение первой линии — такое же собственное действие, как
   * ответ: обновление поверх него показало бы прежнее состояние
   * разговора. На своём экране его придерживает здешний `LiveRefresh`,
   * внутри чужого — хозяин экрана, и знать о нём он может только
   * отсюда.
   */
  function switchingChanged(value: boolean): void {
    setSwitching(value);
    onBusyChange?.(value);
  }

  /**
   * Отправить ответ словами. Отказ не печатается здесь, над лентой, а
   * уходит исходом в `Dialog`: там он встаёт у поля, и там же остаётся
   * набранное.
   */
  async function reply(body: string): Promise<SendOutcome> {
    setError(undefined);
    const outcome = await sendOutcome(
      () =>
        fetch('/api/conversations', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            clientId,
            body,
            ...(requestId ? { exchangeRequestId: requestId } : {}),
          }),
        }),
      'Ответ не отправлен',
    );
    if (outcome.sent) router.refresh();
    return outcome;
  }

  /**
   * Отправить клиенту файл.
   *
   * Уходит он не тем же запросом, что ответ словами: файл едет телом
   * формы, а не строкой JSON, и путь у него свой. Слова из поля идут
   * подписью к файлу — вторым сообщением тот же текст читался бы
   * повтором.
   */
  async function sendFile(file: File, text: string): Promise<SendOutcome> {
    setError(undefined);
    const form = new FormData();
    form.set('clientId', clientId);
    form.set('file', file, file.name);
    if (text) form.set('body', text);
    if (requestId) form.set('exchangeRequestId', requestId);

    const outcome = await sendOutcome(
      () => fetch('/api/conversations/attachments', { method: 'POST', body: form }),
      'Файл не отправлен',
    );
    if (outcome.sent) router.refresh();
    return outcome;
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
    switchingChanged(true);
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
      switchingChanged(false);
    }
  }

  return (
    <div className={inline ? 'chat-block' : 'split__main'}>
      {/*
        Лента слушает только свой разговор: сообщение другому менеджеру
        перерисовывало бы этот экран под курсором ни за чем. Внутри
        чужого экрана не слушает вовсе — там поток открывает хозяин.
      */}
      {listens ? (
        <LiveRefresh
          topic="conversations"
          clientId={clientId}
          busy={switching}
          typing={typing}
        />
      ) : undefined}

      {/* Отказ переключения — над лентой, у кнопки в её шапке. */}
      {error ? <p className="error">{error}</p> : undefined}

      <Dialog
        inline={inline}
        messages={messages}
        // Номер заявки уже в поле: клиент должен понимать, о какой
        // сделке речь, а менеджер — не искать его в соседней вкладке.
        // Вид номера тот же, в каком клиент видит его в приложении, —
        // иначе он ищет в своей истории строку, которой там нет.
        {...(requestId ? { draft: `По заявке № ${requestId.slice(0, 6)}: ` } : {})}
        onReply={reply}
        onSendFile={sendFile}
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
