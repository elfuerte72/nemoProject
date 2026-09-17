import { z } from 'zod';
import { InvalidInputError } from '@nemo/core';
import { merchantUserRoleSchema } from '@nemo/types';
import { errorResponse, json } from '@/lib/api';
import { requireActor } from '@/lib/auth';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/*
 * Форма, а не правила: длину пароля, вид почты и пустое имя проверяет
 * ядро — теми же словами, что покажет форма до нажатия. Роль здесь
 * сверяется схемой, потому что незнакомое слово в этом поле означает
 * не опечатку человека, а чужой запрос.
 */
const schema = z.object({
  email: z.string(),
  password: z.string(),
  name: z.string(),
  role: merchantUserRoleSchema,
});

/**
 * Завести человека в кабинет. Право на это — у владельца, и проверяет
 * его операция: маршрут ничего не решает.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const actor = await requireActor();
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      throw new InvalidInputError('Заполните почту, пароль, имя и роль');
    }

    const user = await getCore().addMerchantUser(actor, parsed.data);
    return json({ user }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
