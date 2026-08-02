import { errorResponse, json, requireInitData } from '@/lib/api';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Сети, в которые сервис отправляет прямо сейчас.
 *
 * Один список на две формы — реквизиты обмена и заявку на вывод:
 * перечисление в коде приложения было бы второй правдой о том, куда
 * сервис умеет отправлять, и рано или поздно разошлось бы со
 * справочником.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    // Подпись запуска проверяется и здесь: список открытый, но открывать
    // его кому попало незачем — маршрут доступен из интернета.
    requireInitData(request);
    const networks = await getCore().listActiveNetworks();
    return json({ networks });
  } catch (error) {
    return errorResponse(error);
  }
}
