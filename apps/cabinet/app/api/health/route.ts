import { healthResponse } from '@nemo/http';
import { mailDeliveryName, readMailEnvironment } from '@nemo/email';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Пульс кабинета. Открыт без сессии — по нему стучат после выката.
 *
 * Кроме базы называет режим доставки писем: выключенная почта выглядит
 * рабочим деплоем — экраны открываются, заявки видны, — но завести
 * кабинет при ней нельзя, и узнать об этом лучше на выкате, чем от
 * первого мерчанта.
 */
export async function GET(): Promise<Response> {
  return healthResponse({
    app: 'cabinet',
    version: process.env.APP_VERSION || null,
    ping: () => getCore().pingDatabase(),
    details: { mail: mailDeliveryName(readMailEnvironment().delivery) },
  });
}
