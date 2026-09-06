import { z } from 'zod';
import { InvalidInputError } from '@nemo/core';
import { errorResponse, json } from '@/lib/api';
import { getCore } from '@/lib/core';
import { deliverMail, requireMail } from '@/lib/mail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Анкета мерчанта: он заводит её сам.
 *
 * Почта спрашивается до операции: аккаунт, чьё письмо некуда
 * отправить, — это мерчант, который никогда не подтвердит адрес и
 * никогда не попадёт к администратору.
 *
 * Что считать правдоподобной почтой, паролем, телефоном и сайтом,
 * решает ядро, а не эта схема: форма — не единственный путь к
 * операции, и правило, стоящее только здесь, обходится соседним.
 */
const schema = z.object({
  email: z.string(),
  password: z.string(),
  name: z.string(),
  site: z.string().optional(),
  contactName: z.string(),
  phone: z.string(),
  about: z.string().optional(),
});

export async function POST(request: Request): Promise<Response> {
  try {
    requireMail();

    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      throw new InvalidInputError('Заполните все поля анкеты');
    }

    const result = await getCore().registerMerchant(parsed.data);
    await deliverMail(result.notifications);

    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
