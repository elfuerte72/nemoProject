'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { MessageAttachmentView, MessageView } from '@nemo/core';
import { ATTACHMENT_DOWNLOAD_LIMIT_BYTES, formatFileSize, type AttachmentKind } from '@nemo/types';
import { dayKey, formatDayHeading } from '@/lib/format';
import { Moment, useBrowserZone } from '@/app/ui/moment';

/**
 * Окно переписки — так, как оно устроено в CRM, где чат и есть работа.
 *
 * Лента в своей рамке и со своей прокруткой, а не в потоке страницы:
 * поле ответа всегда под рукой, и, прочитав сообщение в середине, не
 * надо листать до конца, чтобы ответить. Входящие слева, ответы
 * сервиса справа — как в мессенджере у самого клиента; кто написал,
 * видно до чтения текста, а между днями стоит разделитель: «вчера,
 * 13:35» под каждым пузырём этого не заменяло, потому что читалось
 * после текста. До 4 сентября 2026 лента была без рамки, а раскладка
 * страницы раскладывала её по колонкам сетки — пузыри уезжали в правую
 * треть экрана, и переписываться было негде.
 *
 * Enter отправляет, Shift+Enter переносит строку: так в каждом чате, а
 * кнопка остаётся для мыши и для тех, кто об этом не знает.
 */
export function Dialog({
  messages,
  draft,
  onReply,
  head,
}: {
  readonly messages: readonly MessageView[];
  /** Что уже стоит в поле ответа: номер заявки, если писать из карточки. */
  readonly draft?: string | undefined;
  readonly onReply?: ((body: string) => Promise<void>) | undefined;
  /** Строка над лентой: кто ведёт разговор. */
  readonly head?: ReactNode;
}) {
  const [body, setBody] = useState(draft ?? '');
  const [busy, setBusy] = useState(false);
  const feed = useRef<HTMLDivElement>(null);
  /*
   * Пояс браузера известен только браузеру: разделители дней считаются
   * по нему и рисуются после появления разметки. До этого ленту
   * показывают без них — секунду, которую никто не замечает, — а не
   * по UTC, где день сменяется посреди рабочей ночи.
   */
  const zone = useBrowserZone();

  // Лента открывается на последнем сообщении и возвращается к нему
  // после каждого ответа: читают то, что только что сказали. Пояс — в
  // зависимостях, потому что с ним появляются разделители дней, и лента
  // становится длиннее уже после первой прокрутки.
  useEffect(() => {
    const node = feed.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages.length, zone]);

  async function send() {
    const text = body.trim();
    if (!onReply || !text || busy) return;
    setBusy(true);
    try {
      await onReply(text);
      setBody('');
    } finally {
      setBusy(false);
    }
  }

  /*
   * Enter отправляет только с настоящей клавиатуры: у экранной нет
   * Shift+Enter, и на телефоне перевод строки отправлял бы клиенту
   * половину фразы. Там Enter переносит строку, отправляет кнопка, а
   * Ctrl/Cmd+Enter отправляет везде.
   */
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    if (event.metaKey || event.ctrlKey || (!coarse && !event.shiftKey)) {
      event.preventDefault();
      void send();
    }
  }

  const now = new Date();

  return (
    <div className="chat">
      {head}

      <div className="chat__feed" ref={feed}>
        {messages.length === 0 ? (
          <p className="chat__empty">
            Переписки пока нет — напишите первым, если есть что уточнить.
          </p>
        ) : (
          messages.map((message, index) => {
            const at = new Date(message.createdAt);
            const previous = messages[index - 1];
            const newDay =
              zone !== undefined &&
              (!previous || dayKey(new Date(previous.createdAt), zone) !== dayKey(at, zone));
            return (
              <div key={message.id} className="chat__group">
                {newDay ? (
                  <div className="chat__day" aria-hidden>
                    <span>{formatDayHeading(at, now, zone)}</span>
                  </div>
                ) : undefined}
                <div
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
                  {message.attachment ? (
                    <Attachment messageId={message.id} attachment={message.attachment} />
                  ) : undefined}
                  <span className="bubble__meta">
                    {message.direction === 'outgoing' ? authorOf(message) : ''}
                    <Moment at={at.toISOString()} mode="time" />
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {onReply ? (
        <form
          className="chat__composer"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <textarea
            className="chat__input"
            rows={2}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ответ клиенту — придёт ему в чат бота"
            aria-label="Ответ клиенту"
          />
          <div className="chat__bar">
            <span className="chat__hint">
              Enter — отправить, Shift+Enter — новая строка. Клиент увидит ответ с подписью
              «[Оператор]».
            </span>
            <button
              type="submit"
              // Пустой ответ отправлять некуда: операция его отвергнет, а
              // погашенная кнопка говорит об этом до нажатия.
              disabled={busy || !body.trim()}
              className="btn btn--gold"
            >
              {busy ? 'Отправляю…' : 'Отправить'}
            </button>
          </div>
        </form>
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
 * Вложение в переписке — по роду.
 *
 * Картинка показывается в пузыре: чек читают, а не разглядывают. PDF и
 * прочие документы — строкой с именем и размером: PDF откроется в
 * соседней вкладке, остальное скачается под своим именем. Звук и видео
 * играют в пузыре и не грузятся до нажатия: каждое обращение за файлом
 * пишется в журнал доступа, и загрузка «на всякий случай» писала бы
 * туда просмотр, которого не было.
 *
 * Файл подтягивается по требованию и клиентским токеном: на дисках
 * сервиса чужих чеков нет. Telegram хранит файлы не вечно, и
 * недоступное вложение показывается отсутствующим: битая картинка
 * читалась бы как «оно есть, но панель сломалась». Файл сверх предела
 * Telegram не откроется вовсе, и это сказано до нажатия.
 */
function Attachment({
  messageId,
  attachment,
}: {
  readonly messageId: string;
  readonly attachment: MessageAttachmentView;
}) {
  const [missing, setMissing] = useState(false);
  const href = `/api/conversations/attachments/${messageId}`;
  const title = attachmentTitle(attachment);

  if (!attachment.downloadable) {
    return (
      <span className="bubble__file bubble__file--off">
        {title} · больше {formatFileSize(ATTACHMENT_DOWNLOAD_LIMIT_BYTES)}, Telegram его не отдаёт
      </span>
    );
  }
  if (missing) {
    return <span className="bubble__meta">{title} · недоступно у Telegram</span>;
  }
  if (isImage(attachment)) {
    return (
      <img className="bubble__image" src={href} alt={title} onError={() => setMissing(true)} />
    );
  }
  if (attachment.kind === 'voice' || attachment.kind === 'audio') {
    return (
      <span className="bubble__file bubble__file--media">
        <audio
          className="bubble__media"
          controls
          preload="none"
          src={href}
          onError={() => setMissing(true)}
        />
        <span>{title}</span>
      </span>
    );
  }
  if (attachment.kind === 'video' || attachment.kind === 'video_note') {
    return (
      <span className="bubble__file bubble__file--media">
        <video
          className="bubble__media"
          controls
          preload="none"
          src={href}
          onError={() => setMissing(true)}
        />
        <span>{title}</span>
      </span>
    );
  }
  return (
    <a className="bubble__file" href={href} target="_blank" rel="noopener noreferrer">
      {title}
    </a>
  );
}

/** Картинкой показывается фото и документ, названный картинкой: скриншот «как файл» — тоже картинка. */
function isImage(attachment: MessageAttachmentView): boolean {
  if (attachment.kind === 'photo') return true;
  return (
    attachment.kind === 'document' &&
    attachment.mime !== null &&
    attachment.mime.startsWith('image/') &&
    attachment.mime !== 'image/svg+xml'
  );
}

const KIND_TITLES: Readonly<Record<AttachmentKind, string>> = {
  photo: 'Изображение',
  document: 'Файл',
  video: 'Видео',
  voice: 'Голосовое сообщение',
  audio: 'Аудио',
  video_note: 'Видеосообщение',
};

/** «чек.pdf · 240 КБ»: имя, если Telegram его дал, иначе род; размер — когда известен. */
function attachmentTitle(attachment: MessageAttachmentView): string {
  const name = attachment.name ?? KIND_TITLES[attachment.kind];
  return attachment.size === null ? name : `${name} · ${formatFileSize(attachment.size)}`;
}
