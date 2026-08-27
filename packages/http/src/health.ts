/**
 * Ответ маршрута `/api/health` — один на оба приложения.
 *
 * Маршрут открыт без подписи: по нему стучат после выката и по нему же
 * может стучать внешний сторожок раз в минуту. Поэтому в ответе нет
 * ничего, что стоило бы прятать, — только «жив ли», имя приложения,
 * коммит сборки и состояние базы одним словом. Ни хоста базы, ни
 * текста ошибки: ошибка соединения называет адрес, а адрес снаружи
 * никому не нужен.
 *
 * База, которая не отвечает, — тоже ответ, и он обязан прийти: ожидание
 * ограничено, иначе повисший пул превращал бы проверку в тишину, а
 * тишина для сторожка неотличима от «всё хорошо».
 */

export interface HealthProbe {
  readonly app: 'miniapp' | 'admin';
  /** Коммит, из которого собрано приложение; `null`, если сборка его не знает. */
  readonly version: string | null;
  /** Пульс базы: отвергается или не приходит вовсе, когда базы нет. */
  readonly ping: () => Promise<unknown>;
  /** Сколько ждать базу, прежде чем счесть её молчащей. */
  readonly timeoutMs?: number;
}

export type DatabaseState = 'ok' | 'unreachable' | 'timeout';

const DEFAULT_TIMEOUT_MS = 3_000;

export async function healthResponse(probe: HealthProbe): Promise<Response> {
  const database = await probeDatabase(probe.ping, probe.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const ok = database === 'ok';
  const body = { ok, app: probe.app, version: probe.version, database };
  return new Response(JSON.stringify(body), {
    status: ok ? 200 : 503,
    headers: {
      'content-type': 'application/json',
      // Ответ про «сейчас», и кэш где угодно по дороге сделал бы его
      // ответом про «когда-то».
      'cache-control': 'no-store',
    },
  });
}

async function probeDatabase(
  ping: HealthProbe['ping'],
  timeoutMs: number,
): Promise<DatabaseState> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  try {
    // Через `then`, а не прямым вызовом: синхронный бросок из `ping`
    // (нет `DATABASE_URL`) — тоже «база недоступна», а не 500.
    const pulse = Promise.resolve()
      .then(ping)
      .then((): DatabaseState => 'ok');
    return await Promise.race([pulse, timeout]);
  } catch {
    return 'unreachable';
  } finally {
    clearTimeout(timer);
  }
}
