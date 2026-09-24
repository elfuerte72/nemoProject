import { describe, expect, it, vi } from 'vitest';
import type { ApiKeyAuth } from '@nemo/core';
import { handleV1, type V1Deps } from './handler';
import { requireRequestId, requireRequisitesId } from './ids';

/**
 * Номер в пути запроса к API.
 *
 * Договор обещает на чужой и несуществующий номер `404 not_found`, а
 * номер не того вида база не ищет, а отвергает ошибкой — и до
 * 17 сентября 2026 `GET /api/v1/exchange-requests/booking-1024` (свой
 * номер мерчанта вместо нашего) отвечал `500 internal`. Кривой номер —
 * то же «не найдено» теми же словами, что у ядра: отличать его от
 * чужого незачем, а разные слова заставили бы разбирать оба.
 */

const OK: ApiKeyAuth = {
  ok: true,
  merchantId: '22222222-2222-2222-2222-222222222222',
  keyId: '11111111-1111-1111-1111-111111111111',
  signatureRequired: false,
  allowedAddresses: [],
};

function deps(): V1Deps & { log: ReturnType<typeof vi.fn> } {
  return {
    authenticate: vi.fn(async () => OK),
    log: vi.fn(async () => undefined),
    now: () => new Date('2026-09-17T10:00:00Z'),
  };
}

async function call(read: () => string) {
  const d = deps();
  const response = await handleV1(
    new Request('https://cabinet.example/api/v1/exchange-requests/x', {
      headers: { authorization: `Bearer sk_test_${'a'.repeat(32)}` },
    }),
    async () => Response.json({ id: read() }),
    d,
  );
  return { response, body: await response.json(), log: d.log };
}

describe('номер заявки и записи в пути API', () => {
  it('UUID проходит как есть', () => {
    const id = '3f1c2a9e-5b7d-4c0e-9a11-2f6d8e4b7c31';
    expect(requireRequestId(id)).toBe(id);
    expect(requireRequisitesId(id)).toBe(id);
  });

  it('свой номер мерчанта вместо нашего — 404 not_found словами ядра', async () => {
    const { response, body, log } = await call(() => requireRequestId('booking-1024'));
    expect(response.status).toBe(404);
    expect(body).toEqual({ error: { code: 'not_found', message: 'Заявка на обмен не найдена' } });
    // Вызов с узнанным ключом пишется и отвергнутым — с тем же ответом.
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ status: 404 }));
  });

  it('кривой номер записи — 404 not_found', async () => {
    const { response, body } = await call(() => requireRequisitesId('abc'));
    expect(response.status).toBe(404);
    expect(body).toEqual({ error: { code: 'not_found', message: 'Реквизиты не найдены' } });
  });
});
