import { payoutMethodSchema } from '@nemo/types';
import { errorResponse, json } from '@/lib/api';
import { requireActor } from '@/lib/auth';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Котировка по направлению для формы новой заявки — с наценкой сервиса.
 *
 * Спрашивается на направление, а не на сумму: суммы считает экран той
 * же арифметикой, что и ядро (`@nemo/types`), а сервер присылает курс
 * и, у сетки, оба звена пути. Пустой ответ — рабочее состояние, а не
 * ошибка: провайдер котировок может лежать, и заявку тогда подают без
 * курса.
 *
 * Способ выдачи приходит от экрана, но решает не он: заявка возьмёт
 * его из записи получателя. Здесь он нужен затем, чтобы показанная
 * цена совпала с той, по которой заявка уйдёт, — ставка у банка и
 * кошелька разная.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    await requireActor();
    const params = new URL(request.url).searchParams;
    const fromCode = params.get('from')?.trim().toUpperCase();
    const toCode = params.get('to')?.trim().toUpperCase();
    if (!fromCode || !toCode) {
      return json({ quote: null });
    }

    const payoutMethod = payoutMethodSchema.safeParse(params.get('payoutMethod'));
    const quote = await getCore().getQuote({
      fromCode,
      toCode,
      fromAmount: '1',
      ...(payoutMethod.success ? { payoutMethod: payoutMethod.data } : {}),
    });
    return json({ quote });
  } catch (error) {
    return errorResponse(error);
  }
}
