import { botToken } from '@nemo/telegram';
import { errorResponse } from '@/lib/api';
import {
  attachmentHeaders,
  rangeHeadersOf,
  sliceRange,
  streamsRange,
} from '@/lib/attachment-response';
import { requireStaffActor } from '@/lib/auth/require-session';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Байтов нет — сигнатуре решать нечего, тип берётся у Telegram или у рода. */
const EMPTY_HEAD = new Uint8Array(0);

/**
 * Файл, присланный клиентом: изображение, PDF-чек, голосовое.
 *
 * Файл не хранится у сервиса — хранится его идентификатор у Telegram, и
 * панель забирает файл клиентским токеном, который у неё уже есть для
 * уведомлений. На дисках сервиса чужих чеков при этом не появляется:
 * пока не ответят на блокер A1 о защите персональных данных, это
 * существенно.
 *
 * Каждый просмотр попадает в журнал доступа — операция записывает его в
 * той же транзакции, в которой отдаёт идентификатор, и пропустить запись
 * нельзя.
 *
 * Картинка и документ читаются целиком: с какими заголовками их отдать,
 * решают первые байты (`attachment-response.ts`), а Telegram отдаёт
 * ботам не больше 20 МБ — в память панели это помещается.
 *
 * Звук и видео плеер просит кусками — Safari сперва два байта, потом
 * остальное, — и эти куски уходят к Telegram, а не режутся из полного
 * файла: иначе одно прослушивание «кружка» на 15 МБ стоило бы трёх его
 * скачиваний. Тип у этих родов известен и без байтов. Отказался
 * отдавать кусок — читаем целиком и режем сами: без ответа 206 плеер
 * Safari от источника отказывается вовсе.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const actor = await requireStaffActor();
    const { id } = await context.params;
    const attachment = await getCore().revealMessageAttachment(actor, id);

    const token = botToken();
    const described = await fetch(
      `https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(attachment.fileId)}`,
    );
    const payload = (await described.json()) as {
      ok: boolean;
      result?: { file_path?: string };
    };
    const path = payload.ok ? payload.result?.file_path : undefined;
    if (!path) {
      // Telegram хранит файлы не вечно, и недоступное вложение — не
      // авария панели: менеджер должен увидеть, что файла больше нет, а
      // не пустой экран.
      return new Response('Вложение недоступно у Telegram', { status: 404 });
    }

    const range = request.headers.get('range');
    const streaming = range !== null && streamsRange(attachment.kind);
    const fileUrl = `https://api.telegram.org/file/bot${token}/${path}`;
    let file = await fetch(fileUrl, streaming ? { headers: { range } } : {});
    if (streaming && !file.ok) {
      // Отказ в куске — не отказ в файле: просим его целиком и режем
      // сами, иначе менеджер читал бы «недоступно» о живом файле.
      file = await fetch(fileUrl);
    }
    if (!file.ok) {
      return new Response('Вложение недоступно у Telegram', { status: 404 });
    }

    if (streaming && file.status === 206 && file.body) {
      // Тип без байтов: у звука и видео его называет Telegram или наше
      // умолчание по роду, и сигнатуре тут решать нечего.
      return new Response(file.body, {
        status: 206,
        headers: {
          ...attachmentHeaders(attachment, EMPTY_HEAD),
          ...rangeHeadersOf(file.headers),
        },
      });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const piece = sliceRange(bytes, range, streamsRange(attachment.kind));
    return new Response(piece.body, {
      status: piece.status,
      headers: { ...attachmentHeaders(attachment, bytes.subarray(0, 16)), ...piece.headers },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
