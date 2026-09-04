import { describe, expect, it } from 'vitest';
import type { Message } from 'grammy/types';
import { attachmentOf } from './attachments';

/*
 * Сообщения собраны по описанию Bot API (core.telegram.org/bots/api), а
 * не записаны с живого бота: у фото лесенка размеров без имени и типа,
 * у документа имя, тип и размер, у голосового только тип и размер.
 * Наклейка и текст файлом не считаются. Записанные обновления — долг
 * в `backlog.md`: их может дать только тот, кто пришлёт файл боту.
 */
const BASE = {
  message_id: 1,
  date: 1_756_900_000,
  chat: { id: 100, type: 'private' as const, first_name: 'Иван' },
  from: { id: 100, is_bot: false, first_name: 'Иван' },
};

function message(extra: Record<string, unknown>): Message {
  return { ...BASE, ...extra } as unknown as Message;
}

describe('attachmentOf', () => {
  it('у фото берёт самый крупный размер лесенки', () => {
    expect(
      attachmentOf(
        message({
          photo: [
            { file_id: 'small', file_unique_id: 'u1', width: 90, height: 160, file_size: 1_200 },
            { file_id: 'medium', file_unique_id: 'u2', width: 320, height: 570, file_size: 18_000 },
            { file_id: 'large', file_unique_id: 'u3', width: 720, height: 1280, file_size: 92_000 },
          ],
        }),
      ),
    ).toEqual({ fileId: 'large', kind: 'photo', size: 92_000 });
  });

  it('у документа — имя, тип и размер', () => {
    expect(
      attachmentOf(
        message({
          document: {
            file_id: 'BQACAgIAAxkBAAIC',
            file_unique_id: 'u4',
            file_name: 'чек.pdf',
            mime_type: 'application/pdf',
            file_size: 245_760,
          },
        }),
      ),
    ).toEqual({
      fileId: 'BQACAgIAAxkBAAIC',
      kind: 'document',
      mime: 'application/pdf',
      name: 'чек.pdf',
      size: 245_760,
    });
  });

  it('у голосового нет имени, есть тип', () => {
    expect(
      attachmentOf(
        message({
          voice: {
            file_id: 'AwACAgIAAxkBAAID',
            file_unique_id: 'u5',
            duration: 12,
            mime_type: 'audio/ogg',
            file_size: 61_000,
          },
        }),
      ),
    ).toEqual({ fileId: 'AwACAgIAAxkBAAID', kind: 'voice', mime: 'audio/ogg', size: 61_000 });
  });

  it('видео, аудио и видеосообщение — своим родом', () => {
    expect(
      attachmentOf(
        message({
          video: {
            file_id: 'v',
            file_unique_id: 'u6',
            width: 1,
            height: 1,
            duration: 3,
            mime_type: 'video/mp4',
          },
        }),
      ),
    ).toMatchObject({ fileId: 'v', kind: 'video', mime: 'video/mp4' });
    expect(
      attachmentOf(
        message({
          audio: { file_id: 'a', file_unique_id: 'u7', duration: 3, file_name: 'song.mp3' },
        }),
      ),
    ).toMatchObject({ fileId: 'a', kind: 'audio', name: 'song.mp3' });
    expect(
      attachmentOf(
        message({ video_note: { file_id: 'n', file_unique_id: 'u8', length: 240, duration: 5 } }),
      ),
    ).toEqual({ fileId: 'n', kind: 'video_note' });
  });

  it('анимация приходит и документом — им и считается', () => {
    // Bot API ради совместимости кладёт GIF в оба поля; второй записи
    // из одного сообщения быть не должно.
    expect(
      attachmentOf(
        message({
          animation: { file_id: 'g', file_unique_id: 'u9', width: 1, height: 1, duration: 2 },
          document: {
            file_id: 'g',
            file_unique_id: 'u9',
            file_name: 'funny.gif',
            mime_type: 'video/mp4',
          },
        }),
      ),
    ).toMatchObject({ fileId: 'g', kind: 'document', name: 'funny.gif' });
  });

  it('наклейка и текст — не файл', () => {
    expect(
      attachmentOf(
        message({ sticker: { file_id: 's', file_unique_id: 'u10', type: 'regular' } }),
      ),
    ).toBeUndefined();
    expect(attachmentOf(message({ text: 'привет' }))).toBeUndefined();
  });
});
