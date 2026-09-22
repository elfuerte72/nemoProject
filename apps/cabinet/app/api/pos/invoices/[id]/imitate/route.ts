import { InvalidInputError } from '@nemo/core';
import { errorResponse, json } from '@/lib/api';
import { requireActor } from '@/lib/auth';
import { requireTill } from '@/lib/mock/guard';
import { acquirer, IMITATION } from '@/lib/pos/acquirer';
import { acceptPayment } from '@/lib/pos/payments';
import { viewer } from '@/lib/reads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Кнопка «покупатель заплатил» — то место, куда у банка придёт вебхук.
 *
 * Работает только пока платежи принимает имитация: с настоящим
 * провайдером сообщение об оплате приходит от него, и кнопка, которая
 * умеет «оплатить» счёт мимо банка, была бы дырой, а не удобством.
 * Проверяется по имени провайдера в процессе, а не по счёту: счёт,
 * выставленный имитацией на dev, к банку на проде не приедет.
 *
 * Дальше — та же точка, что у вебхука (`acceptPayment`): переход
 * счёта, лента, толчок открытым вкладкам.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const actor = await requireActor();
    const { session } = await viewer();
    requireTill(session);
    const provider = acquirer();
    if (provider.name !== IMITATION) {
      throw new InvalidInputError(
        `Платежи принимает «${provider.title}»: об оплате сообщает он, а не кнопка`,
      );
    }
    const { id } = await context.params;
    const at = new Date();
    const invoice = acceptPayment(actor.merchantId, id, {
      provider: provider.name,
      providerTitle: provider.title,
      at,
    });
    return json({ invoice, qr: null, now: at.toISOString() });
  } catch (error) {
    return errorResponse(error);
  }
}
