'use client';

import { useState } from 'react';
import type { MessageView } from '@nemo/core';
import { Moment } from '@/app/ui/moment';

/**
 * Диалоговое окно переписки.
 *
 * Разговор читают, а не расшифровывают список строк: стороны разведены
 * по краям, у ответа виден автор — менеджер должен понимать, писал ли
 * коллега, прежде чем писать своё поверх.
 *
 * Тот же компонент показывает предпросмотр заготовок в настройках:
 * администратор, правящий формулировку, видит её так, как прочтёт
 * клиент. Поэтому поле ответа необязательно — предпросмотру отвечать
 * некому.
 */
export function Dialog({
  messages,
  draft,
  onReply,
}: {
  readonly messages: readonly MessageView[];
  /** Что уже стоит в поле ответа: номер заявки, если писать из карточки. */
  readonly draft?: string | undefined;
  readonly onReply?: ((body: string) => Promise<void>) | undefined;
}) {
  const [body, setBody] = useState(draft ?? '');
  const [busy, setBusy] = useState(false);

  async function send() {
    if (!onReply) return;
    setBusy(true);
    try {
      await onReply(body.trim());
      setBody('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dialog">
      <div className="dialog__feed">
        {messages.length === 0 ? (
          <p className="empty">Переписки пока нет — напишите первым, если есть что уточнить.</p>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={[
                'bubble',
                message.direction === 'incoming' ? 'bubble--in' : 'bubble--out',
                // Ответ помощника отличается от ответа человека: менеджер
                // читает разговор подряд и должен видеть, что клиенту
                // говорил не он.
                message.byConcierge ? 'bubble--concierge' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {message.body ? <span className="bubble__text">{message.body}</span> : undefined}
              {message.hasAttachment ? <Attachment messageId={message.id} /> : undefined}
              <span className="bubble__meta">
                {message.direction === 'outgoing' ? authorOf(message) : ''}
                <Moment at={new Date(message.createdAt).toISOString()} />
              </span>
            </div>
          ))
        )}
      </div>

      {onReply ? (
        <div className="dialog__reply">
          <textarea
            className="input"
            rows={3}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Ответ клиенту — придёт ему в чат бота"
          />
          <button
            type="button"
            // Пустой ответ отправлять некуда: операция его отвергнет, а
            // погашенная кнопка говорит об этом до нажатия.
            disabled={busy || !body.trim()}
            className="btn btn--gold"
            onClick={() => void send()}
          >
            Отправить
          </button>
        </div>
      ) : undefined}
    </div>
  );
}

/**
 * Кто ответил, подписью к исходящему сообщению.
 *
 * У помощника имени нет и быть не должно: клиенту он представился
 * помощником, и своё имя в панели разошлось бы с тем, что клиент читал.
 * Пустая подпись у ответа менеджера тоже бывает — так выглядят
 * сообщения, отправленные до того, как в панели появились имена.
 */
function authorOf(message: MessageView): string {
  if (message.byConcierge) return 'Помощник · ';
  return message.authorName ? `${message.authorName} · ` : '';
}

/**
 * Изображение из переписки.
 *
 * Подтягивается по требованию и клиентским токеном: на дисках сервиса
 * чужих чеков нет, а каждый просмотр попадает в журнал доступа.
 *
 * Telegram хранит файлы не вечно, и недоступное вложение показывается
 * отсутствующим: битая картинка читалась бы как «оно есть, но панель
 * сломалась».
 */
function Attachment({ messageId }: { readonly messageId: string }) {
  const [missing, setMissing] = useState(false);

  if (missing) {
    return <span className="bubble__meta">Изображение недоступно у Telegram</span>;
  }
  return (
    <img
      className="bubble__image"
      src={`/api/conversations/attachments/${messageId}`}
      alt="Вложение от клиента"
      onError={() => setMissing(true)}
    />
  );
}
