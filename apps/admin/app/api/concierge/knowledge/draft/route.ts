import { z } from 'zod';
import { InvalidInputError } from '@nemo/core';
import { errorResponse, json } from '@/lib/api';
import { requireStaffActor } from '@/lib/auth/require-session';
import { getCore } from '@/lib/core';
import { textFromKnowledgeFile } from '@/lib/knowledge-file';
import { KNOWLEDGE_FILE_LIMIT_BYTES } from '@/lib/knowledge-file-kinds';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Черновик статей из документа.
 *
 * Два входа — файл и текст — в один маршрут: дальше файла всё общее, а
 * маршрут отличается только тем, откуда взял текст. Файл приходит
 * multipart-полем `file`, текст — JSON-полем `text`. Ничего не
 * записывается: черновик уходит администратору на подтверждение, и
 * записывает его соседний маршрут.
 */
const textSchema = z.object({ text: z.string() });

export async function POST(request: Request): Promise<Response> {
  try {
    const actor = await requireStaffActor();
    const text = await documentText(request);
    const draft = await getCore().draftKnowledgeArticles(actor, { text });
    return json({ draft });
  } catch (error) {
    return errorResponse(error);
  }
}

async function documentText(request: Request): Promise<string> {
  if (request.headers.get('content-type')?.includes('multipart/form-data')) {
    const file = (await request.formData()).get('file');
    if (!(file instanceof File)) {
      throw new InvalidInputError('Файл не получен');
    }
    if (file.size > KNOWLEDGE_FILE_LIMIT_BYTES) {
      throw new InvalidInputError(
        `Файл больше ${KNOWLEDGE_FILE_LIMIT_BYTES / 1024 / 1024} МБ: пришлите его частями`,
      );
    }
    return (await textFromKnowledgeFile(new Uint8Array(await file.arrayBuffer()))).text;
  }

  const parsed = textSchema.safeParse(await request.json());
  if (!parsed.success) {
    throw new InvalidInputError('Текст не получен');
  }
  return parsed.data.text;
}
