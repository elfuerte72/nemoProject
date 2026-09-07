import { z } from 'zod';
import { ForbiddenError, InvalidInputError } from '@nemo/core';
import { errorResponse, json } from '@/lib/api';
import { addressOf, attemptAllowed, attemptSpent } from '@/lib/attempts';
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
 * Длина полей — дело схемы: она отсекает не опечатку, а нагрузку.
 *
 * Число анкет с одного адреса ограничено, и спрашивается это до
 * операции: заведение считает argon2id — десятки миллисекунд процессора
 * намеренно, — а следом уходит письмо на названный здесь же ящик. Без
 * предела маршрут работал бы разгоном процессора и рассылкой с нашего
 * домена чужими руками.
 */
const schema = z.object({
  email: z.string().max(320),
  password: z.string().max(200),
  name: z.string().max(200),
  site: z.string().max(500).optional(),
  contactName: z.string().max(200),
  phone: z.string().max(50),
  about: z.string().max(2000).optional(),
});

export async function POST(request: Request): Promise<Response> {
  try {
    requireMail();

    const address = addressOf(request);
    if (!attemptAllowed(`register:${address}`)) {
      throw new ForbiddenError('Слишком много анкет подряд. Попробуйте через четверть часа.');
    }

    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      throw new InvalidInputError('Заполните все поля анкеты');
    }

    // Попытка тратится до работы, а не после удачи: дорого стоит сама
    // попытка — хеш пароля и письмо.
    attemptSpent(`register:${address}`);
    const result = await getCore().registerMerchant(parsed.data);
    await deliverMail(result.notifications);

    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
