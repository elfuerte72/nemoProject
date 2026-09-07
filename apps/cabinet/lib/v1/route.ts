import { getCore } from '@/lib/core';
import { handleV1, type V1Context, type V1Deps } from './handler';

/**
 * Маршрут API v1: обёртка с настоящим ядром.
 *
 * Обработчик получает разобранные параметры пути четвёртым аргументом:
 * Next отдаёт их обещанием во втором аргументе маршрута, а обёртке о
 * них знать незачем.
 */
export type RouteHandler<P> = (
  request: Request,
  ctx: V1Context,
  body: string,
  params: P,
) => Promise<Response>;

function deps(): V1Deps {
  const core = getCore();
  return {
    authenticate: (secret) => core.authenticateApiKey(secret),
    log: (entry) => core.logApiRequest(entry),
    now: () => new Date(),
  };
}

/*
 * Второй аргумент обязателен, а не необязателен: Next сверяет форму
 * маршрута на сборке, и `undefined` в ней не проходит. У маршрута без
 * параметров он всё равно приходит — с пустым обещанием.
 */
export function v1<P = object>(handler: RouteHandler<P>) {
  return async (request: Request, context: { params: Promise<P> }): Promise<Response> => {
    const params = await context.params;
    return handleV1(request, (r, ctx, body) => handler(r, ctx, body, params), deps());
  };
}
