import {
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_RESPONSE_CHARS,
  WEBHOOK_RETRY_MINUTES,
  WEBHOOK_TIMEOUT_MS,
  webhookEventBody,
} from '@nemo/core';
import {
  WEBHOOK_EVENT_LABELS,
  webhookEvents,
  type ExchangeRequestStatus,
  type WebhookEvent,
} from '@nemo/types';
import type { HowToItem } from '@nemo/ui';

/**
 * Страница «как встроить вебхук»: правила, заголовки, тело события и
 * примеры проверки подписи.
 *
 * Данными, а не разметкой, по двум причинам. Тексты проходят ту же
 * проверку на машинный набор, что письма и тексты бота, а тест не
 * должен собирать серверную страницу ради строк. И главное: числа и
 * примеры здесь не набраны рядом с объяснением, а взяты из ядра —
 * тело события собирает та же `webhookEventBody`, которой оно
 * записывается в очередь, сроки и повторы приходят константами. Текст,
 * сочинённый по памяти о формате, проверяет представление о нём, а
 * расходится с кодом молча.
 */

/**
 * Паузы между попытками числами, а не словами: так они приходят из
 * ядра, и «минуту, пять, пятнадцать и час» пришлось бы набирать рядом с
 * константой — то есть заводить второе место, где это записано.
 */
const RETRIES = WEBHOOK_RETRY_MINUTES.join(', ');
const TIMEOUT_SECONDS = WEBHOOK_TIMEOUT_MS / 1000;

export interface HeaderRow {
  readonly name: string;
  /** Постоянное значение; у подписи и типа события его нет — они свои у каждой доставки. */
  readonly value?: string;
  readonly detail: string;
}

/**
 * Заголовки запроса — ровно те, что уходят с доставкой. Их сверяет
 * тест: он забирает заголовки из настоящей отправки воркера, а не из
 * этого списка.
 */
export const WEBHOOK_HEADERS: readonly HeaderRow[] = [
  {
    name: 'content-type',
    value: 'application/json',
    detail: 'Тело всегда JSON в UTF-8. Форм и вложений не бывает.',
  },
  {
    name: 'user-agent',
    value: 'Tobee-Webhooks/1',
    detail: 'По нему наши доставки видно в журнале вашего сервера среди прочих запросов.',
  },
  {
    name: 'x-webhook-event',
    detail: 'Тип события строкой: он же лежит в поле type. По нему удобно ветвить обработчик.',
  },
  {
    name: 'x-webhook-signature',
    detail:
      'Подпись вида sha256=… — HMAC-SHA256 секрета точки от тела запроса. Считается по ' +
      'сырому телу, до разбора JSON.',
  },
];

export interface BodyField {
  readonly name: string;
  readonly type: string;
  readonly detail: string;
}

/**
 * Поля тела. Список набран руками, и поэтому его сверяет тест с
 * настоящим телом: разъехавшись, таблица врала бы о формате, а
 * разработчик мерчанта искал бы поле, которого нет.
 */
export const WEBHOOK_BODY_FIELDS: readonly BodyField[] = [
  {
    name: 'id',
    type: 'строка',
    detail:
      'Идентификатор события. Повтор после обрыва связи уходит с тем же id, и по нему вы отбрасываете дубли.',
  },
  {
    name: 'type',
    type: 'строка',
    detail: 'Что случилось. Тот же набор, на который вы подписались у точки.',
  },
  {
    name: 'requestId',
    type: 'строка или null',
    detail:
      'Номер заявки. По нему забирают подробности через GET /api/v1/exchange-requests/{id}. У пробного события его нет.',
  },
  {
    name: 'status',
    type: 'строка или null',
    detail: 'Новое состояние заявки после перехода. У пробного события его нет.',
  },
  {
    name: 'at',
    type: 'строка ISO 8601',
    detail: 'Когда случился переход, по UTC. Не время доставки: повтор придёт позже с тем же at.',
  },
];

export interface EventExample {
  readonly event: WebhookEvent;
  readonly label: string;
  readonly body: string;
}

/** Состояние заявки, с которым приходит каждое событие. */
const STATUS_OF: Record<WebhookEvent, ExchangeRequestStatus | null> = {
  'exchange_request.created': 'new',
  'exchange_request.rate_confirmed': 'rate_confirmed',
  'exchange_request.payment_received': 'payment_received',
  'exchange_request.completed': 'completed',
  'exchange_request.cancelled': 'cancelled',
  ping: null,
};

const EXAMPLE_ID = '0f0a1c2e-5b34-4a71-9f0e-2b6d5c8a1d33';
const EXAMPLE_REQUEST = 'a3c1f0d2-8e47-4b19-b0c5-7d2e9f4a6b81';
const EXAMPLE_AT = new Date('2026-09-10T09:14:03.000Z');

/**
 * Тело каждого вида — тем же кодом, каким оно уходит в очередь. Правка
 * формата в ядре меняет пример на экране сама.
 */
export const WEBHOOK_EVENT_EXAMPLES: readonly EventExample[] = webhookEvents.map((event) => ({
  event,
  label: WEBHOOK_EVENT_LABELS[event],
  body: webhookEventBody({
    id: EXAMPLE_ID,
    event,
    requestId: event === 'ping' ? null : EXAMPLE_REQUEST,
    status: STATUS_OF[event],
    at: EXAMPLE_AT,
  }),
}));

export interface CodeExample {
  readonly language: 'node' | 'python' | 'php';
  readonly label: string;
  readonly code: string;
}

/**
 * Проверка подписи на трёх языках.
 *
 * Одно и то же на всех трёх, и оно же — то место, где спотыкаются все:
 * подпись считана по сырому телу, а не по тексту, пересобранному из
 * разобранного объекта. Пересборка меняет пробелы и порядок ключей, и
 * подпись не сходится при верном секрете.
 *
 * Пример на Node.js исполняется тестом и проверяет настоящую подпись:
 * код, который мы показываем, обязан работать.
 */
export const SIGNATURE_EXAMPLES: readonly CodeExample[] = [
  {
    language: 'node',
    label: 'Node.js',
    code: `import { createHmac, timingSafeEqual } from 'node:crypto';

// rawBody — текст запроса как есть, до JSON.parse.
// В Express: express.raw({ type: 'application/json' }).
function verifyWebhook(rawBody, signature, secret) {
  const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature ?? '');
  return a.length === b.length && timingSafeEqual(a, b);
}

app.post('/hooks/tobee', express.raw({ type: 'application/json' }), (req, res) => {
  if (!verifyWebhook(req.body, req.get('x-webhook-signature'), process.env.TOBEE_WEBHOOK_SECRET)) {
    return res.sendStatus(401);
  }
  const event = JSON.parse(req.body.toString('utf8'));
  res.sendStatus(200); // Сначала ответ, работа после него.
  queue.add(event); // Дубль по event.id отбросьте в очереди.
});`,
  },
  {
    language: 'python',
    label: 'Python',
    code: `import hashlib, hmac, json

# raw_body — bytes из запроса, до json.loads.
# Во Flask: request.get_data(); в FastAPI: await request.body().
def verify_webhook(raw_body: bytes, signature: str, secret: str) -> bool:
    digest = hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest("sha256=" + digest, signature or "")

@app.post("/hooks/tobee")
def hooks():
    raw = request.get_data()
    if not verify_webhook(raw, request.headers.get("x-webhook-signature", ""), SECRET):
        return "", 401
    event = json.loads(raw)
    enqueue(event)  # Дубль по event["id"] отбросьте в очереди.
    return "", 200`,
  },
  {
    language: 'php',
    label: 'PHP',
    code: `<?php
// Сырое тело: php://input, а не $_POST и не перекодированный json_encode.
$raw = file_get_contents('php://input');

// Заголовок x-webhook-signature приезжает в $_SERVER под этим именем.
$signature = $_SERVER['HTTP_X_WEBHOOK_SIGNATURE'] ?? '';
$expected = 'sha256=' . hash_hmac('sha256', $raw, getenv('TOBEE_WEBHOOK_SECRET'));

if (!hash_equals($expected, $signature)) {
    http_response_code(401);
    exit;
}

$event = json_decode($raw, true);
http_response_code(200); // Сначала ответ, работа после него.

// Отпустить соединение умеет только PHP-FPM; под mod_php функции нет,
// и без проверки строка ниже роняет обработчик после нашего 200.
if (function_exists('fastcgi_finish_request')) {
    fastcgi_finish_request();
}

enqueue($event); // Дубль по $event['id'] отбросьте в очереди.`,
  },
];

/**
 * Правила словами: что отвечать, как устроены повторы, каким должен
 * быть адрес, чего ждать от порядка событий.
 *
 * Числа приходят из ядра, а не набраны здесь: срок ответа, паузы между
 * попытками и число попыток правятся в одном месте.
 */
export const WEBHOOK_GUIDE_RULES: readonly HowToItem[] = [
  {
    title: 'Что отвечать',
    detail:
      `Любой код 2xx за ${TIMEOUT_SECONDS} секунд. Отвечайте сразу, а событие кладите в свою ` +
      'очередь: сервис ждёт подтверждения приёма, а не окончания вашей работы. Приёмник, ' +
      'который ходит в банк, пока держит наше соединение, рано или поздно не успеет.',
  },
  {
    title: 'Что считается неудачей',
    detail:
      `Код вне 2xx, молчание дольше ${TIMEOUT_SECONDS} секунд, обрыв связи, переезд по редиректу. ` +
      `Ответ вашего сервера мы сохраняем первыми ${WEBHOOK_RESPONSE_CHARS} знаками и показываем ` +
      'в журнале доставок: по ним и видно, чем он подавился.',
  },
  {
    title: 'Повторы',
    detail:
      `Неудачная доставка повторяется через ${RETRIES} минут. Всего попыток ${WEBHOOK_MAX_ATTEMPTS}; ` +
      'после последней мы пишем вам письмо и отмечаем точку неотвечающей. События при этом ' +
      'продолжают ей писаться: отметка говорит о беде, но приём не гасит.',
  },
  {
    title: 'Требования к адресу',
    detail:
      'Только https на публичное имя. Адрес по IP не принимается: сертификат выдают на имя. ' +
      'Куда имя указывает, сервис проверяет перед каждой отправкой, и во внутреннюю сеть он ' +
      'не ходит. Одноразовые приёмники вроде webhook.site отклоняются: проверить доставку ' +
      'можно кнопкой «пробное».',
  },
  {
    title: 'Секрет точки',
    detail:
      'У каждой точки свой, виден в разделе «Вебхуки». Держите его в переменной окружения ' +
      'рядом с ключом API. Запрос без сошедшейся подписи обрабатывать нельзя: адрес приёмника ' +
      'рано или поздно узнают посторонние.',
  },
  {
    title: 'Пауза и удаление',
    detail:
      'Точка на паузе новых событий не получает, а начатые доставки доходят до конца. Так ' +
      'останавливают приём на время работ: за неделю простоя на приёмник не обрушится неделя ' +
      'событий. Удаление гасит ожидающие доставки, история остаётся.',
  },
];

/**
 * Три правила приёмника, из-за которых чаще всего и приходят чинить
 * интеграцию. Стоят отдельным списком, а не абзацем среди прочего:
 * пропустив их, приёмник работает ровно до первого обрыва связи.
 */
export const WEBHOOK_CHECKLIST: readonly HowToItem[] = [
  {
    title: 'Порядок доставки не гарантирован',
    detail:
      'Событие об исполнении заявки приходит раньше события о подтверждённом курсе, если ' +
      'первая доставка сорвалась и ушла в повтор. Состояние берите из поля status, а не из ' +
      'порядка, в котором события пришли.',
  },
  {
    title: 'Событие приходит дважды',
    detail:
      'Ваш сервер ответил, а ответ до нас не доехал — доставка считается неудачной и ' +
      'повторяется. Так бывает у всех, и приёмник обязан быть к этому готов.',
  },
  {
    title: 'Обработка идемпотентна по id',
    detail:
      'Запоминайте обработанные id и повтор отбрасывайте до всякой работы. Это единственное, ' +
      'что отличает приёмник, переживающий обрыв связи, от приёмника, выплачивающего дважды.',
  },
];
