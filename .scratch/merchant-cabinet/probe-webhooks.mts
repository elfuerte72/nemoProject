/**
 * Живая проверка вебхуков на поднятом кабинете: точка, пробная доставка
 * с ответом приёмника, доставка о заявке по API, пауза, удаление.
 *
 * Запуск: `pnpm tsx .scratch/merchant-cabinet/probe-webhooks.mts` при
 * работающем кабинете и мерчанте из `seed-dev.mts`. Приёмник —
 * публичный адрес из `PROBE_HOOK_URL` (по умолчанию example.com: ответ
 * его не 2xx, и это тоже проверка — слова о неудаче видны).
 */
const BASE = process.env.CABINET_BASE ?? 'http://localhost:3002';
const HOOK_URL = process.env.PROBE_HOOK_URL ?? 'https://example.com/hooks/tobee';

let cookie = '';

async function cabinet(path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const response = await fetch(`${BASE}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, json: await response.json().catch(() => null) };
}

function say(step: string, status: number, detail: unknown = ''): void {
  console.log(`${status}  ${step}`, typeof detail === 'string' ? detail : JSON.stringify(detail));
}

const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'oplatishka@example.com', password: 'правильная лошадь батарейка' }),
});
cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
say('вход', login.status);

const bad = await cabinet('/api/webhooks', { url: 'http://localhost:3000/x', events: ['ping'] });
say('точка на localhost', bad.status, bad.json);
if (bad.status !== 422) throw new Error('ждали 422');

const added = await cabinet('/api/webhooks', {
  url: HOOK_URL,
  events: ['exchange_request.created', 'exchange_request.cancelled'],
});
say('точка заведена', added.status, { id: added.json.endpoint?.id, secret: added.json.secret?.slice(0, 8) + '…' });
if (added.status !== 201) throw new Error('точка не завелась');
const endpointId = added.json.endpoint.id as string;

const ping = await cabinet(`/api/webhooks/${endpointId}/ping`, {});
say('пробная', ping.status, ping.json.delivery);

// Заявка по API — доставка о ней должна лечь в очередь и уйти воркером.
const key = await cabinet('/api/keys', { label: 'вебхуки-проба' });
const secret = key.json.secret as string;
const submitted = await fetch(`${BASE}/api/v1/exchange-requests`, {
  method: 'POST',
  headers: {
    authorization: `Bearer ${secret}`,
    'content-type': 'application/json',
    'idempotency-key': `hook-${Date.now()}`,
  },
  body: JSON.stringify({
    from: 'USDT',
    to: 'RUB',
    amount: '100',
    payout: { kind: 'phone', bankName: 'Т-Банк', phone: '+79991234567' },
  }),
});
const request = ((await submitted.json()) as { request: { id: string } }).request;
say('заявка по API', submitted.status, { id: request.id });

const cancelled = await fetch(`${BASE}/api/v1/exchange-requests/${request.id}/cancel`, {
  method: 'POST',
  headers: { authorization: `Bearer ${secret}` },
});
say('отмена по API', cancelled.status);

// Даём воркеру тик.
await new Promise((resolve) => setTimeout(resolve, 7000));

const paused = await cabinet(`/api/webhooks/${endpointId}/pause`, { paused: true });
say('пауза', paused.status, { pausedAt: paused.json.endpoint?.pausedAt });
const removed = await cabinet(`/api/webhooks/${endpointId}/remove`, {});
say('удаление', removed.status, removed.json);
await cabinet(`/api/keys/${key.json.key.id}/revoke`, {});

console.log('\nДальше — доставки в базе: psql ... select event,status,attempt,response_status,error from webhook_deliveries order by created_at desc limit 5');
