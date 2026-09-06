import { z } from 'zod';
import { InvalidInputError } from '@nemo/core';
import { errorResponse, json } from '@/lib/api';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ token: z.string().max(200) });

/**
 * Подтверждение почты — нажатием, а не открытием ссылки.
 *
 * Ключ одноразовый, а по ссылке из письма ходит не только человек:
 * почтовые шлюзы открывают ссылки заранее, проверяя их на вредоносность.
 * Открывшись сама, страница тратила бы ключ до того, как мерчант увидит
 * письмо, — и он оставался бы с неподтверждённым адресом, не сделав
 * ничего. Тем же правилом живёт сброс пароля.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      throw new InvalidInputError('Ссылка неполная: откройте её из письма целиком');
    }

    await getCore().verifyMerchantEmail(parsed.data.token);
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
