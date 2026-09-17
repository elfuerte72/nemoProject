import { z } from 'zod';
import { InvalidInputError } from '@nemo/core';
import { merchantUserRoleSchema } from '@nemo/types';
import { errorResponse, json } from '@/lib/api';
import { requireActor } from '@/lib/auth';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  name: z.string().optional(),
  role: merchantUserRoleSchema.optional(),
});

/**
 * Имя и роль человека. Пустое тело — нечего менять, и это ошибка формы.
 *
 * Методом POST, как и остальные формы кабинета: свой способ отправки у
 * них один (`app/ui/send.ts`), и второй ради одного маршрута означал бы
 * две правды о том, как кабинет говорит со своими маршрутами.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const actor = await requireActor();
    const { id } = await context.params;
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success || (parsed.data.name === undefined && parsed.data.role === undefined)) {
      throw new InvalidInputError('Нечего менять: назовите имя или роль');
    }

    const user = await getCore().updateMerchantUser(actor, id, parsed.data);
    return json({ user });
  } catch (error) {
    return errorResponse(error);
  }
}
