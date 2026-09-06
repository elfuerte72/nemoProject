import { and, desc, eq, isNull, type SQL } from 'drizzle-orm';
import { addressEdges, lastFour, seal } from '@nemo/crypto';
import { clientRequisites, currencies, transferNetworks } from '@nemo/db';
import {
  alipayQrHint,
  looksLikeAlipayAccount,
  looksLikeAlipayQr,
  looksLikeCardNumber,
  looksLikeHolderName,
  looksLikePhone,
  looksLikeThaiAccountNumber,
  looksLikeWalletAddress,
  parsePromptPay,
  promptPayHint,
  PROMPTPAY_ID_LABELS,
  REQUISITE_COMPLAINTS,
  requisiteKindSuitsCurrency,
  type PromptPayIdType,
  type RequisiteKind,
} from '@nemo/types';
import { requireOwner, type Actor, type Owner } from './actor.js';
import { requirePublicKey, type CoreConfig, type Executor } from './context.js';
import { InvalidInputError, NotFoundError } from './errors.js';
import { requireActiveNetwork } from './networks.js';

/**
 * Реквизиты клиента: куда сервис отправляет деньги по исполненной
 * заявке.
 *
 * Запись описывает один способ получения целиком — перевод по номеру
 * телефона, на карту, на криптокошелёк, на тайский банковский счёт, по
 * PromptPay-QR, на Alipay по аккаунту или по QR приёма, — а не набор
 * необязательных полей. Внутри способа обязательно всё: записи, по
 * которой нельзя отправить деньги, не существует, и проверяет это
 * ограничение базы, а не только форма.
 *
 * Номер карты, адрес кошелька, номер счёта и содержимое QR хранятся
 * только зашифрованными, и расшифровать их может лишь админ-панель — в
 * клиентском деплое приватного ключа нет физически (docs/adr/0002).
 * Клиент, единожды сохранив запись, больше не видит её целиком: ему
 * показываются последние четыре цифры карты и счёта, края адреса и
 * хвост идентификатора из QR — их достаточно, чтобы узнать свою запись
 * в списке. QR при этом читается на устройстве клиента, и сюда
 * приходит только строка: картинка телефон не покидает (docs/adr/0012).
 *
 * Записей у клиента столько, сколько ему нужно: карта, тайский счёт и
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
  /** Имя получателя — у тайского счёта, PromptPay и Alipay. */
  readonly holderName: string | null;
  /** Всё, что клиент видит от номера тайского счёта. */
  readonly accountLast4: string | null;
  /** Хвост идентификатора из QR — PromptPay или Alipay. */
  readonly qrHint: string | null;
  /**
   * К чему привязан получатель внутри PromptPay-QR. Доезжает до экрана,
   * потому что от него зависит способ выдачи, а с ним сетка: показанная
   * цена обязана совпасть с той, по которой заявка уйдёт.
   */
  readonly promptpayIdType: PromptPayIdType | null;
  /** Телефон или e-mail аккаунта Alipay — открыт, как телефон. */
  readonly alipayAccount: string | null;
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
  | { readonly kind: 'wallet'; readonly network: string; readonly address: string }
  | {
      readonly kind: 'account';
      readonly bankName: string;
      readonly accountNumber: string;
      readonly holderName: string;
    }
  | { readonly kind: 'promptpay'; readonly qr: string; readonly holderName: string }
  | { readonly kind: 'alipay'; readonly account: string; readonly holderName: string }
  | { readonly kind: 'alipay_qr'; readonly qr: string; readonly holderName: string };

type RequisitesRow = typeof clientRequisites.$inferSelect;

/**
 * Записи владельца — клиента или мерчанта (docs/adr/0017).
 *
 * Одним условием на оба вида: список, форма и проверка при подаче
 * спрашивают одно и то же — «моё ли это», — и три копии этого вопроса
 * разошлись бы на первой правке.
 */
export function requisitesOf(owner: Owner): SQL {
  return owner.kind === 'client'
    ? eq(clientRequisites.clientId, owner.clientId)
    : eq(clientRequisites.merchantId, owner.merchantId);
}

/** Владелец в виде полей строки: чем заполняется вставка. */
export function ownerColumns(
  owner: Owner,
): { clientId: bigint; merchantId?: undefined } | { merchantId: string; clientId?: undefined } {
  return owner.kind === 'client'
    ? { clientId: owner.clientId }
    : { merchantId: owner.merchantId };
}

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
    holderName: row.holderName,
    accountLast4: row.accountLast4,
    qrHint: row.qrHint,
    promptpayIdType: row.promptpayIdType,
    alipayAccount: row.alipayAccount,
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
  accountLast4: string | null;
  qrHint: string | null;
  promptpayIdType: PromptPayIdType | null;
  alipayAccount: string | null;
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
    case 'account':
      return [view.bankName, `счёт •••• ${view.accountLast4 ?? ''}`.trim()]
        .filter(Boolean)
        .join(' · ');
    case 'promptpay':
      return [
        'PromptPay',
        `${PROMPTPAY_ID_LABELS[view.promptpayIdType ?? 'phone']} ${view.qrHint ?? ''}`.trim(),
      ].join(' · ');
    case 'alipay':
      return ['Alipay', view.alipayAccount].filter(Boolean).join(' · ');
    case 'alipay_qr':
      return ['Alipay', `QR ${view.qrHint ?? ''}`.trim()].join(' · ');
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

/**
 * Проверка поля на правдоподобие — там же, где проверка на пустоту.
 *
 * Непустая строка ещё не реквизит: недобитый адрес, номер с двумя
 * переставленными цифрами и телефон, вписанный в поле карты, проходят её
 * все. Отправленный по такому реквизиту перевод не возвращается, и
 * ловить опечатку после отправки поздно.
 *
 * Проверяет операция, а не только форма: записи заводятся не одним
 * экраном, и правило, живущее лишь в разметке, обходится любым другим
 * путём.
 */
function plausible(value: string, ok: (value: string) => boolean, complaint: string): string {
  if (!ok(value)) {
    throw new InvalidInputError(complaint);
  }
  return value;
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

/** Имя получателя — обязательно у всех родов, где менеджер его сверяет. */
function holderName(value: string): string {
  return plausible(
    required(value, 'Имя получателя'),
    looksLikeHolderName,
    REQUISITE_COMPLAINTS.holderName,
  );
}

/**
 * Строка для вставки. Собирается до транзакции, потому что шифрование —
 * работа процессора, а не базы, и держать ради него открытую транзакцию
 * незачем.
 */
type RequisitesInsert = typeof clientRequisites.$inferInsert;

function rowFor(
  ctx: CoreConfig,
  owner: Owner,
  input: SaveRequisitesInput,
): RequisitesInsert {
  const belongsTo = ownerColumns(owner);
  switch (input.kind) {
    case 'phone':
      return {
        ...belongsTo,
        kind: 'phone',
        bankName: required(input.bankName, 'Банк'),
        // Телефон остаётся открытым: по нему менеджер и отправляет
        // перевод, а прячется то, чем можно распорядиться напрямую.
        phone: plausible(
          required(input.phone, 'Телефон для перевода'),
          looksLikePhone,
          REQUISITE_COMPLAINTS.phone,
        ),
      };
    case 'card': {
      const card = sealCard(
        ctx,
        plausible(
          required(input.cardNumber, 'Номер карты'),
          looksLikeCardNumber,
          REQUISITE_COMPLAINTS.card,
        ),
      );
      return {
        ...belongsTo,
        kind: 'card',
        bankName: required(input.bankName, 'Банк'),
        cardLast4: card.last4,
        cardSealed: card.sealed,
      };
    }
    case 'wallet': {
      const network = required(input.network, 'Сеть');
      const address = plausible(
        required(input.address, 'Адрес кошелька'),
        (value) => looksLikeWalletAddress(network, value),
        REQUISITE_COMPLAINTS.walletAddress(network),
      );
      return {
        ...belongsTo,
        kind: 'wallet',
        network,
        addressSealed: seal(requirePublicKey(ctx), address),
        addressHint: addressEdges(address),
      };
    }
    case 'account': {
      // Шифруются цифры без разделителей: в приложении банка номер
      // напечатан с дефисами, а набирают его без них.
      const number = plausible(
        required(input.accountNumber, 'Номер счёта'),
        looksLikeThaiAccountNumber,
        REQUISITE_COMPLAINTS.thaiAccount,
      ).replace(/\D/g, '');
      return {
        ...belongsTo,
        kind: 'account',
        bankName: required(input.bankName, 'Банк'),
        holderName: holderName(input.holderName),
        accountLast4: lastFour(number),
        accountSealed: seal(requirePublicKey(ctx), number),
      };
    }
    case 'promptpay': {
      const qr = required(input.qr, 'QR');
      const parsed = parsePromptPay(qr);
      if (!parsed.ok) {
        throw new InvalidInputError(parsed.complaint);
      }
      return {
        ...belongsTo,
        kind: 'promptpay',
        holderName: holderName(input.holderName),
        qrSealed: seal(requirePublicKey(ctx), qr),
        qrHint: promptPayHint(parsed.id),
        promptpayIdType: parsed.idType,
      };
    }
    case 'alipay':
      return {
        ...belongsTo,
        kind: 'alipay',
        holderName: holderName(input.holderName),
        // Аккаунт остаётся открытым, как телефон: по нему менеджер и
        // находит получателя в Alipay.
        alipayAccount: plausible(
          required(input.account, 'Аккаунт Alipay'),
          looksLikeAlipayAccount,
          REQUISITE_COMPLAINTS.alipayAccount,
        ),
      };
    case 'alipay_qr': {
      const qr = plausible(
        required(input.qr, 'QR'),
        looksLikeAlipayQr,
        REQUISITE_COMPLAINTS.alipayQr,
      );
      return {
        ...belongsTo,
        kind: 'alipay_qr',
        holderName: holderName(input.holderName),
        qrSealed: seal(requirePublicKey(ctx), qr),
        qrHint: alipayQrHint(qr),
      };
    }
  }
}

export async function saveRequisites(
  ctx: CoreConfig,
  actor: Actor,
  input: SaveRequisitesInput,
): Promise<RequisitesView> {
  return saveRequisitesFor(ctx, requireOwner(actor), input);
}

/**
 * То же, но владелец назван прямо: так запись заводит подача заявки,
 * получившая реквизиты в теле запроса. Проверки при этом те же —
 * правдоподобие и живая сеть, — иначе путь через API оказался бы
 * слабее пути через форму.
 */
export async function saveRequisitesFor(
  ctx: CoreConfig,
  owner: Owner,
  input: SaveRequisitesInput,
  options: { archived?: boolean } = {},
): Promise<RequisitesView> {
  const values = rowFor(ctx, owner, input);

  return ctx.db.transaction(async (tx) => {
    // Сеть — из общего справочника: выключенную администратором
    // сохранять незачем, по ней всё равно не отправят.
    if (values.network) {
      await requireActiveNetwork(tx, values.network);
    }

    // Прежние записи остаются: карта, телефон и кошелёк — разные
    // способы получения, а не смена одного другим.
    const [row] = await tx
      .insert(clientRequisites)
      .values(options.archived ? { ...values, archivedAt: new Date() } : values)
      .returning();
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
  const owner = requireOwner(actor);
  const rows = await ctx.db
    .select({ requisites: clientRequisites, networkIsActive: transferNetworks.isActive })
    .from(clientRequisites)
    .leftJoin(transferNetworks, eq(transferNetworks.code, clientRequisites.network))
    .where(and(requisitesOf(owner), isNull(clientRequisites.archivedAt)))
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
  const owner = requireOwner(actor);
  const [row] = await ctx.db
    .update(clientRequisites)
    .set({ archivedAt: new Date() })
    .where(
      and(
        eq(clientRequisites.id, requisitesId),
        requisitesOf(owner),
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
 * телефону, USDT на кошелёк, баты на тайский счёт и PromptPay, юани на
 * Alipay, — иначе менеджер получил бы заявку, по которой нечего
 * исполнять. Какой род подходит валюте, говорит таблица в доменных
 * типах; у валюты без родов не подходит ничего.
 */
export async function requireSuitableRequisites(
  executor: Executor,
  owner: Owner,
  requisitesId: string,
  toCode: string,
  options: { allowArchived?: boolean } = {},
): Promise<void> {
  const [row] = await executor
    .select({ kind: clientRequisites.kind, network: clientRequisites.network })
    .from(clientRequisites)
    .where(
      and(
        eq(clientRequisites.id, requisitesId),
        requisitesOf(owner),
        // Запись, заведённая подачей по API, архивируется сразу: список
        // получателей мерчанта не должен расти на каждую заявку. Своей
        // же заявке она подходит — её только что и завели.
        options.allowArchived ? undefined : isNull(clientRequisites.archivedAt),
      ),
    )
    .limit(1);

  if (!row) {
    throw new NotFoundError('Реквизиты не найдены');
  }

  const [currency] = await executor
    .select({ code: currencies.code })
    .from(currencies)
    .where(eq(currencies.code, toCode))
    .limit(1);

  if (!currency) {
    throw new NotFoundError(`Валюта ${toCode} недоступна`);
  }
  if (!requisiteKindSuitsCurrency(row.kind, currency.code)) {
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
