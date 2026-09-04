import { describe, expect, it } from 'vitest';
import { attachmentHeaders } from './attachment-response';

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
