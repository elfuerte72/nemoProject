import { CoreError, type CoreErrorCode } from '@nemo/core';

/**
 * Общая обвязка маршрутов обоих приложений.
 *
 * Отвечать на отказ операции — работа адаптера, но отвечать на него
 * одинаково — свойство самих отказов: клиент, получивший на «заявку
 * ведёт другой менеджер» то 403, то 409, не может обработать ответ
 * иначе как по тексту сообщения. Поэтому карта кодов живёт в одном
 * месте, а не переписывается в каждом приложении.
 *
 * Специфика приложений сюда не переезжает: чем именно подтверждается
 * личность — подписью данных запуска Mini App или сессией админки — они
 * решают сами.
 */

const STATUS_BY_CODE: Record<CoreErrorCode, number> = {
  'not-found': 404,
  forbidden: 403,
  'invalid-input': 422,
  // Кто-то успел раньше или состояние уже не то — оба про столкновение
  // с чужим действием, и клиенту в обоих случаях остаётся перечитать
  // состояние и решить заново.
  'transition-not-allowed': 409,
  conflict: 409,
};

export function statusForCoreError(code: CoreErrorCode): number {
  return STATUS_BY_CODE[code];
}

/**
 * JSON без потери точности: `telegram_user_id` — bigint, денежные
 * величины — строки, и `JSON.stringify` на первом же bigint бросает.
 */
export function json(payload: unknown, init?: ResponseInit): Response {
  const body = JSON.stringify(payload, (_key, value) =>
    typeof value === 'bigint' ? value.toString() : value,
  );
  return new Response(body, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
}

/** Ответ на отказ операции. `null`, если ошибка пришла не из ядра. */
export function coreErrorResponse(error: unknown): Response | null {
  if (!(error instanceof CoreError)) {
    return null;
  }
  return json({ error: error.message }, { status: statusForCoreError(error.code) });
}

/**
 * Ответ на отказ подтвердить, кто пришёл. Текст нейтральный: подробности
 * помогли бы подбирать подпись.
 */
export function unauthorizedResponse(message: string): Response {
  return json({ error: message }, { status: 401 });
}

/**
 * Ответ на то, чего мы не предвидели. Наружу — ничего, кроме факта
 * ошибки: в сообщении может оказаться что угодно, вплоть до фрагмента
 * запроса с номером карты.
 */
export function unexpectedErrorResponse(error: unknown): Response {
  console.error(error);
  return json({ error: 'Внутренняя ошибка' }, { status: 500 });
}
