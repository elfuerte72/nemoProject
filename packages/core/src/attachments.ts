/**
 * Файл, присланный клиентом боту.
 *
 * Сам файл у сервиса не хранится — хранится его идентификатор у
 * Telegram и описание: род, тип, имя, размер. Описание известно из
 * самого обновления, до скачивания, и по нему панель решает, чем файл
 * показать, а бот — что сказать клиенту: Telegram отдаёт ботам файлы
 * до 20 МБ (core.telegram.org/bots/api, `getFile`), и о большем клиенту
 * говорится сразу, а не битой ссылкой при открытии менеджером.
 *
 * До 4 сентября 2026 бот принимал только фото, и PDF-чек или скриншот,
 * отправленный «как файл», терялся молча: без записи, без
 * подтверждения, без уведомления сотрудникам.
 */

import {
  ATTACHMENT_DOWNLOAD_LIMIT_BYTES,
  attachmentKinds,
  attachmentWords,
  capitalize,
  formatFileSize,
  isDownloadable,
  type AttachmentKind,
} from '@nemo/types';

export { ATTACHMENT_DOWNLOAD_LIMIT_BYTES, attachmentKinds, formatFileSize, isDownloadable };
export type { AttachmentKind };

export interface MessageAttachmentInput {
  /** Идентификатор файла у Telegram. Сам файл сервис не скачивает. */
  readonly fileId: string;
  readonly kind: AttachmentKind;
  /** Тип со слов Telegram — а тому его назвал клиент. Панель по нему не решает. */
  readonly mime?: string | undefined;
  /** Есть у документа и аудио; у фото и голосового имени нет. */
  readonly name?: string | undefined;
  /** В байтах. */
  readonly size?: number | undefined;
}

export interface MessageAttachmentView {
  readonly kind: AttachmentKind;
  readonly mime: string | null;
  readonly name: string | null;
  readonly size: number | null;
  /** Telegram отдаст файл: он не больше предела скачивания. */
  readonly downloadable: boolean;
}

/** То, что нужно, чтобы назвать вложение словами. */
export interface AttachmentFacts {
  readonly kind: AttachmentKind;
  readonly name: string | null;
  readonly size: number | null;
}

/** Строка ленты в базе — та её часть, что описывает вложение. */
interface AttachmentColumns {
  readonly attachmentKind: AttachmentKind | null;
  readonly attachmentMime?: string | null;
  readonly attachmentName: string | null;
  readonly attachmentSize: number | null;
}

export function attachmentFactsOf(row: AttachmentColumns): AttachmentFacts | null {
  if (row.attachmentKind === null) return null;
  return { kind: row.attachmentKind, name: row.attachmentName, size: row.attachmentSize };
}

export function attachmentViewOf(
  row: AttachmentColumns & { readonly attachmentMime: string | null },
): MessageAttachmentView | null {
  if (row.attachmentKind === null) return null;
  return {
    kind: row.attachmentKind,
    mime: row.attachmentMime,
    name: row.attachmentName,
    size: row.attachmentSize,
    downloadable: isDownloadable(row.attachmentSize),
  };
}

/**
 * Вложение словами, для середины фразы: «клиент прислал файл чек.pdf
 * (240 КБ)». Имя называется у всякого файла, у которого оно есть, —
 * документ, аудио и видео Telegram отдаёт с именем, — по нему менеджер
 * понимает, чек это или договор, не открывая. Размер идёт следом за
 * именем: у безымянного скриншота он ни о чём не говорит.
 */
export function describeAttachment(facts: AttachmentFacts): string {
  const word = attachmentWords[facts.kind];
  if (facts.name === null) return word;
  return facts.size === null
    ? `${word} ${facts.name}`
    : `${word} ${facts.name} (${formatFileSize(facts.size)})`;
}

/**
 * Что показать сотруднику вместо слов клиента и рядом с ними.
 *
 * Без подписи вложение занимает место слов — иначе цитата пуста, и там
 * оно начинает строку с заглавной. С подписью оно идёт своей строкой,
 * следом за словом «Вложение», и заглавная посреди неё читалась бы как
 * начало новой фразы: «вот чек» без имени файла не говорит, что чек уже
 * пришёл.
 */
export function staffPreview(
  body: string | null,
  attachment: AttachmentFacts | null,
): { readonly preview: string; readonly attachment?: string } {
  if (attachment === null) return { preview: body ?? '' };
  const described = describeAttachment(attachment);
  return body === null
    ? { preview: capitalize(described) }
    : { preview: body, attachment: described };
}
