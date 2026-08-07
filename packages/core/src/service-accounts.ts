import { and, asc, eq } from 'drizzle-orm';
import { addressEdges, lastFour, open, seal } from '@nemo/crypto';
import { currencies, serviceAccounts } from '@nemo/db';
import {
  looksLikeCardNumber,
  looksLikePhone,
  looksLikeWalletAddress,
  requisiteKindSuits,
  type RequisiteKind,
} from '@nemo/types';
import { requireAdmin, requireStaff, type Actor } from './actor.js';
import {
  requirePrivateKey,
  requirePublicKey,
  type CoreConfig,
  type Executor,
} from './context.js';
import { InvalidInputError, NotFoundError } from './errors.js';
import { requireActiveNetwork } from './networks.js';
import { recordSettingsChange } from './settings-audit.js';

/**
 * Счета сервиса: куда клиент отправляет оплату (docs/adr/0008).
 *
 * Раньше менеджер набирал реквизиты руками в каждой заявке — из пустого
 * поля текст уходил клиенту в чат, и по нему шли деньги. Опечатка в
 * одной цифре означала перевод, который не возвращается.
 *
 * Устроено по образцу реквизитов клиента и намеренно: запись описывает
 * один способ приёма целиком, обязательность полей внутри способа
 * держит ограничение базы, а правдоподобие проверяется теми же
 * правилами (`looksLikeCardNumber` и соседи). Своей копии правил здесь
 * нет: карта сервиса сходится по контрольной цифре ровно так же, как
 * карта клиента.
 *
 * Ведёт список администратор, выбирает из готового менеджер. Счёт — это
 * решение о том, куда сервис принимает деньги, а не рабочий шаг по
 * заявке; по той же причине менеджер не назначает наценку.
 *
 * Расшифрованный номер наружу не отдаётся вовсе: он собирается в
 * сообщение клиенту внутри операции выдачи. Панель видит счёт
 * последними цифрами и краями адреса — ровно столько, чтобы выбрать
 * нужный из списка.
 */

export interface ServiceAccountView {
  readonly id: string;
  readonly kind: RequisiteKind;
  /** Валюта, которой на этот счёт платят. */
  readonly currencyCode: string;
  readonly bankName: string | null;
  readonly holderName: string | null;
  readonly phone: string | null;
  /** Всё, что видно от номера карты без расшифровки. */
  readonly cardLast4: string | null;
  readonly network: string | null;
  /** Начало и конец адреса кошелька. */
  readonly addressHint: string | null;
  readonly note: string | null;
  readonly isActive: boolean;
  readonly createdAt: Date;
}

/**
 * Поля счёта по способу приёма. Размеченное объединение, а не набор
 * необязательных полей: у кошелька не бывает банка, и общий тип с
 * шестью `optional` разрешал бы записать сеть у карты ещё до того, как
 * откажет база.
 */
export type ServiceAccountFields =
  | {
      readonly kind: 'phone';
      readonly bankName: string;
      readonly holderName: string;
      readonly phone: string;
    }
  | {
      readonly kind: 'card';
      readonly bankName: string;
      readonly holderName: string;
      readonly cardNumber: string;
    }
  | { readonly kind: 'wallet'; readonly network: string; readonly address: string };

export type SaveServiceAccountInput = ServiceAccountFields & {
  readonly currencyCode: string;
  /** Заметка менеджеру: чем этот счёт отличается от соседнего. */
  readonly note?: string | undefined;
};

type ServiceAccountRow = typeof serviceAccounts.$inferSelect;
type ServiceAccountInsert = typeof serviceAccounts.$inferInsert;

function toView(row: ServiceAccountRow): ServiceAccountView {
  return {
    id: row.id,
    kind: row.kind,
    currencyCode: row.currencyCode,
    bankName: row.bankName,
    holderName: row.holderName,
    phone: row.phone,
    cardLast4: row.cardLast4,
    network: row.network,
    addressHint: row.addressHint,
    note: row.note,
    isActive: row.isActive,
    createdAt: row.createdAt,
  };
}

/** Обязательное поле: пустое означало бы счёт, на который не заплатить. */
function required(value: string, subject: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new InvalidInputError(`${subject}: поле обязательно`);
  }
  return trimmed;
}

function plausible(value: string, ok: (value: string) => boolean, complaint: string): string {
  if (!ok(value)) {
    throw new InvalidInputError(complaint);
  }
  return value;
}

/**
 * Строка для записи — со всеми колонками способа, включая чужие
 * пустыми.
 *
 * Пустые нужны правке: счёт, бывший картой и ставший кошельком,
 * сохранил бы банк и последние цифры прежней карты, а ограничение
 * базы отвергло бы такую запись. Перечислять их поимённо надёжнее, чем
 * помнить об этом при каждой правке.
 */
function rowFor(ctx: CoreConfig, input: SaveServiceAccountInput): ServiceAccountInsert {
  const common = {
    currencyCode: required(input.currencyCode, 'Валюта'),
    note: input.note?.trim() || null,
    bankName: null,
    holderName: null,
    phone: null,
    cardLast4: null,
    cardSealed: null,
    network: null,
    addressSealed: null,
    addressHint: null,
  } satisfies Omit<ServiceAccountInsert, 'kind'>;

  switch (input.kind) {
    case 'phone':
      return {
        ...common,
        kind: 'phone',
        bankName: required(input.bankName, 'Банк'),
        holderName: required(input.holderName, 'Получатель'),
        phone: plausible(
          required(input.phone, 'Телефон для перевода'),
          looksLikePhone,
          'Телефон не похож на номер: в нём должно быть от 10 до 15 цифр',
        ),
      };
    case 'card': {
      const cardNumber = plausible(
        required(input.cardNumber, 'Номер карты'),
        looksLikeCardNumber,
        'Номер карты не сходится по контрольной цифре — проверьте, не переставлены ли цифры',
      );
      return {
        ...common,
        kind: 'card',
        bankName: required(input.bankName, 'Банк'),
        holderName: required(input.holderName, 'Получатель'),
        cardLast4: lastFour(cardNumber),
        cardSealed: seal(requirePublicKey(ctx), cardNumber),
      };
    }
    case 'wallet': {
      const network = required(input.network, 'Сеть');
      const address = plausible(
        required(input.address, 'Адрес кошелька'),
        (value) => looksLikeWalletAddress(network, value),
        `Адрес не похож на адрес сети ${network} — проверьте, целиком ли он скопирован`,
      );
      return {
        ...common,
        kind: 'wallet',
        network,
        addressSealed: seal(requirePublicKey(ctx), address),
        addressHint: addressEdges(address),
      };
    }
  }
}

/**
 * Валюта — из справочника, и способ приёма должен ей подходить.
 *
 * Первое: счёт в валюте, которой сервис не торгует, до менеджера всё
 * равно не дойдёт, а обнаружится это на живой заявке. Второе: рубли
 * приходят на карту и по телефону, USDT на кошелёк — карта в USDT это
 * счёт, на который клиент физически не отправит. Правило берётся из
 * доменных типов, то же самое, по которому подбирается реквизит
 * клиента: своей копии здесь заводить нельзя.
 */
async function requireCurrencySuits(
  executor: Executor,
  code: string,
  kind: RequisiteKind,
): Promise<void> {
  const [row] = await executor
    .select({ code: currencies.code, kind: currencies.kind })
    .from(currencies)
    .where(eq(currencies.code, code))
    .limit(1);

  if (!row) {
    throw new InvalidInputError(`Валюта ${code} не заведена в справочнике`);
  }
  if (!requisiteKindSuits(kind, row.kind)) {
    throw new InvalidInputError(
      `На такой счёт ${code} не приходит: выберите другой способ приёма`,
    );
  }
}

export async function addServiceAccount(
  ctx: CoreConfig,
  actor: Actor,
  input: SaveServiceAccountInput,
): Promise<ServiceAccountView> {
  const { staffId } = requireAdmin(actor);
  const values = rowFor(ctx, input);

  return ctx.db.transaction(async (tx) => {
    await requireCurrencySuits(tx, values.currencyCode, values.kind);
    if (values.network) {
      await requireActiveNetwork(tx, values.network);
    }

    const [row] = await tx.insert(serviceAccounts).values(values).returning();
    await recordSettingsChange(tx, staffId, 'service_account', row!.id, {
      added: describeServiceAccount(toView(row!)),
    });
    return toView(row!);
  });
}

/**
 * Правка счёта переписывает поля целиком, а не по одному.
 *
 * Способ приёма меняется вместе с полями: у кошелька не бывает банка, и
 * оставленное от прежнего способа поле — это запись, по которой
 * отправят не туда. Заводить отдельную операцию «сменить способ» смысла
 * нет: правка номера карты и так означает новый шифротекст.
 */
export async function updateServiceAccount(
  ctx: CoreConfig,
  actor: Actor,
  accountId: string,
  input: SaveServiceAccountInput,
): Promise<ServiceAccountView> {
  const { staffId } = requireAdmin(actor);
  const values = rowFor(ctx, input);

  return ctx.db.transaction(async (tx) => {
    await requireCurrencySuits(tx, values.currencyCode, values.kind);
    if (values.network) {
      await requireActiveNetwork(tx, values.network);
    }

    const [row] = await tx
      .update(serviceAccounts)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(serviceAccounts.id, accountId))
      .returning();

    if (!row) {
      throw new NotFoundError('Счёт сервиса не найден');
    }
    await recordSettingsChange(tx, staffId, 'service_account', row.id, {
      changed: describeServiceAccount(toView(row)),
    });
    return toView(row);
  });
}

/**
 * Погасить счёт или включить обратно.
 *
 * Удаления нет: на счёт ссылаются заявки, которым его выдали, и
 * вычеркнуть его из них значило бы стереть, куда клиенту сказали
 * платить.
 */
export async function setServiceAccountActive(
  ctx: CoreConfig,
  actor: Actor,
  accountId: string,
  isActive: boolean,
): Promise<ServiceAccountView> {
  const { staffId } = requireAdmin(actor);

  return ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .update(serviceAccounts)
      .set({ isActive, updatedAt: new Date() })
      .where(eq(serviceAccounts.id, accountId))
      .returning();

    if (!row) {
      throw new NotFoundError('Счёт сервиса не найден');
    }
    await recordSettingsChange(tx, staffId, 'service_account', row.id, { isActive });
    return toView(row);
  });
}

export interface ServiceAccountFilter {
  /** Только счета в этой валюте — ими и платят по заявке. */
  readonly currencyCode?: string | undefined;
  /** Только действующие: выдавать погашенный нельзя. */
  readonly activeOnly?: boolean | undefined;
}

/**
 * Список счетов. Менеджеру он нужен не меньше, чем администратору: из
 * него он и выбирает, что выдать клиенту. Номеров в нём нет — только
 * то, чем счёт узнаётся.
 */
export async function listServiceAccounts(
  ctx: CoreConfig,
  actor: Actor,
  filter: ServiceAccountFilter = {},
): Promise<readonly ServiceAccountView[]> {
  requireStaff(actor);

  const conditions = [
    ...(filter.currencyCode ? [eq(serviceAccounts.currencyCode, filter.currencyCode)] : []),
    ...(filter.activeOnly ? [eq(serviceAccounts.isActive, true)] : []),
  ];

  const rows = await ctx.db
    .select()
    .from(serviceAccounts)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(serviceAccounts.currencyCode), asc(serviceAccounts.createdAt));

  return rows.map(toView);
}

/**
 * Как счёт называется в списке: способ и то, чем он узнаётся.
 *
 * Без расшифровки — этой подписью счёт выбирают, а не платят по нему.
 */
export function describeServiceAccount(view: ServiceAccountView): string {
  switch (view.kind) {
    case 'phone':
      return [view.bankName, view.phone, view.holderName].filter(Boolean).join(' · ');
    case 'card':
      return [view.bankName, `карта •••• ${view.cardLast4 ?? ''}`.trim(), view.holderName]
        .filter(Boolean)
        .join(' · ');
    case 'wallet':
      return [view.network, view.addressHint].filter(Boolean).join(' · ');
  }
}

/**
 * Реквизиты счёта словами — тот текст, который прочитает клиент.
 *
 * Собирается кодом, а не хранится заготовкой: справочник задаёт числа и
 * названия, а формулировки живут там же, где остальные тексты сервиса
 * (docs/adr/0008). У кошелька сеть стоит выше адреса и названа
 * условием, а не подписью: адрес в разных сетях выглядит одинаково, и
 * отправленное не в ту не возвращается.
 */
export function renderPaymentInstructions(
  view: ServiceAccountView,
  secret: string | null,
): string {
  switch (view.kind) {
    case 'phone':
      return [
        `Перевод по номеру телефона: ${view.phone}`,
        `Банк: ${view.bankName}`,
        `Получатель: ${view.holderName}`,
      ].join('\n');
    case 'card':
      return [
        `Перевод на карту: ${secret ?? ''}`,
        `Банк: ${view.bankName}`,
        `Получатель: ${view.holderName}`,
      ].join('\n');
    case 'wallet':
      return [
        `Сеть — проверьте перед отправкой: ${view.network}`,
        `Адрес кошелька: ${secret ?? ''}`,
      ].join('\n');
  }
}

/**
 * Счёт, который выдают по заявке, — с расшифрованным номером внутри
 * готового сообщения.
 *
 * Открытое значение отсюда не возвращается: наружу уходит текст, а не
 * номер. В журнал доступа показ не пишется (docs/adr/0008) — журнал
 * отвечает на вопрос «что сотрудник видел из чужого», а свои счета
 * менеджер видит в каждой заявке.
 *
 * Валюта сверяется с той, которой платит клиент: счёт не в той валюте
 * означал бы перевод, который сервису нечем принять.
 *
 * Строка счёта читается под блокировкой на чтение: администратор гасит
 * счёт из соседнего экрана, и без неё выдача, начавшаяся до гашения,
 * успела бы отправить клиента платить на только что закрытый счёт.
 * Блокировка держится до конца транзакции выдачи — то есть ровно до
 * того момента, когда сообщение клиенту уже собрано.
 */
export async function issueServiceAccount(
  ctx: CoreConfig,
  executor: Executor,
  accountId: string,
  currencyCode: string,
): Promise<{ readonly account: ServiceAccountView; readonly instructions: string }> {
  const [row] = await executor
    .select()
    .from(serviceAccounts)
    .where(eq(serviceAccounts.id, accountId))
    .limit(1)
    .for('share');

  if (!row) {
    throw new NotFoundError('Счёт сервиса не найден');
  }
  if (!row.isActive) {
    throw new InvalidInputError('Этот счёт погашен — выберите действующий');
  }
  // Сеть могла быть погашена после того, как счёт завели: позвать
  // клиента платить в сеть, из которой сервис не заберёт, нельзя. То же
  // правило, по которому кошелёк в такой сети не принимается при подаче
  // заявки (`requireSuitableRequisites`).
  if (row.network) {
    await requireActiveNetwork(executor, row.network);
  }
  if (row.currencyCode !== currencyCode) {
    throw new InvalidInputError(
      `Клиент платит в ${currencyCode}, а счёт заведён в ${row.currencyCode}`,
    );
  }

  const sealed = row.cardSealed ?? row.addressSealed;
  const secret = sealed === null ? null : open(requirePrivateKey(ctx), sealed);
  const view = toView(row);
  return { account: view, instructions: renderPaymentInstructions(view, secret) };
}
