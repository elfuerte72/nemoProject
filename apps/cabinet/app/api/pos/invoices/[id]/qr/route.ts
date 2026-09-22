import QRCode from 'qrcode';
import { NotFoundError } from '@nemo/core';
import { errorResponse } from '@/lib/api';
import { requireActor } from '@/lib/auth';
import { findInvoice } from '@/lib/mock/store';
import { acquirer } from '@/lib/pos/acquirer';
import { isPayable } from '@/lib/pos/lifecycle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Картинка QR по счёту — то, что показывают покупателю.
 *
 * Рисуется на сервере из содержимого, которое отдал провайдер, тем же
 * `qrcode`, каким панель рисует QR реквизита. Содержимое наружу не
 * уходит отдельно: экрану нужна картинка, а не строка.
 *
 * У счёта, который больше не ждёт денег, картинки нет — 404, а не
 * вчерашний код: истёкший QR на экране у стойки читался бы как живой.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const actor = await requireActor();
    const { id } = await context.params;
    const now = new Date();
    const invoice = findInvoice(actor.merchantId, id, now);
    if (!invoice || !invoice.payment || !isPayable(invoice, now)) {
      throw new NotFoundError('У этого счёта нет действующего QR');
    }
    const qr = await acquirer().qr(invoice.payment.ref, now);
    if (!qr) throw new NotFoundError('У этого счёта нет действующего QR');

    const svg = await QRCode.toString(qr.payload, {
      type: 'svg',
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#1a1a2e', light: '#ffffff' },
    });
    return new Response(svg, {
      headers: {
        'content-type': 'image/svg+xml; charset=utf-8',
        // Кэшировать нечего: код меняется каждые пять минут, и адрес
        // картинки экран меняет вместе с ним.
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
