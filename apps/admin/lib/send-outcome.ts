/**
 * Чем кончилась отправка клиенту — ответом словами или файлом.
 *
 * Поле ответа пустеет только по принятому ответу. Клиент заблокировал
 * бота, истекла сессия, оборвалась сеть — набранное остаётся на месте, а
 * причина стоит рядом с полем: до 17 сентября 2026 поле стиралось при
 * любом исходе, и менеджер, прочитав отказ, набирал ответ заново.
 *
 * Исход решает не разметка, а эта функция: какой ответ маршрута считать
 * принятым и какими словами назвать остальные — вопрос с известным
 * ответом, и он покрыт тестом.
 */

/**
 * `notice` — слова при отправленном: файл ушёл клиенту, а в переписку не
 * записался. Поле тогда пустеет, как по принятому, а слова встают у поля:
 * оставленный в поле файл следующее «Отправить» послало бы вторым.
 */
export type SendOutcome =
  | { readonly sent: true; readonly notice?: string }
  | { readonly sent: false; readonly complaint: string };

export const NO_CONNECTION = 'Не удалось связаться с сервером. Повторите попытку.';

/**
 * Выполнить запрос и прочитать исход.
 *
 * Слова отказа — те, что назвал маршрут; ответ без них (страница прокси
 * вместо JSON, пустое тело) называется словами экрана, а не обрывом
 * связи: сервер-то ответил.
 */
export async function sendOutcome(
  request: () => Promise<Response>,
  refused: string,
): Promise<SendOutcome> {
  let response: Response;
  try {
    response = await request();
  } catch {
    return { sent: false, complaint: NO_CONNECTION };
  }
  if (response.ok) return { sent: true };

  const payload = (await response.json().catch(() => null)) as {
    error?: unknown;
    delivered?: unknown;
  } | null;
  const said = typeof payload?.error === 'string' ? payload.error.trim() : '';
  // Сбой после доставки: клиент файл получил, повторять нельзя.
  if (payload?.delivered === true) return { sent: true, notice: said || refused };
  return { sent: false, complaint: said || refused };
}
