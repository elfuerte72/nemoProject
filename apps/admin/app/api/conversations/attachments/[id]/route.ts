import { botToken } from '@nemo/telegram';
import { errorResponse } from '@/lib/api';
import { requireStaffActor } from '@/lib/auth/require-session';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Изображение, присланное клиентом.
 *
 * Файл не хранится у сервиса — хранится его идентификатор у Telegram, и
 * панель забирает изображение клиентским токеном, который у неё уже есть
 * для уведомлений. На дисках сервиса чужих чеков при этом не появляется:
 * пока не ответят на блокер A1 о защите персональных данных, это
 * существенно.
 *
 * Каждый просмотр попадает в журнал доступа — операция записывает его в
 * той же транзакции, в которой отдаёт идентификатор, и пропустить запись
 * нельзя.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const actor = await requireStaffActor();
    const { id } = await context.params;
    const fileId = await getCore().revealMessageAttachment(actor, id);

    const token = botToken();
    const described = await fetch(
      `https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`,
    );
    const payload = (await described.json()) as {
      ok: boolean;
      result?: { file_path?: string };
    };
    const path = payload.ok ? payload.result?.file_path : undefined;
    if (!path) {
      // Telegram хранит файлы не вечно, и недоступное вложение — не
      // авария панели: менеджер должен увидеть, что изображения больше
      // нет, а не пустой экран.
      return new Response('Вложение недоступно у Telegram', { status: 404 });
    }

    const file = await fetch(`https://api.telegram.org/file/bot${token}/${path}`);
    if (!file.ok || !file.body) {
      return new Response('Вложение недоступно у Telegram', { status: 404 });
    }

    return new Response(file.body, {
      headers: {
        'content-type': file.headers.get('content-type') ?? 'image/jpeg',
        // Чужой чек не должен осесть в кэше браузера или посредника:
        // доступ к нему проверяется на каждом обращении и пишется в
        // журнал, а закэшированный ответ прошёл бы мимо обоих.
        'cache-control': 'no-store, private',
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
