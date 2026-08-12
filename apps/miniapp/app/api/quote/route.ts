import { payoutMethodSchema } from '@nemo/types';
import { errorResponse, json, requireInitData } from '@/lib/api';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Котировка по направлению — с наценкой сервиса.
 *
 * Пустой ответ — рабочее состояние, а не ошибка: у наличных курса нет
 * вовсе, а провайдер котировок может лежать. Экран в обоих случаях
 * говорит одно и то же — курс назовёт менеджер.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    requireInitData(request);
    const url = new URL(request.url);
    const fromCode = url.searchParams.get('fromCode');
    const toCode = url.searchParams.get('toCode');
    if (!fromCode || !toCode) {
      return json({ quote: null });
    }

    /*
     * Способ выдачи приходит от экрана, но решает не он: заявка возьмёт
     * его из записи, на которую придут деньги. Здесь он нужен затем,
     * чтобы показанная цена совпала с той, по которой заявка уйдёт, —
     * ставка у банка и кошелька разная. Чужое значение операция просто
     * не узнает и посчитает по банковской сетке.
     */
    const payoutMethod = payoutMethodSchema.safeParse(url.searchParams.get('payoutMethod'));

    const quote = await getCore().getQuote({
      fromCode,
      toCode,
      fromAmount: url.searchParams.get('fromAmount') ?? undefined,
      ...(payoutMethod.success ? { payoutMethod: payoutMethod.data } : {}),
    });
    return json({ quote });
  } catch (error) {
    return errorResponse(error);
  }
}
