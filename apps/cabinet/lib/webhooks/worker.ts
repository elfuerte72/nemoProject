import { lookup } from 'node:dns/promises';
import {
  signWebhookBody,
  WEBHOOK_RESPONSE_CHARS,
  WEBHOOK_TIMEOUT_MS,
  type Notification,
  type WebhookDeliveryResult,
  type WebhookJob,
} from '@nemo/core';

/**
 * Воркер вебхуков: забирает доставки из очереди в базе и шлёт их
 * приёмникам мерчантов (docs/adr/0018).
 *
 * Живёт с процессом на `globalThis`, как ядро и обновление курса
 * (docs/adr/0010): Next пересобирает модули в разработке, и с
 * переменной модуля таймеров выходило бы столько, сколько было
 * пересборок, — каждый со своей попыткой отправить одно и то же.
 * Второй процесс кабинета воркер не ломает: строки берутся из базы
 * `for update skip locked`, и общая у процессов только она.
 *
 * Зависимости приходят снаружи: так тик проверяется без базы и без
 * сети, а приёмник в тесте подменяется одной функцией.
 */

export interface WebhookWorkerDeps {
  readonly take: (now: Date, limit: number) => Promise<readonly WebhookJob[]>;
  readonly record: (
    deliveryId: string,
    result: WebhookDeliveryResult,
    now: Date,
  ) => Promise<{ readonly notifications: readonly Notification[] }>;
  readonly deliver: (job: WebhookJob) => Promise<WebhookDeliveryResult>;
  readonly mail: (notifications: readonly Notification[]) => Promise<void>;
  readonly now: () => Date;
}

/** Как часто воркер заглядывает в очередь и сколько строк берёт за раз. */
export const WORKER_INTERVAL_MS = 5_000;
export const WORKER_BATCH = 20;

/**
 * Одна доставка от начала до конца: отправить, записать исход, при
 * провале — письмо. Отказ почты не отменяет записанного исхода и не
 * роняет соседние доставки: отметка у точки уже стоит, а письмо —
 * следствие, и его отказ пишется в журнал.
 */
export async function processWebhookJob(deps: WebhookWorkerDeps, job: WebhookJob): Promise<void> {
  const result = await deps.deliver(job);
  const { notifications } = await deps.record(job.deliveryId, result, deps.now());
  if (notifications.length === 0) return;
  try {
    await deps.mail(notifications);
  } catch (failure) {
    console.error('Письмо о неотвечающем вебхуке не ушло', failure);
  }
}

/**
 * Один заход: забрать подошедшие, отправить каждую, записать исход.
 * Доставки идут разом, а не по очереди: приёмник, отвечающий десять
 * секунд, иначе задержал бы всех остальных на свои десять. Отказ одной
 * не роняет остальных. Возвращает, сколько строк взято, — тесту и журналу.
 */
export async function runWebhookTick(deps: WebhookWorkerDeps): Promise<number> {
  const jobs = await deps.take(deps.now(), WORKER_BATCH);
  await Promise.all(
    jobs.map((job) =>
      processWebhookJob(deps, job).catch((failure: unknown) => {
        console.error('Доставка вебхука упала', job.deliveryId, failure);
      }),
    ),
  );
  return jobs.length;
}

/** Кто отвечает на имя: настоящий DNS в работе, список адресов в тесте. */
export type Resolver = (hostname: string) => Promise<readonly string[]>;

async function resolveAll(hostname: string): Promise<readonly string[]> {
  const found = await lookup(hostname, { all: true });
  return found.map((one) => one.address);
}

/**
 * Внутренний ли адрес: петля, частные сети, локальная связь, CGNAT,
 * служебные диапазоны. Имя точки проверило ядро при заведении, но имя
 * можно направить куда угодно, а по адресу сервис ходит сам — во
 * внутреннюю сеть он не ходит.
 */
export function isPrivateAddress(address: string): boolean {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  if (mapped) return isPrivateAddress(mapped[1]!);

  if (address.includes(':')) {
    const lower = address.toLowerCase();
    if (lower === '::' || lower === '::1') return true;
    // fc00::/7 — уникальные локальные, fe80::/10 — локальная связь.
    return /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower);
  }

  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((one) => !Number.isInteger(one) || one < 0 || one > 255)) {
    return true;
  }
  const [a, b] = parts as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

/**
 * Первые знаки ответа — потоком, а не целиком: приёмник, отдающий
 * гигабайт за десять секунд, иначе положил бы процесс кабинета.
 */
async function readHead(response: Response, chars: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let text = '';
  try {
    while (text.length < chars) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return text.slice(0, chars);
}

/**
 * Отправка одной доставки: `POST` с телом как есть и подписью в
 * заголовке. Тело не пересобирается — повтор уходит байт в байт, с той
 * же подписью и тем же `id`: по нему приёмник и отбрасывает дубли.
 *
 * Ответ 2xx — доставлено; всё остальное, включая молчание дольше
 * десяти секунд, — неудача со словами о причине. Ответ приёмника
 * хранится первыми знаками: по ним видно, чем он подавился.
 */
export async function deliverWebhook(
  job: WebhookJob,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
  resolve: Resolver = resolveAll,
): Promise<WebhookDeliveryResult> {
  const started = performance.now();
  const elapsed = () => performance.now() - started;

  let addresses: readonly string[];
  try {
    addresses = await resolve(new URL(job.url).hostname);
  } catch (failure) {
    return { ok: false, error: `Имя не разрешилось: ${describeFailure(failure)}`, durationMs: elapsed() };
  }
  const internal = addresses.find(isPrivateAddress);
  if (internal !== undefined || addresses.length === 0) {
    return {
      ok: false,
      error: internal
        ? `Адрес указывает во внутреннюю сеть (${internal}): туда сервис не ходит`
        : 'Имя не разрешилось ни в один адрес',
      durationMs: elapsed(),
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    const response = await fetchImpl(job.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Tobee-Webhooks/1',
        'x-webhook-event': job.event,
        'x-webhook-signature': signWebhookBody(job.secret, job.body),
      },
      body: job.body,
      redirect: 'manual',
      signal: controller.signal,
    });
    const text = await readHead(response, WEBHOOK_RESPONSE_CHARS);
    if (response.ok) {
      return { ok: true, responseStatus: response.status, responseBody: text, durationMs: elapsed() };
    }
    return {
      ok: false,
      responseStatus: response.status,
      responseBody: text,
      error: `Ответ ${response.status}: ждём 2xx`,
      durationMs: elapsed(),
    };
  } catch (failure) {
    const aborted = failure instanceof Error && failure.name === 'AbortError';
    return {
      ok: false,
      error: aborted
        ? `Приёмник не ответил за ${WEBHOOK_TIMEOUT_MS / 1000} с`
        : `Соединение не удалось: ${describeFailure(failure)}`,
      durationMs: elapsed(),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Причина отказа словами: код из `cause` у `fetch` говорит больше, чем «fetch failed». */
function describeFailure(failure: unknown): string {
  if (!(failure instanceof Error)) return 'неизвестная причина';
  const cause = (failure as { cause?: { code?: unknown } }).cause;
  if (cause && typeof cause.code === 'string') return cause.code;
  const code = (failure as { code?: unknown }).code;
  return typeof code === 'string' ? code : failure.message;
}

interface RunningWorker {
  readonly timer: ReturnType<typeof setInterval>;
  /** Тик, который ещё идёт: следующий его не догоняет. */
  running: Promise<unknown> | null;
  stop: () => void;
}

const KEY = Symbol.for('nemo.cabinet.webhook-worker');
type Holder = typeof globalThis & { [KEY]?: RunningWorker };

/**
 * Запуск воркера — один на процесс. Повторный вызов отдаёт тот же
 * воркер и второго таймера не заводит. Тик, не успевший закончиться к
 * следующему, не наслаивается: очередь берётся с лизингом, но два тика
 * одного процесса впустую тратили бы соединения к базе. Пробная
 * доставка из кабинета идёт мимо таймера, но берёт одну свою строку —
 * чужую очередь она не разбирает.
 */
export function startWebhookWorker(
  deps: WebhookWorkerDeps,
  intervalMs: number = WORKER_INTERVAL_MS,
): RunningWorker {
  const holder = globalThis as Holder;
  if (holder[KEY]) return holder[KEY];

  const worker: RunningWorker = {
    timer: setInterval(() => {
      if (worker.running) return;
      worker.running = runWebhookTick(deps)
        .catch((failure: unknown) => {
          // Воркер живёт дальше: очередь в базе никуда не денется, а
          // следующий тик попробует снова.
          console.error('Тик вебхуков упал', failure);
        })
        .finally(() => {
          worker.running = null;
        });
    }, intervalMs),
    running: null,
    stop: () => {
      clearInterval(worker.timer);
      delete holder[KEY];
    },
  };
  // Таймер не держит процесс: тестам и скриптам он не мешает выйти.
  worker.timer.unref?.();
  holder[KEY] = worker;
  return worker;
}

/** Идёт ли воркер в этом процессе — тесту на единственность. */
export function webhookWorkerRunning(): boolean {
  return (globalThis as Holder)[KEY] !== undefined;
}
