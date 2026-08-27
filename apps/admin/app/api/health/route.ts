import { healthResponse } from '@nemo/http';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Пульс панели. Открыт без сессии — по нему стучат после выката и
 * снаружи; см. комментарий в `apps/miniapp/app/api/health/route.ts`.
 */
export async function GET(): Promise<Response> {
  return healthResponse({
    app: 'admin',
    version: process.env.APP_VERSION || null,
    ping: () => getCore().pingDatabase(),
  });
}
