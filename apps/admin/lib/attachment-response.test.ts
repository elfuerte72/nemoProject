import { describe, expect, it } from 'vitest';
import {
  attachmentHeaders,
  rangeHeadersOf,
  sliceRange,
  streamsRange,
} from './attachment-response';

/*
 * Файл клиента отдаётся из домена панели, и что браузер с ним сделает,
 * решают заголовки. Тип файла называет клиент, и верить ему нельзя:
 * в строку уходит только то, что узнано по первым байтам и не
 * исполняется, — картинки и PDF. Остальное скачивается под своим именем.
 */
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PDF = new TextEncoder().encode('%PDF-1.7 hello');
const HTML = new TextEncoder().encode('<!doctype html><script>');
const OGG = new TextEncoder().encode('OggS binary');

describe('attachmentHeaders', () => {
  it('фото Telegram — JPEG в строку, с именем для сохранения', () => {
    expect(attachmentHeaders({ kind: 'photo', mime: null, name: null }, JPEG)).toEqual({
      'content-type': 'image/jpeg',
      'content-disposition': "inline; filename=\"photo.jpg\"; filename*=UTF-8''photo.jpg",
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store, private',
    });
  });

  it('PDF открывается в браузере под своим именем, кириллица не теряется', () => {
    expect(
      attachmentHeaders(
        { kind: 'document', mime: 'application/pdf', name: 'чек за март.pdf' },
        PDF,
      ),
    ).toMatchObject({
      'content-type': 'application/pdf',
      'content-disposition':
        "inline; filename=\"file.pdf\"; " +
        "filename*=UTF-8''%D1%87%D0%B5%D0%BA%20%D0%B7%D0%B0%20%D0%BC%D0%B0%D1%80%D1%82.pdf",
    });
  });

  it('тип берётся по байтам, а не со слов клиента', () => {
    // Скриншот «как файл» с типом octet-stream — всё равно PNG в строку.
    expect(
      attachmentHeaders(
        { kind: 'document', mime: 'application/octet-stream', name: 'screen.png' },
        PNG,
      ),
    ).toMatchObject({
      'content-type': 'image/png',
      'content-disposition': expect.stringMatching(/^inline;/),
    });

    // Разметка под видом картинки в строку не уходит: в домене панели
    // она стала бы его скриптом.
    expect(
      attachmentHeaders({ kind: 'document', mime: 'image/png', name: 'pic.png' }, HTML),
    ).toMatchObject({
      'content-type': 'application/octet-stream',
      'content-disposition': expect.stringMatching(/^attachment;/),
    });
  });

  it('звук и видео скачиваются; тип из известного набора проходит, чужой — нет', () => {
    expect(attachmentHeaders({ kind: 'voice', mime: 'audio/ogg', name: null }, OGG)).toMatchObject(
      {
        'content-type': 'audio/ogg',
        'content-disposition': "attachment; filename=\"voice.ogg\"; filename*=UTF-8''voice.ogg",
      },
    );
    expect(
      attachmentHeaders({ kind: 'document', mime: 'text/html', name: 'page.html' }, HTML),
    ).toMatchObject({ 'content-type': 'application/octet-stream' });
  });

  it('имя файла не выходит из строки заголовка и из своей папки', () => {
    const crlf = String.fromCharCode(13, 10);
    const headers = attachmentHeaders(
      { kind: 'document', mime: 'application/pdf', name: `../etc/passwd"${crlf}.pdf` },
      PDF,
    );

    expect(headers['content-disposition']).toBe(
      "inline; filename=\"..etcpasswd.pdf\"; filename*=UTF-8''..etcpasswd.pdf",
    );
  });
});

/*
 * Имя без расширения получает его от сигнатуры: Telegram отдаёт
 * `receipt` или вовсе ничего, а сохранённый «receipt» без `.pdf` не
 * открывается двойным щелчком.
 */
describe('attachmentHeaders: расширение', () => {
  it('дописывается к имени без расширения по сигнатуре', () => {
    expect(
      attachmentHeaders({ kind: 'document', mime: 'application/pdf', name: 'receipt' }, PDF),
    ).toMatchObject({
      'content-disposition': "inline; filename=\"receipt.pdf\"; filename*=UTF-8''receipt.pdf",
    });
  });

  it('и к запасному имени документа без имени', () => {
    expect(attachmentHeaders({ kind: 'document', mime: null, name: null }, PDF)).toMatchObject({
      'content-disposition': "inline; filename=\"file.pdf\"; filename*=UTF-8''file.pdf",
    });
  });

  it('своё расширение не переписывается', () => {
    expect(
      attachmentHeaders({ kind: 'document', mime: 'image/png', name: 'screen.PNG' }, PNG),
    ).toMatchObject({ 'content-disposition': expect.stringContaining('filename="screen.PNG"') });
  });
});

/*
 * Плеер Safari просит первые байты заголовком Range и ждёт 206: на
 * 200 он от источника отказывается, и голосовое читалось бы как
 * «недоступно у Telegram». Файл уже в памяти целиком, и кусок из него
 * вырезается по заголовку.
 */
describe('sliceRange', () => {
  const bytes = Uint8Array.from({ length: 10 }, (_, index) => index);

  it('без Range отдаёт всё целиком и объявляет, что диапазоны понимает', () => {
    const answer = sliceRange(bytes, null);

    expect(answer.status).toBe(200);
    expect(answer.body).toEqual(bytes);
    expect(answer.headers).toEqual({ 'accept-ranges': 'bytes', 'content-length': '10' });
  });

  it('вырезает названный кусок и говорит, из чего', () => {
    const answer = sliceRange(bytes, 'bytes=2-4');

    expect(answer.status).toBe(206);
    expect([...answer.body]).toEqual([2, 3, 4]);
    expect(answer.headers).toEqual({
      'accept-ranges': 'bytes',
      'content-length': '3',
      'content-range': 'bytes 2-4/10',
    });
  });

  it('открытый хвост и хвост сверх длины обрезаются по файлу', () => {
    expect([...sliceRange(bytes, 'bytes=7-').body]).toEqual([7, 8, 9]);
    expect(sliceRange(bytes, 'bytes=7-99').headers['content-range']).toBe('bytes 7-9/10');
  });

  it('невыполнимый диапазон — 416 с длиной файла, тело пустое', () => {
    const answer = sliceRange(bytes, 'bytes=10-');

    expect(answer.status).toBe(416);
    expect(answer.body.length).toBe(0);
    expect(answer.headers).toEqual({ 'accept-ranges': 'bytes', 'content-range': 'bytes */10' });
  });

  it('непонятный Range — как его отсутствие', () => {
    expect(sliceRange(bytes, 'items=1-2').status).toBe(200);
    expect(sliceRange(bytes, 'bytes=a-b').status).toBe(200);
    expect(sliceRange(bytes, 'bytes=0-1,4-5').status).toBe(200);
  });
});

/*
 * Тип есть не у всякого файла: у видеосообщения — «кружка» — поля типа
 * в Bot API нет вовсе, и без своего умолчания оно уходило бы
 * `octet-stream` с запретом угадывания, то есть не игралось бы никогда.
 * Расширение таким файлам даёт тип: сохранённое «audio» без «.mp3» не
 * открывается двойным щелчком.
 */
const MP4 = Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]);

describe('attachmentHeaders: тип по роду', () => {
  it('видеосообщение — video/mp4, хотя типа у него нет', () => {
    expect(attachmentHeaders({ kind: 'video_note', mime: null, name: null }, MP4)).toMatchObject({
      'content-type': 'video/mp4',
      'content-disposition':
        "attachment; filename=\"video-note.mp4\"; filename*=UTF-8''video-note.mp4",
    });
  });

  it('видео и голосовое без типа — своим умолчанием', () => {
    expect(attachmentHeaders({ kind: 'video', mime: null, name: null }, MP4)).toMatchObject({
      'content-type': 'video/mp4',
    });
    expect(attachmentHeaders({ kind: 'voice', mime: null, name: null }, OGG)).toMatchObject({
      'content-type': 'audio/ogg',
    });
  });

  it('документу без типа и без сигнатуры умолчания нет', () => {
    expect(
      attachmentHeaders({ kind: 'document', mime: null, name: 'что-то' }, OGG),
    ).toMatchObject({ 'content-type': 'application/octet-stream' });
  });

  it('расширение берётся у типа, когда сигнатура молчит', () => {
    expect(
      attachmentHeaders({ kind: 'audio', mime: 'audio/mpeg', name: null }, OGG),
    ).toMatchObject({
      'content-disposition': "attachment; filename=\"audio.mp3\"; filename*=UTF-8''audio.mp3",
    });
  });
});

/*
 * Тип приходит со слов клиента, и словом этим бывает что угодно —
 * включая имя метода со стороны прототипа. Такой ответ должен остаться
 * обычным скачиванием, а не сломать маршрут: менеджер иначе не откроет
 * чек вовсе.
 */
describe('attachmentHeaders: тип со стороны', () => {
  it.each(['toString', 'constructor', '__proto__', 'valueOf', 'hasOwnProperty'])(
    'тип «%s» — не тип, а строка от клиента',
    (mime) => {
      const headers = attachmentHeaders({ kind: 'document', mime, name: 'чек' }, OGG);

      expect(headers['content-type']).toBe('application/octet-stream');
      expect(headers['content-disposition']).toBe(
        "attachment; filename=\"file\"; filename*=UTF-8''%D1%87%D0%B5%D0%BA",
      );
    },
  );
});

/*
 * Звук и видео плеер забирает кусками, и куски эти уходят к Telegram, а
 * не читаются из полного файла: иначе одно прослушивание «кружка» на
 * 15 МБ стоит трёх его скачиваний. Картинка и документ читаются целиком
 * — их тип решают первые байты.
 */
describe('streamsRange', () => {
  it('звук и видео — кусками, картинка и документ — целиком', () => {
    expect(streamsRange('voice')).toBe(true);
    expect(streamsRange('audio')).toBe(true);
    expect(streamsRange('video')).toBe(true);
    expect(streamsRange('video_note')).toBe(true);
    expect(streamsRange('photo')).toBe(false);
    expect(streamsRange('document')).toBe(false);
  });
});

describe('rangeHeadersOf', () => {
  it('переносит от Telegram то, чем описан кусок', () => {
    expect(
      rangeHeadersOf(
        new Headers({
          'content-range': 'bytes 0-1/61000',
          'content-length': '2',
          'accept-ranges': 'bytes',
          'content-type': 'application/octet-stream',
          etag: 'W/"abc"',
        }),
      ),
    ).toEqual({
      'content-range': 'bytes 0-1/61000',
      'content-length': '2',
      'accept-ranges': 'bytes',
    });
  });

  it('чего Telegram не назвал, то не выдумывается; диапазоны объявляются всегда', () => {
    expect(rangeHeadersOf(new Headers({ 'content-length': '61000' }))).toEqual({
      'content-length': '61000',
      'accept-ranges': 'bytes',
    });
  });
});
