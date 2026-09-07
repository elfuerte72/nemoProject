import { json } from '@nemo/http';
import { getCore } from '@/lib/core';
import { deliverMail } from '@/lib/mail';
import { nudgeStaffAlerts } from '@/lib/staff-alert';
import { quoteFor, recipientPayoutMethod } from '@/lib/v1/quote';
import { v1 } from '@/lib/v1/route';
import {
  exchangeRequestBodySchema,
  parseBody,
  parseListQuery,
  requireIdempotencyKey,
} from '@/lib/v1/schemas';
import { page, toApiRequest } from '@/lib/v1/views';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Заявки мерчанта по API.
 *
 * Подача — та же операция, что у кабинета и у Mini App: ядро не знает,
 * откуда пришёл запрос. Здесь только разбор тела и два следствия
 * подачи — толчок панели, чтобы менеджер узнал о заявке через секунду,
 * и письмо мерчанту, если оно положено переходу.
 *
 * Сумма бывает названа с любой стороны: «получить ровно 50 000» сначала
 * считается обратным счётом на ту же отметку курса, и заявка уходит по
 * найденной сумме отдачи — той, что вернул бы `/quote`.
 */
export const POST = v1(async (request, ctx, raw) => {
  const idempotencyKey = requireIdempotencyKey(request);
  const body = parseBody(exchangeRequestBodySchema, raw);
  const core = getCore();

  let fromAmount = body.amount;
  let quotedAt = body.quotedAt;
  if (body.side === 'to') {
    // По тому же снимку и той же сетке, по которым уйдёт заявка:
    // отметка — присланная, способ выдачи — от получателя.
    const quote = await quoteFor(core, {
      from: body.from,
      to: body.to,
      amount: body.amount,
      side: 'to',
      payoutMethod: await recipientPayoutMethod(core, ctx.actor, body),
      asOf: body.quotedAt,
    });
    fromAmount = quote.from.amount;
    quotedAt ??= new Date(quote.quotedAt);
  }

  const { request: created, notifications } = await core.submitExchangeRequest(ctx.actor, {
    kind: 'electronic',
    fromCode: body.from,
    toCode: body.to,
    fromAmount,
    idempotencyKey,
    ...(body.reference === undefined ? {} : { reference: body.reference }),
    ...(quotedAt === undefined ? {} : { quotedAt }),
    ...(body.requisitesId === undefined ? {} : { requisitesId: body.requisitesId }),
    ...(body.payout === undefined ? {} : { payout: body.payout }),
  });

  // Повтор с тем же ключом отдаёт ту же заявку и уведомлений не
  // порождает — тогда и панель звать не за чем.
  if (notifications.length > 0) {
    nudgeStaffAlerts();
    await deliverMail(notifications);
  }

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
