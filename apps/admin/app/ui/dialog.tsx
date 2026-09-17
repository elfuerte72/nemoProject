'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { MessageAttachmentView, MessageView } from '@nemo/core';
import {
  ATTACHMENT_DOWNLOAD_LIMIT_BYTES,
  attachmentWords,
  capitalize,
  formatFileSize,
  looksLikeImage,
} from '@nemo/types';
import { dayKey, formatDayHeading } from '@nemo/ui/format';
import { Moment, useBrowserZone } from '@nemo/ui';
import { hasUnsentText } from '@/lib/live';
import type { SendOutcome } from '@/lib/send-outcome';

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
  onSendFile,
  onTyping,
  head,
}: {
  readonly messages: readonly MessageView[];
  /** Что уже стоит в поле ответа: номер заявки, если писать из карточки. */
  readonly draft?: string | undefined;
  /**
   * Отправить ответ. Исход — не для галочки: поле пустеет только по
   * принятому ответу, а отказ встаёт рядом с полем.
   */
  readonly onReply?: ((body: string) => Promise<SendOutcome>) | undefined;
  /**
   * Отправить файл — тем же ботом, каким уходит ответ словами. Слова из
   * поля идут к нему подписью: чек с пояснением и чек без пояснения —
   * одно сообщение, а не два.
   */
  readonly onSendFile?: ((file: File, body: string) => Promise<SendOutcome>) | undefined;
  /**
   * В поле ответа что-то набрано. Наружу — чтобы тихое обновление
   * страницы подождало: перерисовка посреди набранного ответа отнимает
   * у менеджера то, что он уже написал клиенту.
   */
  readonly onTyping?: ((typing: boolean) => void) | undefined;
  /** Строка над лентой: кто ведёт разговор. */
  readonly head?: ReactNode;
}) {
  const [body, setBody] = useState(draft ?? '');
  const [busy, setBusy] = useState(false);
  /** Выбранный файл — до отправки он никуда не уходит. */
  const [file, setFile] = useState<File | null>(null);
  /**
   * Почему ответ не ушёл: файл не годится — это видно до отправки, —
   * или сервер отказал. Стоит у поля, а не над лентой: на телефоне лента
   * выше экрана, и отказ, напечатанный над ней, менеджер не видел.
   */
  const [complaint, setComplaint] = useState<string>();
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

  // Выбранный файл — то же незаконченное дело, что и набранный текст:
  // тихое обновление страницы унесло бы его вместе с полем.
  useEffect(() => {
    onTyping?.(hasUnsentText(body, draft) || file !== null);
  }, [body, draft, file, onTyping]);

  /**
   * Файл к отправке. Крупнее предела Telegram его брать незачем: такой
   * уйдёт клиенту, но обратно панели Telegram его не отдаст, и менеджер
   * не откроет в переписке то, что сам же и послал.
   */
  function choose(chosen: File | undefined): void {
    if (!chosen) return;
    if (chosen.size > ATTACHMENT_DOWNLOAD_LIMIT_BYTES) {
      setComplaint(
        `Файл больше ${formatFileSize(ATTACHMENT_DOWNLOAD_LIMIT_BYTES)} — столько Telegram не отдаёт обратно, и в панели он не откроется.`,
      );
      return;
    }
    setComplaint(undefined);
    setFile(chosen);
  }

  /*
   * Поле и файл пустеют только по принятому ответу. До 17 сентября 2026
   * они стирались при любом исходе: клиент заблокировал бота, истекла
   * сессия, оборвалась сеть — и набранное пропадало вместе с отказом.
   */
  async function send() {
    const text = body.trim();
    if (busy) return;
    // Отказ по отброшенному файлу висел бы у поля и после того, как
    // менеджер махнул на него рукой и ответил словами.
    setComplaint(undefined);
    const sendFile = file && onSendFile ? () => onSendFile(file, text) : undefined;
    const reply = onReply && text ? () => onReply(text) : undefined;
    const deliver = sendFile ?? reply;
    if (!deliver) return;

    setBusy(true);
    try {
      const outcome = await deliver();
      if (!outcome.sent) {
        setComplaint(outcome.complaint);
        return;
      }
      setFile(null);
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
    <div
      className="chat"
      /*
        Файл берётся и перетаскиванием, и целится он в окно переписки
        целиком, а не в поле ответа: чек приходит менеджеру в соседнем
        окне, и путь «сохранить, найти, выбрать» на каждом шаге стоит
        дольше самой отправки. Без обработчика браузер открыл бы
        брошенный файл вместо панели — и увёл бы менеджера со страницы
        вместе с набранным.
      */
      onDragOver={onSendFile ? (event) => event.preventDefault() : undefined}
      onDrop={
        onSendFile
          ? (event) => {
              event.preventDefault();
              choose(event.dataTransfer.files[0]);
            }
          : undefined
      }
    >
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
            // Снимок экрана живёт в буфере, а не в файле: сохранять его
            // на диск ради отправки — лишний круг, и в папке «Загрузки»
            // после смены остаётся десяток чужих чеков.
            onPaste={
              onSendFile
                ? (event) => {
                    const pasted = event.clipboardData.files[0];
                    if (!pasted) return;
                    event.preventDefault();
                    choose(pasted);
                  }
                : undefined
            }
            placeholder="Ответ клиенту — придёт ему в чат бота"
            aria-label="Ответ клиенту"
          />

          {file ? (
            <p className="chat__file">
              {file.name} · {formatFileSize(file.size)}
              <button
                type="button"
                className="btn btn--ghost btn--tiny"
                aria-label="Убрать файл"
                disabled={busy}
                onClick={() => setFile(null)}
              >
                ✕
              </button>
            </p>
          ) : undefined}

          {complaint ? (
            <p className="chat__complaint" role="alert">
              {complaint}
            </p>
          ) : undefined}

          <div className="chat__bar">
            <span className="chat__hint">
              Enter — отправить, Shift+Enter — новая строка. Клиент увидит ответ с подписью
              «[Оператор]». Файл можно перетащить в окно или вставить из буфера.
            </span>
            <span className="chat__send">
              {onSendFile ? (
                /*
                  Поле выбора внутри подписи: своего вида у него нет ни в
                  одном браузере, и оформить его как остальные кнопки
                  панели иначе нечем. Тот же приём — у приёма документа
                  в базу знаний.
                */
                <label className={`btn btn--soft${busy ? ' btn--disabled' : ''}`}>
                  {file ? 'Другой файл' : 'Файл'}
                  <input
                    type="file"
                    className="sr-only"
                    disabled={busy}
                    onChange={(event) => {
                      choose(event.target.files?.[0]);
                      // Тот же файл, выбранный снова, иначе не вызвал бы
                      // событие: поле помнит прошлый выбор.
                      event.target.value = '';
                    }}
                  />
                </label>
              ) : undefined}
              <button
                type="submit"
                // Пустой ответ отправлять некуда: операция его отвергнет, а
                // погашенная кнопка говорит об этом до нажатия. Файл сам по
                // себе ответ — с ним пустое поле кнопку не гасит. На время
                // отправки кнопка не гаснет: погашенная теряет фокус, и
                // после отказа работающий с клавиатуры оказывался бы в
                // начале страницы, а не у повтора. Второе нажатие держит
                // `busy` в самой отправке.
                disabled={!body.trim() && !file}
                className="btn btn--gold"
              >
                {busy ? 'Отправляю…' : 'Отправить'}
              </button>
            </span>
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
 * Картинки грузятся, когда доезжают до экрана, а не при открытии
 * переписки: каждое обращение за файлом пишется в журнал доступа, и
 * разговор с восемью скриншотами оставлял бы восемь просмотров, ни на
 * один из которых менеджер не смотрел.
 *
 * Файл подтягивается по требованию и клиентским токеном: на дисках
 * сервиса чужих чеков нет. Не показалось — ссылкой, а не словом
 * «недоступно»: формат, которого браузер не знает (HEIC с iPhone), и
 * файл, которого у Telegram больше нет, с экрана неотличимы, а ссылка
 * честна в обоих случаях — по ней либо скачается файл, либо придёт
 * ответ, что его нет. Файл сверх предела Telegram не откроется вовсе,
 * и это сказано до нажатия.
 */
function Attachment({
  messageId,
  attachment,
}: {
  readonly messageId: string;
  readonly attachment: MessageAttachmentView;
}) {
  const [failed, setFailed] = useState(false);
  const href = `/api/conversations/attachments/${messageId}`;
  const title = attachmentTitle(attachment);

  if (!attachment.downloadable) {
    return (
      <span className="bubble__file bubble__file--off">
        {title} · больше {formatFileSize(ATTACHMENT_DOWNLOAD_LIMIT_BYTES)}, Telegram его не отдаёт
      </span>
    );
  }
  if (failed) {
    return <FileLink href={href}>{title} · не показалось, открыть файлом</FileLink>;
  }

  const fail = () => setFailed(true);
  switch (attachment.kind) {
    case 'photo':
      return (
        <img
          className="bubble__image"
          src={href}
          alt={title}
          loading="lazy"
          decoding="async"
          onError={fail}
        />
      );
    case 'voice':
    case 'audio':
      return (
        <span className="bubble__file bubble__file--media">
          <audio className="bubble__media" controls preload="none" src={href} onError={fail} />
          <span>{title}</span>
        </span>
      );
    case 'video':
    case 'video_note':
      return (
        <span className="bubble__file bubble__file--media">
          <video className="bubble__media" controls preload="none" src={href} onError={fail} />
          <span>{title}</span>
        </span>
      );
    case 'document':
      // Скриншот «как файл» — тоже картинка, если браузер её нарисует.
      // Тип у него бывает любым — «image/jpg», «octet-stream», — и
      // потому смотрится ещё и имя; ошибка в эту сторону стоит одной
      // ссылки взамен рисунка, а не потерянного чека.
      return looksLikeImage(attachment.mime, attachment.name) ? (
        <img
          className="bubble__image"
          src={href}
          alt={title}
          loading="lazy"
          decoding="async"
          onError={fail}
        />
      ) : (
        <FileLink href={href}>{title}</FileLink>
      );
  }
}

function FileLink({ href, children }: { readonly href: string; readonly children: ReactNode }) {
  return (
    <a className="bubble__file" href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

/** «чек.pdf · 240 КБ»: имя, если Telegram его дал, иначе род; размер — когда известен. */
function attachmentTitle(attachment: MessageAttachmentView): string {
  const name = attachment.name ?? capitalize(attachmentWords[attachment.kind]);
  return attachment.size === null ? name : `${name} · ${formatFileSize(attachment.size)}`;
}
