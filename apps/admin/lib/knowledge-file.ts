import { InvalidInputError } from '@nemo/core';
import mammoth from 'mammoth';
import { extractText } from 'unpdf';

/**
 * Текст из файла, который администратор принёс в базу знаний.
 *
 * Что за файл, решают первые байты, а не тип со слов браузера и не
 * расширение: PDF начинается с `%PDF`, документ Word — zip-архив, а всё
 * остальное читается как текст в UTF-8. Правило то же, что у вложений
 * клиента (`attachment-response.ts`): названный тип ничего не
 * доказывает.
 *
 * Здесь, а не в ядре: вытащить текст из PDF — работа адаптера, как и
 * разобрать multipart. Ядро получает текст и не знает, откуда он.
 *
 * Скан — PDF без текстового слоя — отвергается словами: распознавать
 * картинки панель не умеет, и молча разобранный пустой документ дал
 * бы пустой черновик без объяснения.
 *
 * Пределы и подсказка полю — в `knowledge-file-kinds.ts`: их читает и
 * экран, а этот модуль в клиентскую сборку не собирается.
 */

export type KnowledgeFileKind = 'pdf' | 'docx' | 'text';

export interface KnowledgeFileText {
  readonly kind: KnowledgeFileKind;
  readonly text: string;
}

const UNREADABLE =
  'Файл не прочитан: панель умеет читать PDF, документы Word (DOCX) и текстовые файлы';

export async function textFromKnowledgeFile(bytes: Uint8Array): Promise<KnowledgeFileText> {
  if (bytes.length === 0) {
    throw new InvalidInputError('Файл пустой');
  }
  if (asciiAt(bytes, 0, '%PDF')) {
    return { kind: 'pdf', text: await pdfText(bytes) };
  }
  if (bytesAt(bytes, 0, [0x50, 0x4b, 0x03, 0x04])) {
    return { kind: 'docx', text: await docxText(bytes) };
  }
  return { kind: 'text', text: plainText(bytes) };
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  let pages: string[];
  try {
    ({ text: pages } = await extractText(bytes));
  } catch {
    throw new InvalidInputError('PDF не открылся: файл повреждён или защищён паролем');
  }
  const text = tidy(pages.join('\n\n'));
  if (!text) {
    throw new InvalidInputError(
      'В этом PDF нет текста — это скан. Пришлите документ текстом или вставьте текст в поле',
    );
  }
  return text;
}

async function docxText(bytes: Uint8Array): Promise<string> {
  let value: string;
  try {
    ({ value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) }));
  } catch {
    // Zip — не обязательно документ Word: архив с чем угодно начинается
    // теми же байтами.
    throw new InvalidInputError(UNREADABLE);
  }
  const text = tidy(value);
  if (!text) {
    throw new InvalidInputError('Документ пустой');
  }
  return text;
}

function plainText(bytes: Uint8Array): string {
  let decoded: string;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new InvalidInputError(UNREADABLE);
  }
  // Нулевой байт в тексте не встречается: это двоичный файл, который
  // случайно оказался годным UTF-8.
  if (decoded.includes('\0')) {
    throw new InvalidInputError(UNREADABLE);
  }
  const text = tidy(decoded);
  if (!text) {
    throw new InvalidInputError('Файл пустой');
  }
  return text;
}

/**
 * Переносы к одному виду и без лишних пустых строк: PDF отдаёт страницы
 * с хвостами пробелов, Word — абзацы с двойными переносами, и модели
 * незачем платить за пустоту.
 */
function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function asciiAt(bytes: Uint8Array, offset: number, expected: string): boolean {
  return bytesAt(bytes, offset, [...expected].map((char) => char.charCodeAt(0)));
}

function bytesAt(bytes: Uint8Array, offset: number, expected: readonly number[]): boolean {
  return expected.every((byte, index) => bytes[offset + index] === byte);
}
