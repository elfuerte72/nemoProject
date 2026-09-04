import type { AttachmentKind } from '@nemo/core';

/**
 * Заголовки, с которыми файл клиента уходит из домена панели.
 *
 * Тип файла Telegram знает со слов клиента, и верить ему нельзя:
 * разметка под видом картинки, открытая в строку, стала бы скриптом в
 * домене панели. Поэтому в строку (`inline`) уходит только то, что
 * узнано по первым байтам и само не исполняется, — картинки и PDF, — и
 * тип у них берётся по байтам. Остальное скачивается (`attachment`)
 * под своим именем; звуку и видео оставляется названный тип из
 * известного набора, чтобы элемент `<audio>` выбрал декодер, а всему
 * незнакомому даётся `octet-stream`.
 *
 * Имя файла — тоже чужая строка: из него убираются кавычки, разделители
 * путей и управляющие знаки, а в заголовок оно попадает дважды —
 * латиницей для старых читателей и в UTF-8 по RFC 5987, чтобы «чек за
 * март.pdf» сохранился под своим именем.
 */
export interface AttachmentDescription {
  readonly kind: AttachmentKind;
  readonly mime: string | null;
  readonly name: string | null;
}

interface Signature {
  readonly type: string;
  readonly extension: string;
  readonly matches: (head: Uint8Array) => boolean;
}

/** Что узнаётся по первым байтам и безопасно показывается в строку. */
const SIGNATURES: readonly Signature[] = [
  { type: 'image/jpeg', extension: 'jpg', matches: (head) => bytesAt(head, 0, [0xff, 0xd8, 0xff]) },
  {
    type: 'image/png',
    extension: 'png',
    matches: (head) => bytesAt(head, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  },
  { type: 'image/gif', extension: 'gif', matches: (head) => asciiAt(head, 0, 'GIF8') },
  {
    type: 'image/webp',
    extension: 'webp',
    matches: (head) => asciiAt(head, 0, 'RIFF') && asciiAt(head, 8, 'WEBP'),
  },
  { type: 'application/pdf', extension: 'pdf', matches: (head) => asciiAt(head, 0, '%PDF') },
];

/** Типы звука и видео, которые отдаются как названы: исполнить их нельзя, а декодер по ним выбирается. */
const MEDIA_TYPES: ReadonlySet<string> = new Set([
  'audio/ogg',
  'audio/mpeg',
  'audio/mp4',
  'audio/aac',
  'audio/x-m4a',
  'audio/wav',
  'video/mp4',
  'video/quicktime',
  'video/webm',
]);

/** Имя для сохранения, когда Telegram его не дал: у фото и голосового имени нет. */
const FALLBACK_NAMES: Readonly<Record<AttachmentKind, string>> = {
  photo: 'photo.jpg',
  document: 'file',
  video: 'video.mp4',
  voice: 'voice.ogg',
  audio: 'audio',
  video_note: 'video-note.mp4',
};

export function attachmentHeaders(
  attachment: AttachmentDescription,
  head: Uint8Array,
): Record<string, string> {
  const known = SIGNATURES.find((one) => one.matches(head));
  const name = safeName(attachment.name) ?? FALLBACK_NAMES[attachment.kind];

  if (known) {
    return headersFor('inline', known.type, name, `.${known.extension}`);
  }
  const mime =
    attachment.mime !== null && MEDIA_TYPES.has(attachment.mime)
      ? attachment.mime
      : 'application/octet-stream';
  return headersFor('attachment', mime, name, '');
}

function headersFor(
  disposition: 'inline' | 'attachment',
  type: string,
  name: string,
  knownExtension: string,
): Record<string, string> {
  return {
    'content-type': type,
    'content-disposition':
      `${disposition}; filename="${asciiName(name, knownExtension)}"; ` +
      `filename*=UTF-8''${encodeRfc5987(name)}`,
    // Тип назван нами по байтам, и угадывать его заново браузеру незачем.
    'x-content-type-options': 'nosniff',
    // Чужой чек не должен осесть в кэше браузера или посредника: доступ
    // к нему проверяется на каждом обращении и пишется в журнал, а
    // закэшированный ответ прошёл бы мимо обоих.
    'cache-control': 'no-store, private',
  };
}

/** Без кавычек, разделителей путей и управляющих знаков; пустое — как отсутствующее. */
function safeName(name: string | null): string | undefined {
  if (name === null) return undefined;
  // eslint-disable-next-line no-control-regex -- управляющие знаки и есть то, что вычищается
  const cleaned = name.replace(/[\u0000-\u001f\u007f"\\/]/g, '').trim().slice(0, 120);
  return cleaned === '' ? undefined : cleaned;
}

/** Имя латиницей для читателей без RFC 5987: своё, если оно и так латиницей, иначе `file` с расширением. */
function asciiName(name: string, knownExtension: string): string {
  if (/^[\x20-\x7e]+$/.test(name)) return name;
  const extension = /\.[a-z0-9]{1,5}$/i.exec(name)?.[0] ?? knownExtension;
  return `file${extension.toLowerCase()}`;
}

/** RFC 5987: `encodeURIComponent` оставляет знаки, которых attr-char не допускает. */
function encodeRfc5987(name: string): string {
  return encodeURIComponent(name).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function bytesAt(head: Uint8Array, offset: number, expected: readonly number[]): boolean {
  return expected.every((byte, index) => head[offset + index] === byte);
}

function asciiAt(head: Uint8Array, offset: number, expected: string): boolean {
  return bytesAt(head, offset, [...expected].map((char) => char.charCodeAt(0)));
}
