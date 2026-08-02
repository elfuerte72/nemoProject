import { and, desc, eq, isNull } from 'drizzle-orm';
import { addressEdges, lastFour, seal } from '@nemo/crypto';
import { clientRequisites, currencies, transferNetworks } from '@nemo/db';
import { requisiteKindSuits, type RequisiteKind } from '@nemo/types';
import { requireClient, type Actor } from './actor.js';
import { requirePublicKey, type CoreConfig, type Executor } from './context.js';
import { InvalidInputError, NotFoundError } from './errors.js';
import { requireActiveNetwork } from './networks.js';

/**
 * Реквизиты клиента: куда сервис отправляет деньги по исполненной
 * заявке.
 *
 * Запись описывает один способ получения целиком — перевод по номеру
 * телефона, на карту или на криптокошелёк, — а не набор необязательных
 * полей. Внутри способа обязательно всё: записи, по которой нельзя
 * отправить деньги, не существует, и проверяет это ограничение базы, а
 * не только форма.
 *
 * Номер карты и адрес кошелька хранятся только зашифрованными, и
 * расшифровать их может лишь админ-панель — в клиентском деплое
 * приватного ключа нет физически (docs/adr/0002). Клиент, единожды
 * сохранив запись, больше не видит её целиком: ему показываются
 * последние четыре цифры карты и края адреса — их достаточно, чтобы
 * узнать свою запись в списке.
 *
 * Записей у клиента столько, сколько ему нужно: карта, телефон и
 * кошелёк — разные способы, а не смена одного другим. Удаление —
 * архивирование: на запись ссылаются исполненные заявки, и в разборе
 * спорного обмена должно быть видно, куда деньги ушли тогда.
 */

export interface RequisitesView {
  readonly id: string;
  readonly kind: RequisiteKind;
  readonly bankName: string | null;
  readonly phone: string | null;
  /** Всё, что клиент видит от своего номера карты. */
  readonly cardLast4: string | null;
  readonly network: string | null;
  /** Всё, что клиент видит от адреса кошелька: его начало и конец. */
  readonly addressHint: string | null;
  /**
   * Можно ли подать заявку на эту запись прямо сейчас. Ложь у кошелька
   * в сети, которую администратор погасил: запись остаётся у клиента —
   * её можно удалить, а сеть могут включить обратно, — но выбирать её
   * при подаче нельзя.
   */
  readonly isAvailable: boolean;
  readonly createdAt: Date;
}

/**
 * Что нужно сохранить — по способу получения. Размеченное объединение, а
 * не набор необязательных полей: «банк и телефон» и «сеть и адрес» —
 * разные наборы, и общий тип с шестью `optional` разрешал бы записать
 * сеть у карты ещё до того, как откажет база.
 */
export type SaveRequisitesInput =
  | { readonly kind: 'phone'; readonly bankName: string; readonly phone: string }
  | { readonly kind: 'card'; readonly bankName: string; readonly cardNumber: string }
  | { readonly kind: 'wallet'; readonly network: string; readonly address: string };

type RequisitesRow = typeof clientRequisites.$inferSelect;

/**
 * Наружу уходит представление без шифрованных полей: конверт бесполезен
 * без приватного ключа, но и отдавать его клиентскому приложению
 * незачем.
 */
function toView(row: RequisitesRow, isAvailable = true): RequisitesView {
  return {
    id: row.id,
    kind: row.kind,
    bankName: row.bankName,
    phone: row.phone,
    cardLast4: row.cardLast4,
    network: row.network,
    addressHint: row.addressHint,
    isAvailable,
    createdAt: row.createdAt,
  };
}

/**
 * Короткая подпись записи — ею называется открытый реквизит в журнале
 * доступа: администратор должен видеть, что именно сотрудник смотрел.
 *
 * У клиентского приложения такая же подпись своя (`lib/format.ts`), и
 * это не забытая общая функция: ядро тянет за собой драйвер базы, и
 * импорт отсюда в экран увёз бы её в браузер. Совпадать они должны, и
 * расходятся заметно — один реквизит назывался бы в приложении и в
 * панели по-разному.
 */
export function describeRequisites(view: {
  kind: RequisiteKind;
  bankName: string | null;
  phone: string | null;
  cardLast4: string | null;
  network: string | null;
  addressHint: string | null;
}): string {
  switch (view.kind) {
    case 'phone':
      return [view.bankName, view.phone].filter(Boolean).join(' · ');
    case 'card':
      return [view.bankName, `карта •••• ${view.cardLast4 ?? ''}`.trim()]
        .filter(Boolean)
        .join(' · ');
    case 'wallet':
      return [view.network, view.addressHint].filter(Boolean).join(' · ');
  }
}

/** Обязательное поле записи: пустое означало бы реквизит, по которому не отправить. */
function required(value: string, subject: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new InvalidInputError(`${subject}: поле обязательно`);
  }
  return trimmed;
}

function sealCard(ctx: CoreConfig, cardNumber: string): { last4: string; sealed: Buffer } {
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

/**
 * Строка для вставки. Собирается до транзакции, потому что шифрование —
 * работа процессора, а не базы, и держать ради него открытую транзакцию
 * незачем.
 */
type RequisitesInsert = typeof clientRequisites.$inferInsert;

function rowFor(
  ctx: CoreConfig,
  clientId: bigint,
  input: SaveRequisitesInput,
): RequisitesInsert {
  switch (input.kind) {
    case 'phone':
      return {
        clientId,
        kind: 'phone',
        bankName: required(input.bankName, 'Банк'),
        // Телефон остаётся открытым: по нему менеджер и отправляет
        // перевод, а прячется то, чем можно распорядиться напрямую.
        phone: required(input.phone, 'Телефон для перевода'),
      };
    case 'card': {
      const card = sealCard(ctx, required(input.cardNumber, 'Номер карты'));
      return {
        clientId,
        kind: 'card',
        bankName: required(input.bankName, 'Банк'),
        cardLast4: card.last4,
        cardSealed: card.sealed,
      };
    }
    case 'wallet': {
      const address = required(input.address, 'Адрес кошелька');
      return {
        clientId,
        kind: 'wallet',
        network: required(input.network, 'Сеть'),
        addressSealed: seal(requirePublicKey(ctx), address),
        addressHint: addressEdges(address),
      };
    }
  }
}

export async function saveRequisites(
  ctx: CoreConfig,
  actor: Actor,
  input: SaveRequisitesInput,
): Promise<RequisitesView> {
  const clientId = requireClient(actor);
  const values = rowFor(ctx, clientId, input);

  return ctx.db.transaction(async (tx) => {
    // Сеть — из общего справочника: выключенную администратором
    // сохранять незачем, по ней всё равно не отправят.
    if (values.network) {
      await requireActiveNetwork(tx, values.network);
    }

    // Прежние записи остаются: карта, телефон и кошелёк — разные
    // способы получения, а не смена одного другим.
    const [row] = await tx.insert(clientRequisites).values(values).returning();
    return toView(row!);
  });
}

/**
 * Записи клиента. Архивные не в счёт — их он удалил.
 *
 * Кошелёк в погашенной сети остаётся в списке, но помечен недоступным:
 * убрать его совсем значило бы, что запись пропала сама, а клиенту она
 * ещё нужна — сеть включат обратно, а до тех пор он может её удалить.
 */
export async function listRequisites(
  ctx: CoreConfig,
  actor: Actor,
): Promise<readonly RequisitesView[]> {
  const clientId = requireClient(actor);
  const rows = await ctx.db
    .select({ requisites: clientRequisites, networkIsActive: transferNetworks.isActive })
    .from(clientRequisites)
    .leftJoin(transferNetworks, eq(transferNetworks.code, clientRequisites.network))
    .where(
      and(eq(clientRequisites.clientId, clientId), isNull(clientRequisites.archivedAt)),
    )
    .orderBy(desc(clientRequisites.createdAt));

  // У перевода по телефону и на карту сети нет вовсе, и соединение
  // оставляет пусто: такая запись доступна всегда.
  return rows.map((row) => toView(row.requisites, row.networkIsActive ?? true));
}

/**
 * Удалить запись. На деле — заархивировать: на неё ссылаются поданные
 * заявки, и вычеркнуть её из них значило бы стереть, куда ушли деньги.
 */
export async function archiveRequisites(
  ctx: CoreConfig,
  actor: Actor,
  requisitesId: string,
): Promise<void> {
  const clientId = requireClient(actor);
  const [row] = await ctx.db
    .update(clientRequisites)
    .set({ archivedAt: new Date() })
    .where(
      and(
        eq(clientRequisites.id, requisitesId),
        eq(clientRequisites.clientId, clientId),
        isNull(clientRequisites.archivedAt),
      ),
    )
    .returning({ id: clientRequisites.id });

  if (!row) {
    throw new NotFoundError('Реквизиты не найдены');
  }
}

/**
 * Реквизиты, которые клиент подтверждает при подаче заявки.
 *
 * Чужие и архивные не подходят: деньги ушли бы не туда и не тому. Не
 * подходят и записи не того рода — рубли приходят на карту или по
 * телефону, USDT на кошелёк, — иначе менеджер получил бы заявку, по
 * которой нечего исполнять.
 */
export async function requireSuitableRequisites(
  executor: Executor,
  clientId: bigint,
  requisitesId: string,
  toCode: string,
): Promise<void> {
  const [row] = await executor
    .select({ kind: clientRequisites.kind, network: clientRequisites.network })
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

  const [currency] = await executor
    .select({ kind: currencies.kind })
    .from(currencies)
    .where(eq(currencies.code, toCode))
    .limit(1);

  if (!currency) {
    throw new NotFoundError(`Валюта ${toCode} недоступна`);
  }
  if (!requisiteKindSuits(row.kind, currency.kind)) {
    throw new InvalidInputError(
      `Эти реквизиты не подходят для получения ${toCode}: выберите другой способ`,
    );
  }
  // Сеть могла быть выключена после того, как клиент сохранил запись:
  // предлагать её при подаче нельзя, а тихо принять — значит завести
  // заявку, которую некому исполнить.
  if (row.network) {
    await requireActiveNetwork(executor, row.network);
  }
}
