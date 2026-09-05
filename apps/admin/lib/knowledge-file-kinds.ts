/**
 * Что панель принимает в базу знаний файлом: пределы и подсказка полю
 * выбора. Отдельно от читалки файлов, потому что это нужно и экрану:
 * читалка тянет pdf.js и `node:crypto`, а клиентской сборке они не
 * собираются.
 */

/** Сколько принимаем: десять мегабайт — это регламент с картинками, а не архив. */
export const KNOWLEDGE_FILE_LIMIT_BYTES = 10 * 1024 * 1024;

/** Подсказка полю выбора: что панель умеет читать. */
export const KNOWLEDGE_FILE_ACCEPT = [
  '.pdf',
  '.docx',
  '.txt',
  '.md',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
].join(',');
