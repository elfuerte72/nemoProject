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
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  const megabytes = bytes / (1024 * 1024);
  const rounded = megabytes >= 10 ? Math.round(megabytes) : Math.round(megabytes * 10) / 10;
  return `${String(rounded).replace('.', ',')} МБ`;
}
