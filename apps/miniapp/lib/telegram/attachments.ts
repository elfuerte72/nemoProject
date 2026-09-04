import type { Message } from 'grammy/types';
import type { AttachmentKind, MessageAttachmentInput } from '@nemo/core';

/**
 * Файл из сообщения Telegram — в описание для ядра.
 *
 * Bot API кладёт файл в поле по его роду, и в одном сообщении файл
 * ровно один. Исключение — анимация: ради совместимости она приходит
 * и в `animation`, и в `document`, и считается документом, чтобы не
 * стать двумя записями. Наклейка файлом не считается: ответа на неё
 * не ждут.
 *
 * Фото приходит лесенкой размеров; берётся самый крупный — тот, на
 * котором видно сумму перевода. Живое фото с iPhone — тот же случай:
 * `photo` верхнего уровня у него нет, а статичные размеры лежат внутри
 * него самого, и менеджеру нужен именно статичный кадр. Нет и их —
 * берётся само живое фото видео: потерять сообщение хуже, чем показать
 * его роликом.
 */
export function attachmentOf(message: Message): MessageAttachmentInput | undefined {
  if (message.document) return described('document', message.document);
  const photo = message.photo?.at(-1) ?? message.live_photo?.photo?.at(-1);
  if (photo) return described('photo', photo);
  if (message.live_photo) return described('video', message.live_photo);
  if (message.video) return described('video', message.video);
  if (message.voice) return described('voice', message.voice);
  if (message.audio) return described('audio', message.audio);
  if (message.video_note) return described('video_note', message.video_note);
  return undefined;
}

interface TelegramFile {
  readonly file_id: string;
  readonly mime_type?: string;
  readonly file_name?: string;
  readonly file_size?: number;
}

function described(kind: AttachmentKind, file: TelegramFile): MessageAttachmentInput {
  return {
    fileId: file.file_id,
    kind,
    ...(file.mime_type === undefined ? {} : { mime: file.mime_type }),
    ...(file.file_name === undefined ? {} : { name: file.file_name }),
    ...(file.file_size === undefined ? {} : { size: file.file_size }),
  };
}
