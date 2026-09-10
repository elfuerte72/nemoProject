import { operatorCaption, type MessageAttachmentInput } from '@nemo/core';

/**
 * Файл от менеджера — клиенту, тем же ботом, которым уходят ответы
 * словами.
 *
 * Отправка здесь идёт перед записью, а не после неё, и это обратный
 * порядок по сравнению с остальными уведомлениями: у файла нет
 * идентификатора, пока Telegram его не примет, а сам файл сервис не
 * хранит (docs/adr/0020). Поэтому функция возвращает описание принятого
 * файла — то же самое, каким описан файл клиента, — и это описание
 * ложится в ленту.
 *
 * Отсюда же и отношение к ошибке: сбой отправки уведомления ничего не
 * отменяет и глотается, а сбой отправки файла отменяет всё — записывать
 * в ленту нечего, и менеджер должен узнать об этом сразу, а не увидеть
 * в переписке файл, которого клиент не получил.
 */

export interface SendFileOptions {
  readonly botToken: string;
  readonly to: bigint;
  /** Что отправляем: имя и тип берутся у самого файла. */
  readonly file: File;
  /** Слова менеджера к файлу. Уходят подписью — с той же подписью, что и ответ. */
  readonly body?: string | undefined;
}

/**
 * Картинка уходит картинкой, всё остальное — файлом.
 *
 * Клиент чаще всего получает снимок экрана или QR: показанные в чате
 * картинкой, они читаются сразу, а присланные файлом требуют сперва их
 * скачать. Всё прочее — квитанция PDF, договор — файлом и уходит: имя
 * при этом сохраняется, а Telegram картинки пережимает.
 *
 * Предел `sendPhoto` — 10 МБ, и всё, что больше, отправляется файлом
 * без попытки: отказ Telegram по размеру менеджеру объяснить нечем.
 * Отказ по другой причине — слишком вытянутый снимок, слишком много
 * точек — ловится повтором файлом: у картинки, которую Telegram не
 * взял картинкой, других путей к клиенту нет.
 */
const PHOTO_TYPES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png', 'image/webp']);
const PHOTO_LIMIT_BYTES = 10 * 1024 * 1024;

export async function sendClientFile(
  options: SendFileOptions,
): Promise<MessageAttachmentInput> {
  const asPhoto =
    PHOTO_TYPES.has(options.file.type.toLowerCase()) && options.file.size <= PHOTO_LIMIT_BYTES;

  if (asPhoto) {
    const sent = await deliver('sendPhoto', 'photo', options);
    if (sent) return sent;
  }
  const sent = await deliver('sendDocument', 'document', options);
  if (!sent) {
    throw new Error('Telegram не принял файл');
  }
  return sent;
}

/**
 * Одна попытка отправки. `undefined` — Telegram отказал: у отправки
 * картинкой есть запасной путь, у отправки файлом его нет.
 */
async function deliver(
  method: 'sendPhoto' | 'sendDocument',
  field: 'photo' | 'document',
  options: SendFileOptions,
): Promise<MessageAttachmentInput | undefined> {
  const form = new FormData();
  // Строкой, а не числом: `telegram_user_id` — bigint, и на приведении
  // к `number` он однажды потеряет точность.
  form.set('chat_id', options.to.toString());
  form.set('caption', operatorCaption(options.body));
  form.set(field, options.file, options.file.name);

  const response = await fetch(
    `https://api.telegram.org/bot${options.botToken}/${method}`,
    { method: 'POST', body: form },
  );
  // Ответ разбирается осторожно: под нагрузкой Telegram отвечает
  // страницей своего шлюза, а не JSON.
  const payload = await response
    .json()
    .then((body) => body as { ok?: boolean; result?: SentMessage })
    .catch(() => undefined);
  if (payload?.ok !== true || !payload.result) {
    console.error('Telegram отклонил файл', method, response.status);
    return undefined;
  }
  return sentFileOf(payload.result, field);
}

/** То в ответе Telegram, что описывает принятый им файл. */
interface SentFile {
  readonly file_id: string;
  readonly mime_type?: string;
  readonly file_name?: string;
  readonly file_size?: number;
}

interface SentMessage {
  readonly document?: SentFile;
  readonly photo?: readonly SentFile[];
}

/**
 * Описание принятого файла — тем же набором полей, каким описан файл
 * клиента.
 *
 * Берётся из ответа, а не из того, что мы послали: картинку Telegram
 * пережимает, и её размер, тип и лесенка размеров у него свои. Имени у
 * картинки после этого нет — как нет его и у фото от клиента.
 *
 * Разбирается здесь, а не общей с ботом функцией: бот читает чужое
 * сообщение и не знает, что в нём лежит, а тут известно, что мы
 * отправили, и ответ обязан отвечать тем же родом.
 */
function sentFileOf(message: SentMessage, field: 'photo' | 'document'): MessageAttachmentInput | undefined {
  const file = field === 'document' ? message.document : message.photo?.at(-1);
  if (!file) return undefined;
  return {
    fileId: file.file_id,
    kind: field,
    ...(file.mime_type === undefined ? {} : { mime: file.mime_type }),
    ...(file.file_name === undefined ? {} : { name: file.file_name }),
    ...(file.file_size === undefined ? {} : { size: file.file_size }),
  };
}
