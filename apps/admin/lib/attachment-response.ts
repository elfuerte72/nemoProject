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

/**
 * Типы звука и видео, которые отдаются как названы: исполнить их нельзя,
 * а декодер по ним выбирается. Рядом расширение: сигнатуры у этих
 * форматов панель не читает, и сохранённое «audio» без «.mp3» не
 * открывается двойным щелчком.
 */
const MEDIA_TYPES: Readonly<Record<string, string>> = {
  'audio/ogg': '.ogg',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/aac': '.aac',
  'audio/x-m4a': '.m4a',
  'audio/wav': '.wav',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
};

/**
 * Тип по роду, когда Telegram его не назвал. У видеосообщения —
 * «кружка» — поля типа в Bot API нет вовсе, и без умолчания оно уходило
 * бы `octet-stream` с запретом угадывания, то есть не игралось бы
 * никогда. У документа умолчания нет и быть не может: документом
 * присылают что угодно.
 */
const KIND_TYPES: Readonly<Partial<Record<AttachmentKind, string>>> = {
  video_note: 'video/mp4',
  video: 'video/mp4',
  voice: 'audio/ogg',
  audio: 'audio/mpeg',
};

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
  if (known) {
    const named = withExtension(
      safeName(attachment.name) ?? FALLBACK_NAMES[attachment.kind],
      `.${known.extension}`,
    );
    return headersFor('inline', known.type, named, `.${known.extension}`);
  }

  // Через `Object.hasOwn`, а не `in`: тип приходит со слов клиента, и
  // словом этим бывает «toString» — тогда расширением стала бы функция
  // с прототипа, а маршрут ответил бы отказом вместо файла.
  const declared =
    attachment.mime !== null && Object.hasOwn(MEDIA_TYPES, attachment.mime)
      ? attachment.mime
      : undefined;
  const mime = declared ?? KIND_TYPES[attachment.kind] ?? 'application/octet-stream';
  const extension = Object.hasOwn(MEDIA_TYPES, mime) ? MEDIA_TYPES[mime]! : '';
  const named = withExtension(
    safeName(attachment.name) ?? FALLBACK_NAMES[attachment.kind],
    extension,
  );
  return headersFor('attachment', mime, named, extension);
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

/**
 * Без кавычек, разделителей путей, управляющих знаков и знаков смены
 * направления письма; пустое — как отсутствующее.
 *
 * Знак `U+202E` переворачивает хвост имени на экране: «чек\u202Egpj.exe»
 * читается в строке загрузок как «чекexe.jpg», и менеджер, которому
 * обещали файл под своим именем, сохраняет программу вместо чека.
 */
function safeName(name: string | null): string | undefined {
  if (name === null) return undefined;
  const cleaned = name
    // eslint-disable-next-line no-control-regex -- управляющие знаки и есть то, что вычищается
    .replace(/[\u0000-\u001f\u007f"\\/]/g, '')
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .trim()
    .slice(0, 120);
  return cleaned === '' ? undefined : cleaned;
}

/**
 * Имя без расширения получает его от сигнатуры: Telegram отдаёт `receipt`
 * или вовсе ничего, а сохранённый «receipt» без `.pdf` не открывается
 * двойным щелчком. Своё расширение не переписывается.
 */
function withExtension(name: string, knownExtension: string): string {
  return knownExtension !== '' && !EXTENSION.test(name) ? `${name}${knownExtension}` : name;
}

// Хотя бы одна буква: «Отчёт 2026.09.04» кончается не расширением, а датой.
const EXTENSION = /\.(?=[a-z0-9]{1,5}$)[a-z0-9]*[a-z][a-z0-9]*$/i;

/** Имя латиницей для читателей без RFC 5987: своё, если оно и так латиницей, иначе `file` с расширением. */
function asciiName(name: string, knownExtension: string): string {
  if (/^[\x20-\x7e]+$/.test(name)) return name;
  const extension = EXTENSION.exec(name)?.[0] ?? knownExtension;
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

/**
 * Кусок файла по заголовку Range.
 *
 * Плеер Safari просит первые байты и ждёт 206: на 200 он от источника
 * отказывается, и голосовое читалось бы как «недоступно у Telegram», а
 * каждая его проба писала бы в журнал доступа ещё один просмотр. Файл
 * уже в памяти целиком — Telegram отдаёт ботам не больше 20 МБ, — и
 * кусок вырезается из него. Понимается один диапазон; список
 * диапазонов и чужие единицы отвечаются целым файлом, как если бы
 * заголовка не было.
 *
 * Роду, который кусками не отдаётся, диапазоны не обещаются и не
 * режутся: обещание просмотрщику PDF означало бы, что он начнёт просить
 * куски, а каждый кусок — это файл, скачанный у Telegram заново.
 */
export interface RangeAnswer {
  readonly status: 200 | 206 | 416;
  /** Над `ArrayBuffer`, а не `ArrayBufferLike`: только такой массив годится телом `Response`. */
  readonly body: Uint8Array<ArrayBuffer>;
  readonly headers: Record<string, string>;
}

export function sliceRange(
  bytes: Uint8Array<ArrayBuffer>,
  range: string | null,
  acceptsRanges = true,
): RangeAnswer {
  const total = bytes.length;
  const whole = {
    status: 200,
    body: bytes,
    headers: acceptsRanges
      ? { 'accept-ranges': 'bytes', 'content-length': String(total) }
      : { 'content-length': String(total) },
  } as const;

  const match =
    range === null || !acceptsRanges ? null : /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!match || (match[1] === '' && match[2] === '')) {
    return whole;
  }

  // «bytes=-500» — последние пятьсот байт; иначе от начала до конца или до края файла.
  const start = match[1] === '' ? Math.max(0, total - Number(match[2])) : Number(match[1]);
  const end = match[1] !== '' && match[2] !== '' ? Math.min(Number(match[2]), total - 1) : total - 1;
  if (start >= total || start > end) {
    return {
      status: 416,
      body: new Uint8Array(0),
      headers: { 'accept-ranges': 'bytes', 'content-range': `bytes */${total}` },
    };
  }

  const body = bytes.subarray(start, end + 1);
  return {
    status: 206,
    body,
    headers: {
      'accept-ranges': 'bytes',
      'content-length': String(body.length),
      'content-range': `bytes ${start}-${end}/${total}`,
    },
  };
}

/**
 * Забирается ли файл кусками прямо у Telegram.
 *
 * Звук и видео плеер тянет по частям — Safari просит сперва два байта,
 * потом всё остальное, — и читать ради каждой части целый файл значит
 * скачать «кружок» на 15 МБ трижды за одно прослушивание. Тип у этих
 * родов известен и без файла: его называет Telegram или наше умолчание
 * по роду. Картинка и документ читаются целиком — их тип решают первые
 * байты, и без них панель показала бы разметку как разметку.
 */
export function streamsRange(kind: AttachmentKind): boolean {
  return kind !== 'photo' && kind !== 'document';
}

/**
 * Чем Telegram описал отданный кусок. Переносится только это: тип и имя
 * файла называет панель, а не он.
 */
export function rangeHeadersOf(headers: Headers): Record<string, string> {
  const carried = ['content-range', 'content-length'] as const;
  const answer: Record<string, string> = { 'accept-ranges': 'bytes' };
  for (const name of carried) {
    const value = headers.get(name);
    if (value !== null) answer[name] = value;
  }
  return answer;
}
