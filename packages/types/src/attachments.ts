/**
 * Файл, присланный клиентом боту, — то в нём, что знают все трое:
 * ядро, бот и панель.
 *
 * Род — так, как файл прислал Telegram: фото лесенкой размеров без
 * имени, документ с именем и типом, голосовое без имени. Предел —
 * сколько Telegram отдаёт ботам через `getFile`
 * (core.telegram.org/bots/api): 20 МБ. Локальный сервер Bot API снял
 * бы его, но заводить его ради чеков незачем — о большем клиенту
 * говорится сразу, а панель называет такой файл недоступным до нажатия.
 *
 * Здесь, а не в ядре, потому что размер и предел рисует и панель — в
 * клиентском компоненте, куда ядро с базой не везут.
 */
export const attachmentKinds = [
  'photo',
  'document',
  'video',
  'voice',
  'audio',
  'video_note',
] as const;
export type AttachmentKind = (typeof attachmentKinds)[number];

/**
 * Ровно 20 МиБ: в исходниках сервера Bot API (`telegram-bot-api/Client.h`,
 * `MAX_DOWNLOAD_FILE_SIZE = 20 << 20`) файл больше этого отвечает «file is
 * too big», равный проходит. Не 20 000 000: округлённое вниз число
 * отвергало бы файлы, которые Telegram отдаёт.
 */
export const ATTACHMENT_DOWNLOAD_LIMIT_BYTES = 20 * 1024 * 1024;

/** Размер неизвестен — считается, что отдаст: Telegram не всегда его называет. */
export function isDownloadable(size: number | null): boolean {
  return size === null || size <= ATTACHMENT_DOWNLOAD_LIMIT_BYTES;
}

/**
 * Размер словами. До мегабайта — целыми, дальше с одним знаком: «1,2 МБ»
 * читается, «1 258 291 Б» нет.
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  // Единица выбирается после округления: 1 048 575 байт — это «1 МБ»,
  // а не «1024 КБ».
  const kilobytes = Math.round(bytes / 1024);
  if (kilobytes < 1024) return `${kilobytes} КБ`;
  const megabytes = bytes / (1024 * 1024);
  const rounded = megabytes >= 10 ? Math.round(megabytes) : Math.round(megabytes * 10) / 10;
  return `${String(rounded).replace('.', ',')} МБ`;
}

/**
 * Род словами, для середины фразы: «клиент прислал голосовое
 * сообщение». Одна таблица на ядро и панель: две разошлись бы при
 * первом переименовании, и уведомление называло бы файл не так, как
 * пузырь в переписке.
 */
export const attachmentWords: Readonly<Record<AttachmentKind, string>> = {
  photo: 'изображение',
  document: 'файл',
  video: 'видео',
  voice: 'голосовое сообщение',
  audio: 'аудио',
  video_note: 'видеосообщение',
};

/** Слово, собранное для середины фразы, — в начало строки. */
export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Картинки, которые браузер рисует сам и которые панель узнаёт по
 * первым байтам. Тип со слов клиента вне этого набора — HEIC с iPhone,
 * SVG — в пузыре картинкой не показывается: HEIC браузер не раскодирует,
 * а SVG исполняется.
 */
export const browserImageTypes: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

export function isBrowserImage(mime: string | null): boolean {
  return mime !== null && browserImageTypes.has(mime);
}

/** Картиночные расширения — по ним узнаётся снимок, отправленный файлом. */
const IMAGE_EXTENSION = /\.(jpe?g|png|gif|webp)$/i;

/**
 * Похоже ли на картинку, которую браузер нарисует.
 *
 * Тип называет клиент, и называет как придётся: «image/jpg» вместо
 * «image/jpeg» у Android, «application/octet-stream» у скриншота,
 * отправленного файлом. Поэтому кроме типа смотрится имя. HEIC и SVG не
 * картинки в этом смысле: первый браузер не раскодирует, второй
 * исполняется — оба уходят ссылкой, а не битым рисунком.
 */
export function looksLikeImage(mime: string | null, name: string | null): boolean {
  if (mime === 'image/jpg' || isBrowserImage(mime)) return true;
  if (mime !== null && mime !== 'application/octet-stream') return false;
  return name !== null && IMAGE_EXTENSION.test(name);
}
