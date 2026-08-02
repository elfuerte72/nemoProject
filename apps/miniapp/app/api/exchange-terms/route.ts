import { errorResponse, json, requireInitData } from '@/lib/api';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Условия обмена для экрана заявки: действующие направления и
 * минимальная сумма.
 *
 * Минимум приходит вместе с направлениями, а не отдельным запросом:
 * клиент должен узнать его до подачи, а не из отказа, — а значит экран
 * получает его тогда же, когда узнаёт, что вообще меняют.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    requireInitData(request);
    return json({ terms: await getCore().getExchangeTerms() });
  } catch (error) {
    return errorResponse(error);
  }
}
