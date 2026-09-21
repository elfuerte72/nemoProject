import { exchangeKindSchema } from '@nemo/types';
import { LIVE_HEARTBEAT_MS, LIVE_STREAM_MAX_MS } from '@nemo/ui/live';
import { viewerOrNull } from '@/lib/auth';
import { getCore } from '@/lib/core';
import { listDirectionRates } from '@/lib/direction-rates';
import { subscribeToRates } from '@/lib/rates-ticker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Открытое соединение, в которое табло узнаёт новый курс.
 *
 * Поток событий, а не веб-сокет: говорит здесь только сервер — «курс
 * стал такой», — а отвечать ему браузеру нечем. Тот же выбор и та же
 * причина, что у живого канала панели (docs/adr/0014).
 *
 * Отличие от панельного канала одно и намеренное: панель шлёт в поток
 * одну лишь тему, а вкладка перечитывает свой экран сама — так в долго
 * открытый поток не попадает ничего о клиентах и деньгах. Здесь в
 * поток идут сами числа, и на это три причины. Число тут и есть
 * предмет: перечитывать страницу целиком ради полутора десятков курсов
 * дороже, чем прислать полтора десятка курсов. Подсветка изменившейся
 * строки требует сравнить новое со старым, а сравнивать можно только
 * то, что пришло. И курс — это прайс: он один для всех мерчантов, его
 * же показывает бот любому клиенту, и тайны в нём нет.
 *
 * Обход справочника при этом один на процесс, сколько бы вкладок ни
 * смотрело (`lib/rates-ticker.ts`).
 *
 * Вход обязателен, как и везде в кабинете: посторонним здесь делать
 * нечего, а открытый поток живёт долго.
 */
export async function GET(request: Request): Promise<Response> {
  const viewer = await viewerOrNull();
  if (!viewer) {
    return new Response('Требуется вход', { status: 401 });
  }

  const kind = exchangeKindSchema.safeParse(new URL(request.url).searchParams.get('kind'));
  const watching = kind.success ? kind.data : 'electronic';

  const encoder = new TextEncoder();
  /*
   * Уборка живёт снаружи потока: её зовут двое — обрыв со стороны
   * браузера и сам поток, когда его отменяют, — и ни один из них не
   * видит внутренностей `start`.
   */
  let cleanup: (() => void) | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      /*
       * Два состояния, а не одно. «Писать больше некуда» и «прибрано» —
       * разные вещи: сорвавшаяся запись закрывает первое, но уборку ещё
       * предстоит сделать. Одним флагом на оба смысла неудачная запись
       * отменяла бы и уборку — таймер бил бы в пустоту до перезапуска
       * процесса, а слушатель остался бы в тикере.
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

      const unsubscribe = subscribeToRates(
        (wanted) => listDirectionRates(getCore(), wanted).then((read) => read.directions),
        watching,
        (directions) => {
          send(`data: ${JSON.stringify({ directions })}\n\n`);
        },
      );

      /*
       * Вдох каждые полминуты: молчащее соединение закрывают
       * промежуточные узлы, и делают это молча — страница осталась бы
       * открытой, а курс в ней застыл бы навсегда.
       *
       * Событием, а не строкой-комментарием, как у панели: комментарий
       * держит соединение, но браузеру не виден, а табло по этим вдохам
       * и узнаёт, что поток жив. Кадры идут редко — курс меняется раз в
       * минуту, и бывает, что не меняется вовсе, — так что молчание
       * потока само по себе ни о чём не говорит.
       */
      const heartbeat = setInterval(
        () => send('event: ping\ndata: {}\n\n'),
        LIVE_HEARTBEAT_MS,
      );

      /*
       * Соединение живёт не вечно: браузер переоткроет его сам, а
       * процесс, переживший ночь с забытой вкладкой, не копит потоки, о
       * которых уже некому вспомнить.
       */
      const expiry = setTimeout(() => close(), LIVE_STREAM_MAX_MS);

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
      request.signal.addEventListener('abort', () => close());
      if (request.signal.aborted) close();

      // Первым делом — знак, что канал открыт, а не висит в ожидании
      // ответа: курса здесь может не быть ещё полминуты.
      send(': open\n\n');
    },

    // Поток отменяют, когда читатель ушёл: без этого уборка держалась бы
    // на одном лишь обрыве запроса.
    cancel() {
      cleanup?.();
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
