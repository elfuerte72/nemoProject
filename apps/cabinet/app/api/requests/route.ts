import { z } from 'zod';
import { cursorFromParams } from '@nemo/ui/paging';
import { errorResponse, json } from '@/lib/api';
import { requireActor } from '@/lib/auth';
import { getCore } from '@/lib/core';
import {
  pickTab,
  REQUESTS_PAGE,
  statusesOf,
  toRequestRow,
} from '@/lib/request-rows';
import { exchangeRequestBodySchema, parseBody } from '@/lib/v1/schemas';
import { afterSubmission, submitFromBody } from '@/lib/v1/submit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Хвост списка заявок — по курсору.
 *
 * Отбор здесь тот же, что на странице, и берётся он из одного места:
 * два правила отбора для первой страницы и для остальных разошлись бы
 * при первой правке, а заметить это можно только на второй странице.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const actor = await requireActor();
    const params = new URL(request.url).searchParams;
    const tab = pickTab(params.get('tab') ?? undefined);
    const cursor = cursorFromParams(params);
    const statuses = statusesOf(tab);

    const rows = await getCore().listExchangeRequests(actor, {
      limit: REQUESTS_PAGE,
      ...(statuses ? { statuses } : {}),
      ...(cursor ? { after: { createdAt: new Date(cursor.createdAt), id: cursor.id } } : {}),
    });

    return json({ rows: rows.map(toRequestRow) });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Тело формы новой заявки — договор API v1 (`exchangeRequestBodySchema`)
 * с ключом повтора в теле, а не в заголовке: форма говорит с сервером
 * тем же языком, что чужая система мерчанта, и второй схемы подачи у
 * кабинета нет. Ключ обязателен и здесь: двойное нажатие и повтор
 * запроса после обрыва сети иначе завели бы две заявки.
 */
const submitSchema = exchangeRequestBodySchema.extend({
  idempotencyKey: z.string().trim().min(1).max(200),
});

/**
 * Подача заявки из кабинета — та же операция и тот же путь, что у API
 * (`submitFromBody`): ядро не знает, откуда пришёл запрос.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const actor = await requireActor();
    const body = parseBody(submitSchema, await request.text());
    const { idempotencyKey, ...v1Body } = body;

    const { request: created, notifications } = await submitFromBody(
      getCore(),
      actor,
      v1Body,
      idempotencyKey,
      'cabinet',
    );
    await afterSubmission(notifications);

    return json({ request: toRequestRow(created) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
