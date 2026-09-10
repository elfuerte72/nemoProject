import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendClientFile } from './files';

/**
 * Файл от менеджера клиенту.
 *
 * Проверяется то, из-за чего этот путь заведён отдельно от уведомлений:
 * куда уходит картинка и куда всё остальное, чем подписан файл и что
 * возвращается наружу — описание принятого Telegram файла, которое
 * ложится в ленту вместо самого файла.
 */

/** Ответ Bot API на принятый файл. */
function accepted(result: unknown): Response {
  return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
}

const PHOTO_RESULT = {
  photo: [
    { file_id: 'small', file_size: 1_200 },
    { file_id: 'large', file_size: 92_000 },
  ],
};

/** Метод Bot API и поля формы, с которыми ушёл запрос. */
function sent(call: unknown[]): { method: string; form: FormData } {
  const url = call[0] as string;
  const init = call[1] as { body: FormData };
  return { method: url.slice(url.lastIndexOf('/') + 1), form: init.body };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sendClientFile', () => {
  it('картинку отправляет картинкой и возвращает самый крупный размер', async () => {
    const fetched = vi.fn(async () => accepted(PHOTO_RESULT));
    vi.stubGlobal('fetch', fetched);

    const attachment = await sendClientFile({
      botToken: 't',
      to: 100n,
      file: new File(['\xff\xd8\xff'], 'qr.png', { type: 'image/png' }),
      body: 'Вот QR',
    });

    const { method, form } = sent(fetched.mock.calls[0]!);
    expect(method).toBe('sendPhoto');
    expect(form.get('chat_id')).toBe('100');
    expect(form.get('caption')).toBe('[Оператор]: Вот QR');
    // Лесенка размеров — у Telegram; в ленту идёт тот, на котором
    // видно, что прислали.
    expect(attachment).toEqual({ fileId: 'large', kind: 'photo', size: 92_000 });
  });

  it('всё остальное отправляет файлом и сохраняет имя', async () => {
    const fetched = vi.fn(async () =>
      accepted({
        document: {
          file_id: 'doc',
          mime_type: 'application/pdf',
          file_name: 'chek.pdf',
          file_size: 240_000,
        },
      }),
    );
    vi.stubGlobal('fetch', fetched);

    const attachment = await sendClientFile({
      botToken: 't',
      to: 100n,
      file: new File(['%PDF'], 'chek.pdf', { type: 'application/pdf' }),
    });

    expect(sent(fetched.mock.calls[0]!).method).toBe('sendDocument');
    expect(attachment).toEqual({
      fileId: 'doc',
      kind: 'document',
      mime: 'application/pdf',
      name: 'chek.pdf',
      size: 240_000,
    });
  });

  it('без слов подписывает файл одним именем: двоеточию нечего вводить', async () => {
    const fetched = vi.fn(async () => accepted(PHOTO_RESULT));
    vi.stubGlobal('fetch', fetched);

    await sendClientFile({
      botToken: 't',
      to: 100n,
      file: new File(['\xff\xd8\xff'], 'shot.jpg', { type: 'image/jpeg' }),
    });

    expect(sent(fetched.mock.calls[0]!).form.get('caption')).toBe('[Оператор]');
  });

  it('картинку, которую Telegram не взял картинкой, отправляет файлом', async () => {
    // Слишком вытянутый снимок и снимок в слишком много точек Bot API
    // отвергает; других путей к клиенту у такой картинки нет.
    const fetched = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"ok":false}', { status: 400 }))
      .mockResolvedValueOnce(accepted({ document: { file_id: 'doc' } }));
    vi.stubGlobal('fetch', fetched);

    const attachment = await sendClientFile({
      botToken: 't',
      to: 100n,
      file: new File(['\xff\xd8\xff'], 'long.jpg', { type: 'image/jpeg' }),
    });

    expect(sent(fetched.mock.calls[1]!).method).toBe('sendDocument');
    expect(attachment).toEqual({ fileId: 'doc', kind: 'document' });
  });

  it('отказ в отправке файлом бросается наружу: записывать в ленту нечего', async () => {
    // Ответ словами при сбое доставки всё равно ложится в переписку —
    // текст у сервиса есть. Файла у него нет: он весь в Telegram, и
    // непринятый файл существует только в браузере менеджера.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"ok":false}', { status: 403 })),
    );

    await expect(
      sendClientFile({
        botToken: 't',
        to: 100n,
        file: new File(['%PDF'], 'chek.pdf', { type: 'application/pdf' }),
      }),
    ).rejects.toThrow(/не принял/i);
  });
});
