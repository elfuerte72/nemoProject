import { z } from 'zod';
import { InvalidInputError } from '@nemo/core';
import { errorResponse, json } from '@/lib/api';
import { requireActor } from '@/lib/auth';
import { requireTill } from '@/lib/mock/guard';
import { listInvoices, removeInvoices, replaceInvoice } from '@/lib/mock/store';
import { acquirer } from '@/lib/pos/acquirer';
import { publishPos } from '@/lib/pos/bus';
import { bulkTargets, paidByHand } from '@/lib/pos/lifecycle';
import { viewer } from '@/lib/reads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Действие с отмеченными строками списка счетов: отметить оплаченными
 * или удалить.
 *
 * Правила те же, что у одного счёта, и живут там же (`bulkTargets` в
 * `pos/lifecycle.ts`): оплаченным отмечается только ждущий денег счёт,
 * удаляется только тот, по которому денег не было. Остальные отмеченные
 * — мимо, а не отказ всему: отмечают вперемешку, и ответ говорит,
 * сколько задето и сколько пропущено.
 *
 * Ждущий счёт перед удалением отменяется у провайдера: у банка после
 * этого QR перестаёт приниматься, и покупатель, успевший его сохранить,
 * не заплатит за счёт, которого у мерчанта больше нет.
 */
const bodySchema = z.object({
  action: z.enum(['paid', 'delete']),
  ids: z.array(z.string().trim().min(1).max(80)).min(1).max(500),
});

export async function POST(request: Request): Promise<Response> {
  try {
    const actor = await requireActor();
    const { session } = await viewer();
    requireTill(session);
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new InvalidInputError('Не отмечено ни одного счёта');
    const { action, ids } = parsed.data;

    const at = new Date();
    const invoices = listInvoices(actor.merchantId, at);
    const targets = new Set(bulkTargets(invoices, ids, action, at));
    const chosen = invoices.filter((one) => targets.has(one.id));

    let done = 0;
    if (action === 'paid') {
      for (const one of chosen) replaceInvoice(actor.merchantId, paidByHand(one, at));
      done = chosen.length;
    } else {
      /*
       * По одному: отмена у провайдера, затем удаление этого счёта. Упади
       * отмена на третьем — первые два уже согласованы с банком и сняты,
       * а не отменены у банка и оставлены ждать с живым QR. Удаление
       * перепроверяет, что денег по счёту не было (`removeInvoices`).
       */
      for (const one of chosen) {
        if (one.status === 'issued' && one.payment) await acquirer().cancel(one.payment.ref, at);
        done += removeInvoices(actor.merchantId, [one.id]).length;
      }
    }
    for (const one of chosen) publishPos(actor.merchantId, { kind: 'invoice', id: one.id });

    return json({ done, skipped: ids.length - done });
  } catch (error) {
    return errorResponse(error);
  }
}
