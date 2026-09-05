import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { textFromKnowledgeFile } from './knowledge-file';

/*
 * Файл администратора читается по первым байтам, как и вложения
 * клиента: тип со слов браузера не решает ничего. Фикстуры — настоящие
 * файлы, а не сочинённые по памяти о формате: PDF и DOCX собраны
 * минимальными, но открываются и в Preview, и в Word.
 */
function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
}

const utf8 = (text: string) => new TextEncoder().encode(text);

describe('текстовый файл', () => {
  it('читается как UTF-8, переносы Windows приводятся к одному виду', async () => {
    const read = await textFromKnowledgeFile(utf8('Работаем круглосуточно.\r\n\r\n\r\nОплата по СБП.\r\n'));

    expect(read).toEqual({ kind: 'text', text: 'Работаем круглосуточно.\n\nОплата по СБП.' });
  });

  it('пустой файл отвергается словами', async () => {
    await expect(textFromKnowledgeFile(utf8('  \n\n '))).rejects.toThrow(/пуст/i);
    await expect(textFromKnowledgeFile(new Uint8Array())).rejects.toThrow(/пуст/i);
  });

  it('двоичный файл под видом текста не читается', async () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);

    await expect(textFromKnowledgeFile(png)).rejects.toThrow(/PDF, документы Word/);
  });

  it('текст не в UTF-8 не читается: панель не гадает кодировку', async () => {
    const cp1251 = Uint8Array.from([0xd0, 0xe0, 0xe1, 0xee, 0xf2, 0xe0, 0xe5, 0xec]);

    await expect(textFromKnowledgeFile(cp1251)).rejects.toThrow(/PDF, документы Word/);
  });
});

describe('PDF', () => {
  it('отдаёт текстовый слой', async () => {
    const read = await textFromKnowledgeFile(fixture('regulations.pdf'));

    expect(read.kind).toBe('pdf');
    expect(read.text).toContain('Service works around the clock.');
    expect(read.text).toContain('Payment by card transfer.');
  });

  it('скан без текстового слоя отвергается словами, а не пустым черновиком', async () => {
    await expect(textFromKnowledgeFile(fixture('scan.pdf'))).rejects.toThrow(/скан/);
  });

  it('обрубок PDF — отказ, а не падение', async () => {
    await expect(textFromKnowledgeFile(utf8('%PDF-1.4 broken'))).rejects.toThrow(/не открылся/);
  });
});

describe('документ Word', () => {
  it('отдаёт абзацы текстом', async () => {
    const read = await textFromKnowledgeFile(fixture('regulations.docx'));

    expect(read.kind).toBe('docx');
    expect(read.text).toBe(
      'Сервис работает круглосуточно и без выходных.\n\nОплата проходит по СБП или переводом на карту.',
    );
  });

  it('zip-архив с чем угодно — не документ', async () => {
    await expect(textFromKnowledgeFile(fixture('archive.zip'))).rejects.toThrow(/PDF, документы Word/);
  });
});
