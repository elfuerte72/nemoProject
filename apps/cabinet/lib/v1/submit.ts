import type { Actor, Core, Notification, SubmitExchangeRequestResult } from '@nemo/core';
import { deliverMail } from '@/lib/mail';
import { nudgeStaffAlerts } from '@/lib/staff-alert';
import { quoteFor, recipientPayoutMethod } from './quote';
import type { ExchangeRequestBody } from './schemas';

/**
 * Подача заявки по договору API v1 — одна на маршрут `/api/v1` и на
 * форму кабинета: форма говорит с сервером тем же телом, что и чужая
 * система мерчанта, и правило «сумма с любой стороны» живёт в одном
 * месте.
 *
 * Сумма бывает названа с любой стороны: «получить ровно 50 000» сначала
 * считается обратным счётом на ту же отметку курса, и заявка уходит по
 * найденной сумме отдачи — той, что вернул бы `/quote`. Отметка —
 * присланная, способ выдачи — от получателя: по тому же снимку и той же
 * сетке, по которым уйдёт заявка. Сама операция — та же, что у Mini
 * App: ядро не знает, откуда пришёл запрос.
 */
export async function submitFromBody(
  core: Core,
  actor: Actor,
  body: ExchangeRequestBody,
  idempotencyKey: string,
): Promise<SubmitExchangeRequestResult> {
  let fromAmount = body.amount;
  let quotedAt = body.quotedAt;
  if (body.side === 'to') {
    const quote = await quoteFor(core, {
      from: body.from,
      to: body.to,
      amount: body.amount,
      side: 'to',
      payoutMethod: await recipientPayoutMethod(core, actor, body),
      asOf: body.quotedAt,
    });
    fromAmount = quote.from.amount;
    quotedAt ??= new Date(quote.quotedAt);
  }

  return core.submitExchangeRequest(actor, {
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
}

/**
 * Два следствия подачи — толчок панели, чтобы менеджер узнал о заявке
 * через секунду, и письмо мерчанту, если оно положено переходу. Повтор
 * с тем же ключом отдаёт ту же заявку и уведомлений не порождает —
 * тогда и панель звать не за чем.
 */
export async function afterSubmission(notifications: readonly Notification[]): Promise<void> {
  if (notifications.length === 0) return;
  nudgeStaffAlerts();
  await deliverMail(notifications);
}
