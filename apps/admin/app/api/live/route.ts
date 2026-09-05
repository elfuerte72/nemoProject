import type { LiveEvent } from '@nemo/core';
import { requireStaffActorOrNull } from '@/lib/auth/require-session';
import { getCore } from '@/lib/core';
import { LIVE_HEARTBEAT_MS, LIVE_STREAM_MAX_MS } from '@/lib/live';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Открытое соединение, в которое панель узнаёт о событиях.
 *
 * Поток событий, а не веб-сокет: говорит здесь только сервер — «на
 * этом экране что-то устарело», — а браузер отвечать ему нечем.
 * Обратный канал у панели уже есть, это обычные запросы её же
 * маршрутов. Плата за двусторонний канал — свой сервер вместо
 * стандартного и своя жизнь соединения; ни то, ни другое ради одного
 * слова «устарело» не окупается.
 *
 * Само событие несёт только тему: что именно изменилось, вкладка
 * узнает, перечитав свой экран. Так в этот поток не попадает ничего о
 * клиентах и деньгах — а поток открыт долго, и всё, что в него
 * попадает, живёт в памяти браузера до закрытия вкладки.
 *
 * Слушателей раздаёт ядро: подписка на канал базы одна на процесс, и
 * второй такой маршрут её не заведёт (`packages/core/src/live-events.ts`).
 *
 * Вход обязателен, как и везде в панели: событие говорит, что в
 * сервисе идёт работа, и постороннему знать об этом незачем.
 */
export async function GET(request: Request): Promise<Response> {
  const actor = await requireStaffActorOrNull();
  if (!actor) {
    return new Response('Требуется вход', { status: 401 });
  }

  const encoder = new TextEncoder();
  /*
   * Уборка живёт снаружи потока: её зовут двое — обрыв со стороны
   * браузера и сам поток, когда его отменяют, — и ни один из них не
   * видит внутренностей `start`.
   */
  let cleanup: (() => Promise<void>) | undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      /*
       * Два состояния, а не одно. «Писать больше некуда» и «прибрано»
       * — разные вещи: сорвавшаяся запись закрывает первое, но уборку
       * ещё только предстоит сделать. Одним флагом на оба смысла
       * неудачная запись отменяла бы и уборку — таймер бил бы в пустоту
       * до перезапуска процесса, а слушатель остался бы в ядре.
       */
      let writable = true;
      let ended = false;

      const send = (chunk: string): void => {
        if (!writable) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // Вкладку закрыли между проверкой и записью. Уборку сделает
          // отмена потока или обрыв запроса — здесь только замолкаем.
          writable = false;
        }
      };

      /*
       * Подписка может не завестись — база не отвечает. Поток при этом
       * остаётся открытым и пустым: вкладка живёт таймером, как жила до
       * толчков, а не переоткрывает соединение каждые пару секунд,
       * пока база не вернётся.
       */
      let unsubscribe: (() => Promise<void>) | undefined;
      try {
        unsubscribe = await getCore().subscribeToLiveEvents((event: LiveEvent) => {
          send(`data: ${JSON.stringify(event)}\n\n`);
        });
      } catch {
        unsubscribe = undefined;
      }

      /*
       * Пустая строка-комментарий каждые полминуты. Молчащее соединение
       * закрывают промежуточные узлы — прокси, мобильная сеть, сам
       * браузер, — и делают это молча: страница осталась бы открытой,
       * а событий в ней больше не появилось бы никогда.
       */
      const heartbeat = setInterval(() => send(`: ping\n\n`), LIVE_HEARTBEAT_MS);

      /*
       * Соединение живёт не вечно: браузер переоткроет его сам, а
       * процесс, переживший ночь с забытыми вкладками, не копит потоки,
       * о которых уже некому вспомнить.
       */
      const expiry = setTimeout(() => void close(), LIVE_STREAM_MAX_MS);

      async function close(): Promise<void> {
        if (ended) return;
        ended = true;
        writable = false;
        clearInterval(heartbeat);
        clearTimeout(expiry);
        await unsubscribe?.();
        try {
          controller.close();
        } catch {
          // Уже закрыт с той стороны.
        }
      }

      cleanup = close;
      request.signal.addEventListener('abort', () => void close());
      if (request.signal.aborted) await close();

      // Первое событие — сразу: по нему вкладка понимает, что канал
      // открыт, а не висит в ожидании ответа.
      send(`: open\n\n`);
    },

    // Поток отменяют, когда читатель ушёл: без этого уборка держалась бы
    // на одном лишь обрыве запроса.
    async cancel() {
      await cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      // `no-transform` — чтобы промежуточный узел не собирал поток в
      // буфер: собранный, он доходит одним куском в конце и опаздывает
      // ровно на то время, ради которого всё это и заведено.
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
}
