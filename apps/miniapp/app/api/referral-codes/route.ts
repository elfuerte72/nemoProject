import { z } from 'zod';
import { InvalidInputError } from '@nemo/core';
import { referralCodeKindSchema } from '@nemo/types';
import { errorResponse, json, requireInitData } from '@/lib/api';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Коды клиента: ссылки и промокоды. Форму промокода проверяет операция. */
export async function GET(request: Request): Promise<Response> {
  try {
    const initData = requireInitData(request);
    const codes = await getCore().listReferralCodes({
      type: 'client',
      telegramUserId: initData.telegramUserId,
    });
    return json({ codes });
  } catch (error) {
    return errorResponse(error);
  }
}

const createSchema = z.object({
  kind: referralCodeKindSchema,
  label: z.string().max(200),
  code: z.string().max(100).optional(),
});

export async function POST(request: Request): Promise<Response> {
  try {
    const initData = requireInitData(request);
    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new InvalidInputError('Нужны вид кода и название');
    }
    const code = await getCore().createReferralCode(
      { type: 'client', telegramUserId: initData.telegramUserId },
      parsed.data,
    );
    return json({ code }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
