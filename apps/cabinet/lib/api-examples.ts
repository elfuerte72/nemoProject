import type { CodeExample } from '@/lib/webhook-guide';

/**
 * Пример запроса к API — на странице «API», с хвостом настоящего ключа
 * мерчанта: чужой пример копируют вместе с чужим ключом, свой — узнают.
 * Самого ключа здесь нет: его нет и у нас.
 *
 * Строкой в коде, а не в документации: пример правится вместе с
 * подписью (`lib/v1/signature.ts`), и разъехаться им негде. Что он
 * верен, проверено 24 сентября 2026 запуском каждого языка против
 * `verifySignature`; Node-вариант сверяется тестом.
 *
 * Подписанный вариант — когда мерчант включил подпись: без неё запрос
 * получит 401, и пример без подписи учил бы получать 401. У curl
 * подписанного варианта нет: из оболочки подпись считают разве что для
 * пробы, а пробовать проще с выключенной.
 */

export interface ExampleOptions {
  /** Адрес кабинета без хвостовой косой; пустой — заглушка словами. */
  readonly origin: string;
  /** Хвост ключа: «sk_live_…a1b2». */
  readonly keyHint: string | null;
  readonly signed: boolean;
}

/** Тело примера — одно на все языки: котировка ста USDT в рубли. */
const BODY = '{"from":"USDT","to":"RUB","amount":"100","side":"from"}';

export function requestExamples(options: ExampleOptions): readonly CodeExample[] {
  const origin = options.origin || 'https://<домен кабинета>';
  const hint = options.keyHint ?? 'sk_live_…';

  return [
    { language: 'node', label: 'Node.js', code: options.signed ? nodeSigned(origin, hint) : nodePlain(origin, hint) },
    {
      language: 'python',
      label: 'Python',
      code: options.signed ? pythonSigned(origin, hint) : pythonPlain(origin, hint),
    },
    { language: 'php', label: 'PHP', code: options.signed ? phpSigned(origin, hint) : phpPlain(origin, hint) },
    ...(options.signed ? [] : [{ language: 'curl' as const, label: 'curl', code: curl(origin) }]),
  ];
}

function nodePlain(origin: string, hint: string): string {
  return `const KEY = process.env.TOBEE_API_KEY; // ${hint}

const response = await fetch('${origin}/api/v1/quote', {
  method: 'POST',
  headers: {
    authorization: \`Bearer \${KEY}\`,
    'content-type': 'application/json',
  },
  body: JSON.stringify({ from: 'USDT', to: 'RUB', amount: '100', side: 'from' }),
});
console.log(response.headers.get('x-request-id')); // назовите его поддержке, если что-то не так
const { quote } = await response.json();
// quote.rate, quote.to.amount, quote.quotedAt — отметка для подачи`;
}

function nodeSigned(origin: string, hint: string): string {
  return `import { createHash, createHmac } from 'node:crypto';

const KEY = process.env.TOBEE_API_KEY; // ${hint}
// У GET путь подписывается вместе со строкой запроса:
// '/api/v1/exchange-requests?limit=50', а тело — пустая строка.
const path = '/api/v1/quote';
const body = JSON.stringify({ from: 'USDT', to: 'RUB', amount: '100', side: 'from' });
const timestamp = String(Math.floor(Date.now() / 1000)); // секунды, не миллисекунды

const digest = createHash('sha256').update(body).digest('hex');
const signature = createHmac('sha256', KEY)
  .update(['POST', path, timestamp, digest].join('\\n'))
  .digest('hex');

const response = await fetch('${origin}' + path, {
  method: 'POST',
  headers: {
    'x-api-key': KEY,
    'x-timestamp': timestamp,
    'x-signature': signature,
    'content-type': 'application/json',
  },
  body, // ровно та строка, что подписана
});
console.log(response.headers.get('x-request-id')); // назовите его поддержке, если что-то не так`;
}

function pythonPlain(origin: string, hint: string): string {
  return `import json, os, urllib.request

KEY = os.environ['TOBEE_API_KEY']  # ${hint}

request = urllib.request.Request(
    '${origin}/api/v1/quote',
    data=b'${BODY}',
    method='POST',
    headers={'authorization': f'Bearer {KEY}', 'content-type': 'application/json'},
)
with urllib.request.urlopen(request) as response:
    quote = json.load(response)['quote']`;
}

function pythonSigned(origin: string, hint: string): string {
  return `import hashlib, hmac, json, os, time, urllib.request

KEY = os.environ['TOBEE_API_KEY']  # ${hint}
path = '/api/v1/quote'
body = '${BODY}'
timestamp = str(int(time.time()))  # секунды

digest = hashlib.sha256(body.encode()).hexdigest()
message = '\\n'.join(['POST', path, timestamp, digest])
signature = hmac.new(KEY.encode(), message.encode(), hashlib.sha256).hexdigest()

request = urllib.request.Request(
    '${origin}' + path,
    data=body.encode(),  # ровно та строка, что подписана
    method='POST',
    headers={
        'x-api-key': KEY,
        'x-timestamp': timestamp,
        'x-signature': signature,
        'content-type': 'application/json',
    },
)
with urllib.request.urlopen(request) as response:
    quote = json.load(response)['quote']`;
}

function phpPlain(origin: string, hint: string): string {
  return `$key = getenv('TOBEE_API_KEY'); // ${hint}

$ch = curl_init('${origin}/api/v1/quote');
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => '${BODY}',
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => ["authorization: Bearer $key", 'content-type: application/json'],
]);
$quote = json_decode(curl_exec($ch), true)['quote'];`;
}

function phpSigned(origin: string, hint: string): string {
  return `$key = getenv('TOBEE_API_KEY'); // ${hint}
$path = '/api/v1/quote';
$body = '${BODY}';
$timestamp = (string) time(); // секунды

$message = implode("\\n", ['POST', $path, $timestamp, hash('sha256', $body)]);
$signature = hash_hmac('sha256', $message, $key);

$ch = curl_init('${origin}' . $path);
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => $body, // ровно та строка, что подписана
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => [
        "x-api-key: $key",
        "x-timestamp: $timestamp",
        "x-signature: $signature",
        'content-type: application/json',
    ],
]);
$quote = json_decode(curl_exec($ch), true)['quote'];`;
}

function curl(origin: string): string {
  return `curl -i -X POST '${origin}/api/v1/quote' \\
  -H "authorization: Bearer $TOBEE_API_KEY" \\
  -H 'content-type: application/json' \\
  -d '${BODY}'
# -i покажет заголовки: x-request-id и остаток предела x-ratelimit-*`;
}
