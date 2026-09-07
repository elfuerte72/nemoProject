import { API_LOG_RETENTION_DAYS } from '@nemo/core';
import { schedulerCallDenied } from '@nemo/http';
import { errorResponse, json } from '@/lib/api';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Чистка журнала вызовов API: строки старше тридцати дней — вон.
 *
 * Зовёт планировщик развёртывания раз в сутки с общим секретом, как и
 * остальные служебные вызовы: своего планировщика в проекте нет.
 * Число убранных строк — в ответе: молчащий планировщик иначе
 * неотличим от работающего.
 */
export async function POST(request: Request): Promise<Response> {
  const denied = schedulerCallDenied(request);
  if (denied) return denied;

  try {
    const olderThan = new Date(Date.now() - API_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const purged = await getCore().purgeApiRequestLog(olderThan);
    return json({ purged });
  } catch (error) {
    return errorResponse(error);
  }
}
