import { z } from 'zod';
import { InvalidInputError } from '@nemo/core';
import { payoutMethodSchema } from '@nemo/types';
import { errorResponse, json } from '@/lib/api';
import { requireStaffActor } from '@/lib/auth/require-session';
import { getCore } from '@/lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Ставки комиссии по ступеням.
 *
 * Два действия на один маршрут: переписать ступени и погасить сетку.
 * Разделять их по адресам незачем — сетка одна сущность, и журнальный
 * след у обеих правок общий.
 *
 * Ступени приезжают строками: денежная величина через `number` теряет
 * точность, а порог — это доллары, по которым считается цена.
 * Правдоподобие сетки — возрастание порогов, последняя ступень без
 * границы, хотя бы одна ставка на строку и не оба фикса разом —
 * проверяет операция ядра: форма не единственный способ её позвать.
 *
 * Право администратора тоже проверяет операция, а не маршрут: правило,
 * повторённое здесь, когда-нибудь разошлось бы с ядром.
 */
const schema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('save'),
    toCode: z.string().min(1),
    payoutMethod: payoutMethodSchema,
    /** Минимум направления в долларах; отсутствие снимает порог. */
    minUsd: z.string().optional(),
    tiers: z
      .array(
        z.object({
          upToUsd: z.string().nullable(),
          fixedUsd: z.string().optional(),
          rateBps: z.number().int().optional(),
          fixedPayout: z.string().optional(),
        }),
      )
      .min(1),
  }),
  z.object({
    action: z.literal('active'),
    scheduleId: z.string().uuid(),
    isActive: z.boolean(),
  }),
]);

export async function POST(request: Request): Promise<Response> {
  try {
    const actor = await requireStaffActor();
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      throw new InvalidInputError('Сетка комиссии не распознана');
    }

    const core = getCore();
    const schedule =
      parsed.data.action === 'save'
        ? await core.saveFeeSchedule(actor, {
            toCode: parsed.data.toCode,
            payoutMethod: parsed.data.payoutMethod,
            minUsd: parsed.data.minUsd,
            tiers: parsed.data.tiers,
          })
        : await core.setFeeScheduleActive(
            actor,
            parsed.data.scheduleId,
            parsed.data.isActive,
          );

    return json({ schedule });
  } catch (error) {
    return errorResponse(error);
  }
}
