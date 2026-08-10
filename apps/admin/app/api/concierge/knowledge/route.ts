import { z } from 'zod';
import { InvalidInputError } from '@nemo/core';
import { errorResponse, json } from '@/lib/api';
import { requireStaffActor } from '@/lib/auth/require-session';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * База знаний помощника.
 *
 * Правила — потолки длины, обязательность полей, права — живут в ядре:
 * маршрут разбирает запрос и зовёт операцию. Проверять здесь значило бы
 * держать те же пределы в двух местах, а расходятся они молча.
 *
 * Одна форма на заведение и правку: разница между ними — наличие
 * идентификатора, и два адреса под неё разошлись бы в проверках.
 */
const articleSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string(),
  body: z.string(),
  position: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

export async function POST(request: Request): Promise<Response> {
  try {
    const actor = await requireStaffActor();
    const parsed = articleSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new InvalidInputError('Статья не распознана');
    }

    const article = await getCore().saveKnowledgeArticle(actor, parsed.data);
    return json({ article }, { status: parsed.data.id ? 200 : 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Погасить или вернуть статью. Удаления нет: см. операцию ядра. */
const toggleSchema = z.object({
  id: z.string().uuid(),
  isActive: z.boolean(),
});

export async function PATCH(request: Request): Promise<Response> {
  try {
    const actor = await requireStaffActor();
    const parsed = toggleSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new InvalidInputError('Не разобрано, какую статью гасить');
    }

    const article = await getCore().setKnowledgeArticleActive(
      actor,
      parsed.data.id,
      parsed.data.isActive,
    );
    return json({ article });
  } catch (error) {
    return errorResponse(error);
  }
}
