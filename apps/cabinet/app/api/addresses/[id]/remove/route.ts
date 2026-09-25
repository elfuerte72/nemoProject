import { errorResponse, json } from '@/lib/api';
import { requireActor } from '@/lib/auth';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Адрес убирается из списка: вызовы с него отвергаются со следующего же. */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const actor = await requireActor();
    const { id } = await context.params;
    await getCore().removeApiAddress(actor, id);
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
