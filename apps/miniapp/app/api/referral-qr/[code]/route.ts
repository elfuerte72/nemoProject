import QRCode from 'qrcode';
import { errorResponse } from '@/lib/api';
import { getCore } from '@/lib/core';
import { referralLink } from '@/lib/referral';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * QR реферальной ссылки картинкой — на сервере, а не в браузере:
 * библиотека рисования в бандл Mini App не едет ради одного листа, а у
 * панели она уже есть. Маршрут открыт без подписи запуска: ссылка и так
 * публична, её пересылают в чаты, — а `<img>` заголовков не несёт.
 * Незнакомый или архивный код — 404: рисовать ссылку, по которой никого
 * не привяжут, незачем.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ code: string }> },
): Promise<Response> {
  try {
    const { code } = await context.params;
    const known = await getCore().lookupReferralCode(code);
    const link = known ? referralLink(known) : undefined;
    if (!link) {
      return new Response('Код не найден', { status: 404 });
    }
    const png = await QRCode.toBuffer(link, {
      type: 'png',
      width: 512,
      // Тихая зона стандарта — четыре модуля: сканер без неё сбоит.
      margin: 4,
      errorCorrectionLevel: 'M',
    });
    return new Response(new Uint8Array(png), {
      headers: {
        'content-type': 'image/png',
        'cache-control': 'public, max-age=86400',
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
