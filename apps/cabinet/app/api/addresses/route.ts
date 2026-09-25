import { z } from 'zod';
import { InvalidInputError } from '@nemo/core';
import { errorResponse, json } from '@/lib/api';
import { requireActor } from '@/lib/auth';
import { getCore } from '@/lib/core';
import { toAddressRow } from '@/lib/address-rows';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Вид адреса, внутреннюю сеть и ширину подсети проверяет ядро — своими словами.
const schema = z.object({ address: z.string(), note: z.string().default('') });

/**
 * Разрешённый адрес для вызовов API. С первого же адреса в списке
 * вызовы с прочих отвергаются — об этом экран говорит до нажатия.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const actor = await requireActor();
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      throw new InvalidInputError('Назовите адрес: IP или подсеть');
    }

    const added = await getCore().addApiAddress(actor, parsed.data);
    return json({ address: toAddressRow(added) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
