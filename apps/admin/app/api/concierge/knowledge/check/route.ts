import { z } from 'zod';
import { InvalidInputError } from '@nemo/core';
import { errorResponse, json } from '@/lib/api';
import { requireStaffActor } from '@/lib/auth/require-session';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * О чём предупредить по статье черновика — по её текущему тексту.
 * Черновик правят до записи, и предупреждение, посчитанное при разборе,
 * устаревало бы на первой же правке. Правило одно — в ядре; маршрут
 * только носит текст туда и обратно.
 */
const schema = z.object({ body: z.string(), source: z.string() });

export async function POST(request: Request): Promise<Response> {
  try {
    const actor = await requireStaffActor();
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      throw new InvalidInputError('Текст не получен');
    }
    return json({ warnings: getCore().warnAboutKnowledgeArticle(actor, parsed.data) });
  } catch (error) {
    return errorResponse(error);
  }
}
