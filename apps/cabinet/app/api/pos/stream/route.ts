import { viewerOrNull } from '@/lib/auth';
import { subscribePos, type PosEvent } from '@/lib/pos/bus';
import { POS_HEARTBEAT_MS, POS_STREAM_MAX_MS } from '@/lib/pos/stream';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Открытое соединение, в которое кабинет узнаёт о событиях терминала:
 * счёт оплачен, истёк, отменён, заявлен возврат, поменялись настройки.
 *
 * Поток событий, а не веб-сокет, и по той же причине, что у панели
 * (docs/adr/0014): говорит здесь только сервер, а обратный канал у
 * кабинета уже есть — его же маршруты. Событие несёт тему и
 * идентификатор, ничего о деньгах: поток открыт долго, и всё, что в
 * него попадает, живёт в памяти браузера до закрытия вкладки.
 *
 * Слушает вкладка события своего мерчанта и только его: комната шины
 * — идентификатор мерчанта из сессии, а не из запроса.
 */
export async function GET(request: Request): Promise<Response> {
  const who = await viewerOrNull();
  if (!who) return new Response('Требуется вход', { status: 401 });
  const merchantId = who.actor.merchantId;

  const encoder = new TextEncoder();
  let cleanup: (() => void) | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let writable = true;
      let ended = false;

      const send = (chunk: string): void => {
        if (!writable) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          writable = false;
        }
      };

      const unsubscribe = subscribePos(merchantId, (event: PosEvent) => {
        send(`data: ${JSON.stringify(event)}\n\n`);
      });

      const heartbeat = setInterval(() => send(`: ping\n\n`), POS_HEARTBEAT_MS);
      const expiry = setTimeout(() => close(), POS_STREAM_MAX_MS);

      function close(): void {
        if (ended) return;
        ended = true;
        writable = false;
        clearInterval(heartbeat);
        clearTimeout(expiry);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Уже закрыт с той стороны.
        }
      }

      cleanup = close;
      request.signal.addEventListener('abort', close);
      if (request.signal.aborted) close();

      send(`: open\n\n`);
    },
    cancel() {
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
}
