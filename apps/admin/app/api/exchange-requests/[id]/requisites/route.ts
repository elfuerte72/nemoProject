import QRCode from 'qrcode';
import { errorResponse, json } from '@/lib/api';
import { requireStaffActor } from '@/lib/auth/require-session';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Полный номер карты клиента по заявке, которую менеджер ведёт, — а с
 * ним номер тайского счёта, содержимое QR и аккаунт Alipay.
 *
 * Отдельным запросом, а не полем в карточке заявки: номер не должен
 * уезжать на экран просто потому, что менеджер открыл заявку. Каждое
 * такое обращение попадает в журнал — операция записывает его в той же
 * транзакции, и пропустить запись нельзя.
 *
 * `POST`, а не `GET`: это не чтение справочной величины, а действие с
 * последствием, и кэшировать его нельзя ни браузеру, ни посреднику.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const actor = await requireStaffActor();
    const { id } = await context.params;
    const { qr, ...requisites } = await getCore().revealRequisites(actor, id);
    /*
     * QR рисуется заново из расшифрованной строки: картинку клиент не
     * присылал (docs/adr/0012), а менеджеру с телефона свой же экран не
     * отсканировать — он сохраняет картинку в альбом и открывает её из
     * банковского приложения или Alipay «из галереи». PNG, а не SVG:
     * его и сохраняют. Сама строка наружу не уходит: менеджеру она не
     * нужна — идентификатор из неё ядро отдаёт текстом отдельно.
     */
    const qrImage = qr
      ? await QRCode.toDataURL(qr, {
          type: 'image/png',
          width: 512,
          // Тихая зона стандарта — четыре модуля: поле из CSS в
          // сохранённую картинку не попадает, а сканер без него сбоит.
          margin: 4,
          errorCorrectionLevel: 'M',
        })
      : null;
    return json({ requisites, qrImage });
  } catch (error) {
    return errorResponse(error);
  }
}
