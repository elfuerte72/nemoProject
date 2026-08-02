import { z } from 'zod';
import { InvalidInputError } from '@nemo/core';
import { networkCodeSchema } from '@nemo/types';
import { errorResponse, json } from '@/lib/api';
import { requireStaffActor } from '@/lib/auth/require-session';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Флажок сети в справочнике.
 *
 * Состав справочника здесь не меняется: заводит и убирает сети скрипт
 * развёртывания, а из панели администратор гасит ту, в которой кошелёк
 * временно недоступен. Право администратора проверяет операция, а не
 * маршрут: правило, повторённое здесь, когда-нибудь разошлось бы с ядром.
 */
const schema = z.object({
  code: networkCodeSchema,
  isActive: z.boolean(),
});

export async function POST(request: Request): Promise<Response> {
  try {
    const actor = await requireStaffActor();
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      throw new InvalidInputError('Сеть не распознана');
    }

    const network = await getCore().setNetworkActive(
      actor,
      parsed.data.code,
      parsed.data.isActive,
    );
    return json({ network });
  } catch (error) {
    return errorResponse(error);
  }
}
