import { errorResponse, json, requireInitData } from '@/lib/api';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Предварительный курс по направлению.
 *
 * Пустой ответ — рабочее состояние, а не ошибка: у наличных курса нет
 * вовсе, а провайдер котировок может лежать. Экран в обоих случаях
 * говорит одно и то же — курс назовёт менеджер.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    requireInitData(request);
    const url = new URL(request.url);
    const fromCode = url.searchParams.get('fromCode');
    const toCode = url.searchParams.get('toCode');
    if (!fromCode || !toCode) {
      return json({ quote: null });
    }

    const quote = await getCore().getPreliminaryQuote({
      fromCode,
      toCode,
      fromAmount: url.searchParams.get('fromAmount') ?? undefined,
    });
    return json({ quote });
  } catch (error) {
    return errorResponse(error);
  }
}
