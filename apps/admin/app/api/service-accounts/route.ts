import { z } from 'zod';
import { InvalidInputError } from '@nemo/core';
import { networkCodeSchema } from '@nemo/types';
import { errorResponse, json } from '@/lib/api';
import { requireStaffActor } from '@/lib/auth/require-session';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Счета сервиса: куда клиент отправляет оплату (docs/adr/0008).
 *
 * Заведение, правка и гашение — в одном маршруте: решение о том, кому
 * они позволены, принимает операция, и повторять его здесь значило бы
 * описывать права дважды.
 *
 * Поля по способу разобраны размеченным объединением, как и в ядре:
 * общая схема с шестью необязательными полями пропустила бы сеть у
 * карты до того, как о ней скажет база.
 */

const fieldsSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('phone'),
    bankName: z.string(),
    holderName: z.string(),
    phone: z.string(),
  }),
  z.object({
    kind: z.literal('card'),
    bankName: z.string(),
    holderName: z.string(),
    cardNumber: z.string(),
  }),
  z.object({
    kind: z.literal('wallet'),
    // Та же схема кода сети, что и в справочнике сетей: две разных
    // правды о том, как выглядит код сети, разошлись бы молча.
    network: networkCodeSchema,
    address: z.string(),
  }),
]);

const savedSchema = z.intersection(
  fieldsSchema,
  z.object({ currencyCode: z.string(), note: z.string().optional() }),
);

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('add'), account: savedSchema }),
  z.object({
    action: z.literal('update'),
    accountId: z.string().uuid(),
    account: savedSchema,
  }),
  z.object({
    action: z.literal('set-active'),
    accountId: z.string().uuid(),
    isActive: z.boolean(),
  }),
]);

export async function POST(request: Request): Promise<Response> {
  try {
    const actor = await requireStaffActor();
    const parsed = actionSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new InvalidInputError('Счёт не распознан');
    }

    const input = parsed.data;
    const core = getCore();
    const account = await (async () => {
      switch (input.action) {
        case 'add':
          return core.addServiceAccount(actor, input.account);
        case 'update':
          return core.updateServiceAccount(actor, input.accountId, input.account);
        case 'set-active':
          return core.setServiceAccountActive(actor, input.accountId, input.isActive);
      }
    })();

    return json({ account });
  } catch (error) {
    return errorResponse(error);
  }
}
