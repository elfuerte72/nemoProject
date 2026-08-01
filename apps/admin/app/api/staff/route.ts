import { z } from 'zod';
import { InvalidInputError } from '@nemo/core';
import { staffRoleSchema, telegramUserIdSchema } from '@nemo/types';
import { errorResponse, json } from '@/lib/api';
import { requireStaffActor } from '@/lib/auth/require-session';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Сотрудники: заведение, роль, доступ и второй фактор.
 *
 * Секрет второго фактора возвращается только в ответ на заведение и
 * сброс — и только тому администратору, который их выполнил. Он
 * передаёт его сотруднику лично: секрет, который сотрудник заводит сам
 * при первом входе, достаётся тому, кто угнал аккаунт раньше.
 */
const staffSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('add'),
    telegramUserId: z.union([z.string(), z.number()]),
    displayName: z.string().min(1).max(100),
    role: staffRoleSchema.optional(),
  }),
  z.object({ action: z.literal('role'), staffId: z.string().uuid(), role: staffRoleSchema }),
  z.object({
    action: z.literal('access'),
    staffId: z.string().uuid(),
    isActive: z.boolean(),
  }),
  z.object({ action: z.literal('reset-second-factor'), staffId: z.string().uuid() }),
]);

export async function POST(request: Request): Promise<Response> {
  try {
    const actor = await requireStaffActor();
    const parsed = staffSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new InvalidInputError('Действие над сотрудником не распознано');
    }
    const input = parsed.data;
    const core = getCore();

    switch (input.action) {
      case 'add': {
        const telegramUserId = telegramUserIdSchema.safeParse(input.telegramUserId);
        if (!telegramUserId.success) {
          throw new InvalidInputError('Telegram сотрудника указан неверно');
        }
        const enrollment = await core.addStaff(actor, {
          telegramUserId: telegramUserId.data,
          displayName: input.displayName,
          role: input.role,
        });
        return json(enrollment, { status: 201 });
      }
      case 'role':
        return json({ staff: await core.updateStaffRole(actor, input.staffId, input.role) });
      case 'access':
        return json({
          staff: await core.setStaffActive(actor, input.staffId, input.isActive),
        });
      case 'reset-second-factor':
        return json(await core.resetStaffSecondFactor(actor, input.staffId));
    }
  } catch (error) {
    return errorResponse(error);
  }
}
