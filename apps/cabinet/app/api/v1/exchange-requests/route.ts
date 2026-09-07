import { json } from '@nemo/http';
import { getCore } from '@/lib/core';
import { v1 } from '@/lib/v1/route';
import {
  exchangeRequestBodySchema,
  parseBody,
  parseListQuery,
  requireIdempotencyKey,
} from '@/lib/v1/schemas';
import { afterSubmission, submitFromBody } from '@/lib/v1/submit';
import { page, toApiRequest } from '@/lib/v1/views';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Заявки мерчанта по API.
 *
 * Подача — та же операция, что у кабинета и у Mini App (`submitFromBody`):
 * ядро не знает, откуда пришёл запрос. Здесь только разбор тела и
 * ключ повтора из заголовка.
 */
export const POST = v1(async (request, ctx, raw) => {
  const idempotencyKey = requireIdempotencyKey(request);
  const body = parseBody(exchangeRequestBodySchema, raw);
  const core = getCore();

  const { request: created, notifications } = await submitFromBody(
    core,
    ctx.actor,
    body,
    idempotencyKey,
  );
  await afterSubmission(notifications);

  const terms = await core.getExchangeTerms();
  return json({ request: toApiRequest(created, terms) }, { status: 201 });
});

export const GET = v1(async (request, ctx) => {
  const query = parseListQuery(new URL(request.url).searchParams);
  const core = getCore();

  const [rows, terms] = await Promise.all([
    core.listExchangeRequests(ctx.actor, {
      limit: query.limit,
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.after === undefined ? {} : { after: query.after }),
    }),
    core.getExchangeTerms(),
  ]);

  return json(
    page(
      rows.map((row) => toApiRequest(row, terms)),
      query.limit,
    ),
  );
});
