import { z } from 'zod';
import { InvalidInputError, textTemplateKeys } from '@nemo/core';
import { errorResponse, json } from '@/lib/api';
import { requireStaffActor } from '@/lib/auth/require-session';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Правка заготовки текста.
 *
 * Ключ — из перечисления, а не произвольная строка: заготовка, которую
 * никто не читает, — это опечатка в ключе, и заметить её иначе можно
 * только по жалобе клиента.
 */
const schema = z.object({
  key: z.enum(textTemplateKeys),
  body: z.string().min(1).max(2000),
});

export async function POST(request: Request): Promise<Response> {
  try {
    const actor = await requireStaffActor();
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      throw new InvalidInputError('Заготовка не распознана');
    }

    const template = await getCore().updateTextTemplate(
      actor,
      parsed.data.key,
      parsed.data.body,
    );
    return json({ template });
  } catch (error) {
    return errorResponse(error);
  }
}
