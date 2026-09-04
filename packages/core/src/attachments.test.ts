import { describe, expect, it } from 'vitest';
import {
  ATTACHMENT_DOWNLOAD_LIMIT_BYTES,
  describeAttachment,
  formatFileSize,
  isDownloadable,
  staffPreview,
} from './attachments';

/*
 * Вложение названо словами в трёх местах — в уведомлении сотруднику, в
 * причине эскалации и в списке обращений, — и слова эти одни: два
 * набора разошлись бы при первой правке.
 */
describe('formatFileSize', () => {
  it('называет размер в тех единицах, в которых его читают', () => {
    expect(formatFileSize(512)).toBe('512 Б');
    expect(formatFileSize(245_760)).toBe('240 КБ');
    expect(formatFileSize(1_258_291)).toBe('1,2 МБ');
    expect(formatFileSize(20 * 1024 * 1024)).toBe('20 МБ');
  });
});

describe('describeAttachment', () => {
  it('документ — файлом с именем и размером', () => {
    expect(describeAttachment({ kind: 'document', name: 'чек.pdf', size: 245_760 })).toBe(
      'файл чек.pdf (240 КБ)',
    );
  });

  it('документ без имени — просто файлом', () => {
    expect(describeAttachment({ kind: 'document', name: null, size: null })).toBe('файл');
  });

  it('остальное — словом, без размера', () => {
    expect(describeAttachment({ kind: 'photo', name: null, size: 90_000 })).toBe('изображение');
    expect(describeAttachment({ kind: 'video', name: null, size: null })).toBe('видео');
    expect(describeAttachment({ kind: 'voice', name: null, size: null })).toBe(
      'голосовое сообщение',
    );
    expect(describeAttachment({ kind: 'audio', name: null, size: null })).toBe('аудио');
    expect(describeAttachment({ kind: 'video_note', name: null, size: null })).toBe(
      'видеосообщение',
    );
  });
});

describe('isDownloadable', () => {
  it('предел Telegram — 20 МБ; неизвестный размер считается доступным', () => {
    expect(isDownloadable(null)).toBe(true);
    expect(isDownloadable(ATTACHMENT_DOWNLOAD_LIMIT_BYTES)).toBe(true);
    expect(isDownloadable(ATTACHMENT_DOWNLOAD_LIMIT_BYTES + 1)).toBe(false);
  });
});

describe('staffPreview', () => {
  const receipt = { kind: 'document' as const, name: 'чек.pdf', size: 245_760 };

  it('без вложения — слова клиента', () => {
    expect(staffPreview('Когда придут деньги?', null)).toEqual({
      preview: 'Когда придут деньги?',
    });
  });

  it('вложение без подписи занимает место слов', () => {
    expect(staffPreview(null, receipt)).toEqual({ preview: 'Файл чек.pdf (240 КБ)' });
  });

  it('подпись к вложению — словами, вложение — отдельной строкой', () => {
    expect(staffPreview('вот чек', receipt)).toEqual({
      preview: 'вот чек',
      attachment: 'Файл чек.pdf (240 КБ)',
    });
  });
});
