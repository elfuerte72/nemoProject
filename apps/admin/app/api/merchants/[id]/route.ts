import { z } from 'zod';
import { InvalidInputError } from '@nemo/core';
import { errorResponse, json } from '@/lib/api';
import { requireStaffActor } from '@/lib/auth/require-session';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Решения администратора о мерчанте (docs/adr/0017).
 *
 * Один маршрут на все четыре действия — по тому же правилу, что и у
 * заявки: какие переходы существуют и кому они разрешены, решает
 * операция, и разносить это решение ещё и по адресам значило бы
 * описывать его дважды. Менеджер получает здесь отказ ядра, а не
 * скрытую кнопку: скрытая кнопка — видимость разграничения.
 *
 * Письмо о решении сюда не доставляется: почтового пакета у панели
 * ещё нет (тикет 04), и уведомления, которые вернула операция, пока
 * никуда не уходят. Это заметно снаружи и записано в тикете как шаг
 * приёмки — но заводить недоставку молча нельзя, поэтому она названа
 * здесь.
 */

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve') }),
  z.object({ action: z.literal('reject'), reason: z.string() }),
  z.object({ action: z.literal('disable') }),
  z.object({ action: z.literal('enable') }),
]);

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const actor = await requireStaffActor();
    const { id } = await context.params;

    const parsed = actionSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new InvalidInputError('Действие не распознано');
    }
    const input = parsed.data;
    const core = getCore();

    const merchant = await (async () => {
      switch (input.action) {
        case 'approve':
          return (await core.approveMerchant(actor, id)).merchant;
        case 'reject':
          return (await core.rejectMerchant(actor, id, { reason: input.reason })).merchant;
        case 'disable':
          return core.setMerchantActive(actor, id, false);
        case 'enable':
          return core.setMerchantActive(actor, id, true);
      }
    })();

    return json({ merchant });
  } catch (error) {
    return errorResponse(error);
  }
}
