import { z } from 'zod';
import {
  ATTACHMENT_DOWNLOAD_LIMIT_BYTES,
  formatFileSize,
  InvalidInputError,
  NotFoundError,
} from '@nemo/core';
import { botToken, sendClientFile } from '@nemo/telegram';
import { telegramUserIdSchema } from '@nemo/types';
import { errorResponse, json } from '@/lib/api';
import { requireStaffActor } from '@/lib/auth/require-session';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Файл от менеджера клиенту — тем же ботом, каким приходит ответ
 * словами.
 *
 * Порядок здесь обратный обычному: сперва отправка, потом запись
 * (docs/adr/0020). Причина в том, что у файла нет идентификатора, пока
 * его не примет Telegram, а самого файла у сервиса не появляется — на
 * дисках панели чужих чеков нет, и своих тоже.
 *
 * Из этого следует и остальное. Клиент проверяется до отправки: послать
 * файл тому, кого в базе нет, значит оставить его в чужом чате без
 * строки в переписке. Предел размера — тот же, до которого Telegram
 * отдаёт файлы ботам: больший ушёл бы клиенту, но менеджер потом не
 * открыл бы его в панели. Подпись — до 1024 знаков: столько Bot API
 * берёт подписью, а длинные слова у менеджера и так уходят отдельным
 * ответом.
 */

/** Сколько знаков Bot API берёт подписью к файлу. */
const CAPTION_LIMIT = 1024;

export async function POST(request: Request): Promise<Response> {
  try {
    const actor = await requireStaffActor();
    const form = await request.formData().catch(() => undefined);
    const file = form?.get('file');
    const clientId = telegramUserIdSchema.safeParse(form?.get('clientId'));
    if (!form || !(file instanceof File) || !clientId.success) {
      throw new InvalidInputError('Файл не распознан');
    }
    if (file.size === 0) {
      throw new InvalidInputError('Пустой файл клиенту не отправляется');
    }
    if (file.size > ATTACHMENT_DOWNLOAD_LIMIT_BYTES) {
      throw new InvalidInputError(
        `Файл больше ${formatFileSize(ATTACHMENT_DOWNLOAD_LIMIT_BYTES)}: такой Telegram не отдаст обратно, и в панели он не откроется`,
      );
    }

    const body = textOf(form.get('body'));
    if (body !== undefined && body.length > CAPTION_LIMIT) {
      throw new InvalidInputError(
        `Подпись к файлу — до ${CAPTION_LIMIT} знаков. Длинное отправьте отдельным ответом`,
      );
    }
    /*
     * Номер заявки проверяется до отправки, а не колонкой базы после
     * неё: непохожий на номер уронил бы запись уже после того, как файл
     * ушёл клиенту, — и менеджер прочёл бы «не записался» вместо
     * «набрано не то».
     */
    const requestId = textOf(form.get('exchangeRequestId'));
    if (requestId !== undefined && !z.string().uuid().safeParse(requestId).success) {
      throw new InvalidInputError('Заявка не распознана');
    }

    const core = getCore();
    if (!(await core.clientExists(actor, clientId.data))) {
      throw new NotFoundError('Клиент не найден');
    }

    /*
     * Отказ Telegram — рабочее состояние, а не авария панели: клиент
     * мог заблокировать бота, а файл — не подойти по своим правилам.
     * «Внутренняя ошибка» на это отвечала бы менеджеру не о том.
     */
    let attachment;
    try {
      attachment = await sendClientFile({
        botToken: botToken(),
        to: clientId.data,
        file,
        ...(body === undefined ? {} : { body }),
      });
    } catch (error) {
      console.error('Telegram не принял файл клиента', error);
      return json(
        {
          error:
            'Telegram не принял файл. Так бывает, когда клиент заблокировал бота: напишите ему словами и посмотрите, ответит ли.',
        },
        { status: 502 },
      );
    }

    /*
     * Файл у клиента уже есть, и повторять отправку после сбоя записи
     * нельзя — придёт второй раз. Об этом и говорится: менеджеру важно
     * знать, что дошло, а не что записалось.
     */
    try {
      const { message } = await core.replyToClient(actor, {
        clientId: clientId.data,
        attachment,
        ...(body === undefined ? {} : { body }),
        ...(requestId === undefined ? {} : { exchangeRequestId: requestId }),
      });
      return json({ message }, { status: 201 });
    } catch (error) {
      console.error('Файл ушёл клиенту, но не записался в переписку', error);
      return json(
        {
          error:
            'Файл клиенту ушёл, но в переписку не записался. Отправлять заново не нужно — он придёт вторым.',
          // По этому признаку поле ответа пустеет, как по принятому
          // (`lib/send-outcome.ts`): слова одни, а повтор — второй чек.
          delivered: true,
        },
        { status: 500 },
      );
    }
  } catch (error) {
    return errorResponse(error);
  }
}

/** Поле формы словами: пустое и нестроковое — как отсутствующее. */
function textOf(value: FormDataEntryValue | null): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}
