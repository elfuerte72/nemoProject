/**
 * Живая проверка API v1 на поднятом кабинете — от входа до отзыва ключа.
 *
 * Запуск: `pnpm tsx .scratch/merchant-cabinet/probe-api.mts` при
 * работающем `pnpm --filter @nemo/cabinet dev` и мерчанте из
 * `seed-dev.mts` в базе. Адрес переопределяется `CABINET_BASE`.
 *
 * Скрипт не тест: он ходит по живому серверу и печатает, что тот
 * ответил. Падает на первом же ответе, которого не ждал.
 */
import { createHash, createHmac } from 'node:crypto';

const BASE = process.env.CABINET_BASE ?? 'http://localhost:3002';
const EMAIL = process.env.PROBE_EMAIL ?? 'oplatishka@example.com';
const PASSWORD = process.env.PROBE_PASSWORD ?? 'правильная лошадь батарейка';

let cookie = '';
let secret = '';
let keyId = '';

function say(step: string, status: number, detail: unknown = ''): void {
  console.log(`${status}  ${step}`, typeof detail === 'string' ? detail : JSON.stringify(detail));
}

function expectStatus(step: string, response: Response, wanted: number): void {
  if (response.status !== wanted) {
    throw new Error(`${step}: ждали ${wanted}, получили ${response.status}`);
  }
}

async function cabinet(path: string, body?: unknown): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function api(
  method: string,
  path: string,
  body?: unknown,
  extra: Record<string, string> = {},
  key: string = secret,
): Promise<{ status: number; json: any }> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, json: await response.json().catch(() => null) };
}

// 1. Вход и ключ.
{
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  expectStatus('вход', login, 200);
  cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
  say('вход', login.status, await login.json());

  const issued = await cabinet('/api/keys', { label: `проба ${new Date().toISOString().slice(11, 19)}` });
  expectStatus('выпуск ключа', issued, 201);
  const data = (await issued.json()) as { key: { id: string; hint: string }; secret: string };
  secret = data.secret;
  keyId = data.key.id;
  say('выпуск ключа', issued.status, { hint: data.key.hint, secretLength: secret.length });
}

// 2. Курсы и котировка.
{
  const rates = await api('GET', '/api/v1/rates');
  if (rates.status !== 200) throw new Error(`rates: ${rates.status} ${JSON.stringify(rates.json)}`);
  say('GET /rates', rates.status, {
    pairs: rates.json.pairs.length,
    first: rates.json.pairs[0],
    minAmount: rates.json.minAmount,
  });

  const forward = await api('POST', '/api/v1/quote', { from: 'USDT', to: 'RUB', amount: '100' });
  say('POST /quote side=from', forward.status, forward.json);

  const reverse = await api('POST', '/api/v1/quote', {
    from: 'USDT',
    to: 'RUB',
    amount: '8000',
    side: 'to',
  });
  say('POST /quote side=to', reverse.status, reverse.json);

  const wrong = await api('POST', '/api/v1/quote', { from: 'USDT', to: 'XXX', amount: '100' });
  say('POST /quote чужое направление', wrong.status, wrong.json);
  if (wrong.status !== 422) throw new Error('ждали 422 на чужое направление');
}

// 3. Получатель, заявка, повтор, список, карточка, отмена.
let requestId = '';
let requisitesId = '';
{
  const saved = await api('POST', '/api/v1/requisites', {
    kind: 'phone',
    bankName: 'Т-Банк',
    phone: '+79991234567',
  });
  if (saved.status !== 201) throw new Error(`requisites: ${saved.status} ${JSON.stringify(saved.json)}`);
  requisitesId = saved.json.requisites.id;
  say('POST /requisites', saved.status, saved.json.requisites);

  const bad = await api('POST', '/api/v1/requisites', {
    kind: 'card',
    bankName: 'Т-Банк',
    cardNumber: '4111111111111112',
  });
  say('POST /requisites с опечаткой в карте', bad.status, bad.json);
  if (bad.status !== 422) throw new Error('ждали 422 на карту не по Луну');

  const noKey = await api('POST', '/api/v1/exchange-requests', {
    from: 'USDT',
    to: 'RUB',
    amount: '100',
    requisitesId,
  });
  say('POST /exchange-requests без Idempotency-Key', noKey.status, noKey.json);
  if (noKey.status !== 422) throw new Error('ждали 422 без ключа повтора');

  const idem = `probe-${Date.now()}`;
  const body = {
    from: 'USDT',
    to: 'RUB',
    amount: '100',
    reference: idem,
    payout: { kind: 'card', bankName: 'Сбербанк', cardNumber: '4111111111111111' },
  };
  const first = await api('POST', '/api/v1/exchange-requests', body, { 'idempotency-key': idem });
  if (first.status !== 201) throw new Error(`submit: ${first.status} ${JSON.stringify(first.json)}`);
  requestId = first.json.request.id;
  say('POST /exchange-requests', first.status, first.json.request);

  const again = await api('POST', '/api/v1/exchange-requests', body, { 'idempotency-key': idem });
  say('POST /exchange-requests повтор', again.status, { id: again.json.request.id });
  if (again.json.request.id !== requestId) throw new Error('повтор завёл вторую заявку');

  const list = await api('GET', '/api/v1/exchange-requests?limit=2');
  say('GET /exchange-requests?limit=2', list.status, {
    items: list.json.items.length,
    nextCursor: list.json.nextCursor,
  });
  if (list.json.nextCursor) {
    const { after, afterId } = list.json.nextCursor;
    const next = await api(
      'GET',
      `/api/v1/exchange-requests?limit=2&after=${encodeURIComponent(after)}&afterId=${afterId}`,
    );
    say('GET /exchange-requests по курсору', next.status, next.json.items ? { items: next.json.items.length } : next.json);
    if (next.status !== 200) throw new Error('курсор не прошёл');
  }

  const one = await api('GET', `/api/v1/exchange-requests/${requestId}`);
  say('GET /exchange-requests/:id', one.status, { status: one.json.request.status });

  const cancelled = await api('POST', `/api/v1/exchange-requests/${requestId}/cancel`);
  say('POST /exchange-requests/:id/cancel', cancelled.status, {
    status: cancelled.json.request?.status,
  });
  if (cancelled.status !== 200) throw new Error('отмена не прошла');

  const removed = await api('DELETE', `/api/v1/requisites/${requisitesId}`);
  say('DELETE /requisites/:id', removed.status, removed.json);
}

// 4. Чужой ключ, подпись, отзыв.
{
  const alien = await api('GET', '/api/v1/rates', undefined, {}, 'sk_test_' + 'x'.repeat(32));
  say('чужой ключ', alien.status, alien.json);
  if (alien.status !== 401) throw new Error('чужой ключ прошёл');

  const on = await cabinet('/api/signature', { required: true });
  expectStatus('включить подпись', on, 200);

  const unsigned = await api('GET', '/api/v1/rates');
  say('подпись включена, без подписи', unsigned.status, unsigned.json);
  if (unsigned.json?.error?.code !== 'invalid_signature') throw new Error('ждали invalid_signature');

  const path = '/api/v1/quote';
  const payload = JSON.stringify({ from: 'USDT', to: 'RUB', amount: '10' });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const digest = createHash('sha256').update(payload).digest('hex');
  const signature = createHmac('sha256', secret)
    .update(['POST', path, timestamp, digest].join('\n'))
    .digest('hex');
  const signed = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'x-api-key': secret,
      'x-timestamp': timestamp,
      'x-signature': signature,
      'content-type': 'application/json',
    },
    body: payload,
  });
  say('с подписью', signed.status, await signed.json());
  if (signed.status !== 200) throw new Error('подписанный запрос не прошёл');

  const off = await cabinet('/api/signature', { required: false });
  expectStatus('выключить подпись', off, 200);

  const revoked = await cabinet(`/api/keys/${keyId}/revoke`, {});
  expectStatus('отзыв ключа', revoked, 200);
  const after = await api('GET', '/api/v1/rates');
  say('после отзыва', after.status, after.json);
  if (after.status !== 401) throw new Error('отозванный ключ прошёл');

  const calls = await cabinet('/api/calls?outcome=all');
  const rows = ((await calls.json()) as { rows: unknown[] }).rows;
  say('журнал вызовов', calls.status, { rows: rows.length, last: rows[0] });
}

console.log('\nПрогон прошёл.');
