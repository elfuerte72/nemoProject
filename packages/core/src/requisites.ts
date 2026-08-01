import { and, desc, eq, isNull } from 'drizzle-orm';
import { lastFour, seal } from '@nemo/crypto';
import { clientRequisites } from '@nemo/db';
import { requireClient, type Actor } from './actor.js';
import { requirePublicKey, type CoreConfig, type Executor } from './context.js';
import { InvalidInputError, NotFoundError } from './errors.js';

/**
 * Реквизиты клиента: куда сервис отправляет деньги по исполненной
 * заявке.
 *
 * Номер карты хранится только зашифрованным, и расшифровать его может
 * лишь админ-панель — в клиентском деплое приватного ключа нет
 * физически (docs/adr/0002). Поэтому клиент, единожды сохранив номер,
 * больше его не видит: ему показываются последние четыре цифры, чтобы
 * он узнавал свою карту.
 *
 * Прежние реквизиты не удаляются, а архивируются: на них ссылаются
 * прошлые заявки, и в разборе спорного обмена должно быть видно, куда
 * деньги ушли тогда, а не куда ушли бы сейчас.
 */

export interface RequisitesView {
  readonly id: string;
  readonly bankName: string | null;
  readonly phone: string | null;
  /** Всё, что клиент видит от своего номера карты. */
  readonly cardLast4: string | null;
  readonly createdAt: Date;
}

export interface SaveRequisitesInput {
  readonly bankName?: string | undefined;
  readonly phone?: string | undefined;
  readonly cardNumber?: string | undefined;
}

type RequisitesRow = typeof clientRequisites.$inferSelect;

/**
 * Наружу уходит представление без `card_sealed`: конверт бесполезен без
 * приватного ключа, но и отдавать его клиентскому приложению незачем.
 */
function toView(row: RequisitesRow): RequisitesView {
  return {
    id: row.id,
    bankName: row.bankName,
    phone: row.phone,
    cardLast4: row.cardLast4,
    createdAt: row.createdAt,
  };
}

export async function saveRequisites(
  ctx: CoreConfig,
  actor: Actor,
  input: SaveRequisitesInput,
): Promise<RequisitesView> {
  const clientId = requireClient(actor);

  const bankName = input.bankName?.trim() || undefined;
  const phone = input.phone?.trim() || undefined;
  const cardNumber = input.cardNumber?.trim() || undefined;

  if (!bankName && !phone && !cardNumber) {
    throw new InvalidInputError('Укажите хотя бы один реквизит');
  }

  const card = cardNumber === undefined ? undefined : sealCard(ctx, cardNumber);

  return ctx.db.transaction(async (tx) => {
    await tx
      .update(clientRequisites)
      .set({ archivedAt: new Date() })
      .where(
        and(eq(clientRequisites.clientId, clientId), isNull(clientRequisites.archivedAt)),
      );

    const [row] = await tx
      .insert(clientRequisites)
      .values({
        clientId,
        bankName: bankName ?? null,
        phone: phone ?? null,
        cardLast4: card?.last4 ?? null,
        cardSealed: card?.sealed ?? null,
      })
      .returning();

    return toView(row!);
  });
}

function sealCard(
  ctx: CoreConfig,
  cardNumber: string,
): { last4: string; sealed: Buffer } {
  const publicKey = requirePublicKey(ctx);
  try {
    return { last4: lastFour(cardNumber), sealed: seal(publicKey, cardNumber) };
  } catch (error) {
    if (error instanceof RangeError) {
      throw new InvalidInputError('Номер карты выглядит неполным');
    }
    throw error;
  }
}

/** Текущие реквизиты клиента. `null`, пока он их не сохранил. */
export async function getRequisites(
  ctx: CoreConfig,
  actor: Actor,
): Promise<RequisitesView | null> {
  const clientId = requireClient(actor);
  const [row] = await ctx.db
    .select()
    .from(clientRequisites)
    .where(
      and(eq(clientRequisites.clientId, clientId), isNull(clientRequisites.archivedAt)),
    )
    .orderBy(desc(clientRequisites.createdAt))
    .limit(1);

  return row ? toView(row) : null;
}

/**
 * Реквизиты, которые клиент подтверждает при подаче заявки. Чужие и
 * архивные не подходят: деньги ушли бы не туда и не тому.
 */
export async function requireOwnRequisites(
  executor: Executor,
  clientId: bigint,
  requisitesId: string,
): Promise<void> {
  const [row] = await executor
    .select({ id: clientRequisites.id })
    .from(clientRequisites)
    .where(
      and(
        eq(clientRequisites.id, requisitesId),
        eq(clientRequisites.clientId, clientId),
        isNull(clientRequisites.archivedAt),
      ),
    )
    .limit(1);

  if (!row) {
    throw new NotFoundError('Реквизиты не найдены');
  }
}
