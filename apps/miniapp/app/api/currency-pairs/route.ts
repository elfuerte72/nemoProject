import { errorResponse, json, requireInitData } from '@/lib/api';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Справочник направлений обмена для экрана заявки.
 *
 * Наполняется после ответа на блокер C1: список валют и то, какие из
 * них сервис готов менять, — вопрос к заказчику, а не к коду. До ответа
 * справочник пуст, и экран честно показывает, что направлений нет.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    requireInitData(request);
    return json({ pairs: await getCore().listCurrencyPairs() });
  } catch (error) {
    return errorResponse(error);
  }
}
