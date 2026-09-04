import { botToken } from '@nemo/telegram';
import { errorResponse } from '@/lib/api';
import { attachmentHeaders, sliceRange } from '@/lib/attachment-response';
import { requireStaffActor } from '@/lib/auth/require-session';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
 * Тело читается целиком, а не стримится: с какими заголовками отдать
 * файл, решают его первые байты (`attachment-response.ts`), а Telegram
 * отдаёт ботам не больше 20 МБ — в память панели это помещается. Из
 * того же буфера вырезается кусок по заголовку Range: без него плеер
 * Safari от файла отказывается.
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

    const file = await fetch(`https://api.telegram.org/file/bot${token}/${path}`);
    if (!file.ok) {
      return new Response('Вложение недоступно у Telegram', { status: 404 });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const piece = sliceRange(bytes, request.headers.get('range'));
    return new Response(piece.body, {
      status: piece.status,
      headers: { ...attachmentHeaders(attachment, bytes.subarray(0, 16)), ...piece.headers },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
