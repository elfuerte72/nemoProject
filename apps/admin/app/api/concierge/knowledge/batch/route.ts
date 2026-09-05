import { z } from 'zod';
import { InvalidInputError } from '@nemo/core';
import { errorResponse, json } from '@/lib/api';
import { requireStaffActor } from '@/lib/auth/require-session';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Записать подтверждённый черновик — статьи списком, одной операцией.
 * Что заменяется и куда встаёт новое, решает ядро; маршрут только
 * разбирает список.
 */
const batchSchema = z.object({
  articles: z.array(z.object({ title: z.string(), body: z.string() })),
});

export async function POST(request: Request): Promise<Response> {
  try {
    const actor = await requireStaffActor();
    const parsed = batchSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new InvalidInputError('Черновик не распознан');
    }

    const articles = await getCore().addKnowledgeArticles(actor, parsed.data.articles);
    return json({ articles }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
