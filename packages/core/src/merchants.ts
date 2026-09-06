import { createHash, randomBytes } from 'node:crypto';
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { hashPassword, verifyPassword } from '@nemo/crypto';
import { merchantEmailTokens, merchants } from '@nemo/db';
import {
  looksLikeEmail,
  looksLikePassword,
  looksLikePhone,
  looksLikeWebsite,
  MERCHANT_COMPLAINTS,
  REQUISITE_COMPLAINTS,
  type MerchantStatus,
} from '@nemo/types';
import {
  requireAdmin,
  requireMerchant,
  requireStaff,
  type Actor,
  type Owner,
} from './actor.js';
import type { CoreConfig, Executor } from './context.js';
import {
  ConflictError,
  ForbiddenError,
  InvalidInputError,
  NotFoundError,
  TransitionNotAllowedError,
} from './errors.js';
import {
  toClient,
  toMerchant,
  type Notification,
  type Recipient,
} from './notifications.js';
import { likePattern, merchantNameLike } from './search.js';
import { recordSettingsChange } from './settings-audit.js';

/**
 * Мерчант — бизнес, который пользуется сервисом как услугой обмена
 * (docs/adr/0017).
 *
 * Второй владелец заявки рядом с клиентом: подаёт её от своего имени,
 * платит сам и называет, куда отправить деньги. Личность у него не
 * Telegram, а почта с паролем — отсюда всё, чего у клиента не бывает:
 * анкета, подтверждение адреса, поколение сессий, ссылки из писем.
 *
 * Анкету рассматривает администратор, и это не формальность: одобрение
 * открывает право создавать обязательства сервиса по курсу — решение
 * того же рода, что наценка, и менеджеру оно не отдаётся.
 *
 * Переписки, баллов и рефералки у мерчанта нет: его отношения с
 * сервисом описаны договором вне системы, а вопросы он задаёт в
 * поддержку по ссылке из кабинета.
 */

/** Сколько живёт ссылка подтверждения почты: письмо ищут не сразу. */
const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
/**
 * Сколько живёт ссылка сброса пароля. Час, а не сутки: этой ссылкой
 * входят, и оставленное в чужом почтовом ящике письмо суточной давности
 * открывало бы кабинет.
 */
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

type MerchantRow = typeof merchants.$inferSelect;

/**
 * Мерчант глазами сотрудника и его собственного кабинета. Хеша пароля
 * здесь нет и быть не может: наружу он не уходит ни разу.
 */
export interface MerchantView {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly site: string | null;
  readonly contactName: string;
  readonly phone: string;
  readonly about: string | null;
  readonly status: MerchantStatus;
  readonly rejectionReason: string | null;
  readonly emailVerifiedAt: Date | null;
  readonly approvedAt: Date | null;
  readonly disabledAt: Date | null;
  /** Требует ли мерчант подписи HMAC у своих запросов к API. */
  readonly signatureRequired: boolean;
  readonly createdAt: Date;
}

export interface RegisterMerchantInput {
  readonly email: string;
  readonly password: string;
  readonly name: string;
  readonly site?: string | undefined;
  readonly contactName: string;
  readonly phone: string;
  readonly about?: string | undefined;
}

export interface MerchantResult {
  readonly merchant: MerchantView;
  readonly notifications: readonly Notification[];
}

/**
 * Сессия кабинета: кто вошёл и каким поколением. Поколение едет в куку
 * и сверяется при каждом запросе — смена пароля обрывает все сессии
 * разом, не перебирая их.
 */
export interface MerchantSession {
  readonly merchantId: string;
  readonly sessionEpoch: number;
  readonly name: string;
  readonly status: MerchantStatus;
}

export interface MerchantFilter {
  readonly status?: MerchantStatus | undefined;
  /** Название или почта: по ним мерчанта и ищут. */
  readonly query?: string | undefined;
}

function toView(row: MerchantRow): MerchantView {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    site: row.site,
    contactName: row.contactName,
    phone: row.phone,
    about: row.about,
    status: row.status,
    rejectionReason: row.rejectionReason,
    emailVerifiedAt: row.emailVerifiedAt,
    approvedAt: row.approvedAt,
    disabledAt: row.disabledAt,
    signatureRequired: row.signatureRequired,
    createdAt: row.createdAt,
  };
}

/**
 * Почта приводится к нижнему регистру один раз и везде: «Shop@…» и
 * «shop@…» — один ящик, и два аккаунта на него означали бы, что письмо
 * о втором приходит владельцу первого.
 */
function normalizeEmail(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!looksLikeEmail(trimmed)) {
    throw new InvalidInputError(MERCHANT_COMPLAINTS.email);
  }
  return trimmed;
}

function required(value: string, subject: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new InvalidInputError(`${subject}: поле обязательно`);
  }
  return trimmed;
}

/**
 * Ключ из письма: наружу уходит сам, в базу — его хеш.
 *
 * Письмо доходит до почтового ящика, а тот бывает чужим; но база,
 * утёкшая целиком, не должна открывать ни одного кабинета — по хешу
 * ссылку не собрать. Соль не нужна: ключ и так случаен на 256 бит,
 * словарём его не взять.
 */
function issueToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Анкета мерчанта: заводится им самим на сайте кабинета.
 *
 * Уведомление о подтверждении почты она возвращает, но доставки писем у
 * сервиса пока нет — пакет `@nemo/email` идёт своим тикетом. До него
 * ключ подтверждения виден только тому, кто позвал операцию: так его и
 * забирает сид разработки. Записано в `backlog.md`.
 */
export async function registerMerchant(
  ctx: CoreConfig,
  input: RegisterMerchantInput,
): Promise<MerchantResult> {
  const email = normalizeEmail(input.email);
  if (!looksLikePassword(input.password)) {
    throw new InvalidInputError(MERCHANT_COMPLAINTS.password);
  }
  const name = required(input.name, 'Название');
  const contactName = required(input.contactName, 'Контактное лицо');
  const phone = required(input.phone, 'Телефон');
  if (!looksLikePhone(phone)) {
    throw new InvalidInputError(REQUISITE_COMPLAINTS.phone);
  }
  /*
   * Сайт панель рисует ссылкой, а анкету заводит кто угодно снаружи:
   * «javascript:» в этом поле — клик администратора в контексте панели,
   * а строка без схемы уводит по относительному адресу внутрь неё же.
   */
  const site = input.site?.trim() || null;
  if (site !== null && !looksLikeWebsite(site)) {
    throw new InvalidInputError(MERCHANT_COMPLAINTS.site);
  }

  // Хеш считается до транзакции: argon2id намеренно занимает десятки
  // миллисекунд, и держать ради него открытую транзакцию незачем.
  const passwordHash = await hashPassword(input.password);
  const { token, tokenHash } = issueToken();

  return ctx.db.transaction(async (tx) => {
    /*
     * Занятость почты сторожит индекс, а не проверка перед вставкой:
     * между «занята ли» и «пишу» вклинивается вторая вкладка, и обе
     * проверки проходят. Пустой ответ здесь — это «кто-то уже завёл», и
     * говорится об этом теми же словами, что и в обычном отказе.
     */
    const [row] = await tx
      .insert(merchants)
      .values({
        email,
        passwordHash,
        name,
        site,
        contactName,
        phone,
        about: input.about?.trim() || null,
      })
      .onConflictDoNothing({ target: merchants.email })
      .returning();
    if (row === undefined) {
      throw new ConflictError(MERCHANT_COMPLAINTS.emailTaken);
    }

    await tx.insert(merchantEmailTokens).values({
      merchantId: row.id,
      purpose: 'email_verification',
      tokenHash,
      expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS),
    });

    return {
      merchant: toView(row),
      notifications: [{ kind: 'merchant-email-verification', to: toMerchant(row), token }],
    };
  });
}

/**
 * Ключ из письма, годный к употреблению: не просроченный и ни разу не
 * использованный. Отметка ставится в той же транзакции, что и само
 * действие: без неё ссылка сбрасывала бы пароль столько раз, сколько по
 * ней перешли.
 */
async function takeToken(
  tx: Executor,
  token: string,
  purpose: 'email_verification' | 'password_reset',
): Promise<string> {
  const [row] = await tx
    .select()
    .from(merchantEmailTokens)
    .where(
      and(
        eq(merchantEmailTokens.tokenHash, hashToken(token)),
        eq(merchantEmailTokens.purpose, purpose),
      ),
    )
    .limit(1)
    .for('update');

  if (!row || row.usedAt !== null || row.expiresAt.getTime() <= Date.now()) {
    throw new NotFoundError('Ссылка не подходит: она уже использована или устарела');
  }

  await tx
    .update(merchantEmailTokens)
    .set({ usedAt: new Date() })
    .where(eq(merchantEmailTokens.id, row.id));
  return row.merchantId;
}

export async function verifyMerchantEmail(
  ctx: CoreConfig,
  token: string,
): Promise<MerchantView> {
  return ctx.db.transaction(async (tx) => {
    const merchantId = await takeToken(tx, token, 'email_verification');
    const [row] = await tx
      .update(merchants)
      .set({ emailVerifiedAt: new Date() })
      .where(eq(merchants.id, merchantId))
      .returning();
    return toView(row!);
  });
}

/**
 * Вход по почте и паролю.
 *
 * Отказ один на «нет такой почты» и «пароль не тот»: разные ответы
 * говорили бы подбирающему, на каком шаге он остановился. Состояние
 * мерчанта вход не проверяет вовсе — отклонённый и отключённый входят
 * и видят, что с ними, а открытые заявки доходят до конца.
 *
 * Число попыток здесь не считается: счётчик по почте и по адресу живёт
 * в приложении кабинета рядом с лимитами API — это свойство канала, а
 * не правило предметной области, и в базе он стоил бы записи на каждую
 * неудачную попытку.
 */
export async function beginMerchantLogin(
  ctx: CoreConfig,
  input: { email: string; password: string },
): Promise<MerchantSession> {
  const email = input.email.trim().toLowerCase();
  const [row] = await ctx.db
    .select()
    .from(merchants)
    .where(eq(merchants.email, email))
    .limit(1);

  // Пароль проверяется и тогда, когда мерчанта нет: иначе ответ по
  // незнакомой почте приходил бы заметно быстрее, и перебор шёл бы по
  // времени ответа.
  const hash = row?.passwordHash ?? (await unknownMerchantHash());
  const ok = await verifyPassword(hash, input.password);
  if (!row || !ok) {
    throw new ForbiddenError(MERCHANT_COMPLAINTS.credentials);
  }
  return toSession(row);
}

/**
 * Хеш, к которому не подходит ни один пароль: он нужен только затем,
 * чтобы вход по незнакомой почте занимал столько же времени, сколько по
 * знакомой. Считается однажды на процесс — argon2id намеренно дорог.
 */
let absentHash: Promise<string> | undefined;

function unknownMerchantHash(): Promise<string> {
  absentHash ??= hashPassword(randomBytes(32).toString('base64url'));
  return absentHash;
}

function toSession(row: MerchantRow): MerchantSession {
  return {
    merchantId: row.id,
    sessionEpoch: row.sessionEpoch,
    name: row.name,
    status: row.status,
  };
}

/**
 * Сессия по куке: тот ли это мерчант и то ли поколение.
 *
 * Поколение сверяется здесь, а не в приложении: правило «смена пароля
 * обрывает сессии» должно действовать при любом пути к кабинету, а
 * маршрутов у него будет много.
 */
export async function getMerchantSession(
  ctx: CoreConfig,
  merchantId: string,
  sessionEpoch: number,
): Promise<MerchantSession> {
  const [row] = await ctx.db
    .select()
    .from(merchants)
    .where(eq(merchants.id, merchantId))
    .limit(1);

  if (!row || row.sessionEpoch !== sessionEpoch) {
    throw new ForbiddenError('Сессия больше не действует: войдите заново');
  }
  return toSession(row);
}

/**
 * Мерчант, которому позволено действовать: одобренный и не отключённый.
 *
 * Ключи API отключённого перестают работать в ту же секунду, а сам он
 * в кабинет входит: открытые заявки он должен видеть до конца — деньги
 * по ним уже отправлены.
 */
export async function requireActiveMerchant(
  executor: Executor,
  merchantId: string,
): Promise<MerchantRow> {
  const [row] = await executor
    .select()
    .from(merchants)
    .where(eq(merchants.id, merchantId))
    .limit(1);

  if (!row) {
    throw new NotFoundError('Мерчант не найден');
  }
  if (row.status !== 'active') {
    throw new ForbiddenError(
      row.status === 'pending'
        ? 'Анкета ещё на рассмотрении: подать заявку можно после одобрения'
        : 'Доступ к обмену закрыт: напишите в поддержку',
    );
  }
  return row;
}

/**
 * Кому уходит уведомление о заявке этого владельца.
 *
 * Клиенту — в Telegram, и адрес у него уже есть; мерчанту — письмом, а
 * адрес почты лежит в его строке, и доставщик писем в базу не ходит.
 * Один запрос на переход заявки: дешевле, чем хранить копию почты в
 * каждой заявке и разбираться, какая из них свежая.
 */
export async function recipientOf(executor: Executor, owner: Owner): Promise<Recipient> {
  if (owner.kind === 'client') {
    return toClient(owner.clientId);
  }
  const [row] = await executor
    .select({ id: merchants.id, email: merchants.email })
    .from(merchants)
    .where(eq(merchants.id, owner.merchantId))
    .limit(1);
  if (!row) {
    throw new NotFoundError('Мерчант не найден');
  }
  return toMerchant(row);
}

/**
 * То же для пачки строк: одним запросом на прогон планировщика вместо
 * запроса на заявку. Отдаёт почту по идентификатору мерчанта; клиентские
 * строки в неё не заглядывают вовсе.
 */
export async function merchantRecipients(
  executor: Executor,
  ids: readonly (string | null)[],
): Promise<ReadonlyMap<string, Recipient>> {
  const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
  if (wanted.length === 0) return new Map();

  const rows = await executor
    .select({ id: merchants.id, email: merchants.email })
    .from(merchants)
    .where(inArray(merchants.id, wanted));
  return new Map(rows.map((row) => [row.id, toMerchant(row)]));
}

/** Адресат строки по заранее прочитанной пачке мерчантов. */
export function recipientFor(
  row: { clientId: bigint | null; merchantId: string | null },
  known: ReadonlyMap<string, Recipient>,
): Recipient {
  if (row.clientId !== null) return toClient(row.clientId);
  const found = row.merchantId === null ? undefined : known.get(row.merchantId);
  if (!found) {
    throw new NotFoundError('Мерчант не найден');
  }
  return found;
}

export async function changeMerchantPassword(
  ctx: CoreConfig,
  actor: Actor,
  input: { currentPassword: string; newPassword: string },
): Promise<void> {
  const merchantId = requireMerchant(actor);
  if (!looksLikePassword(input.newPassword)) {
    throw new InvalidInputError(MERCHANT_COMPLAINTS.password);
  }

  const [row] = await ctx.db
    .select()
    .from(merchants)
    .where(eq(merchants.id, merchantId))
    .limit(1);
  if (!row || !(await verifyPassword(row.passwordHash, input.currentPassword))) {
    throw new ForbiddenError(MERCHANT_COMPLAINTS.credentials);
  }

  await setPassword(ctx, merchantId, input.newPassword);
}

/**
 * Новый пароль и новое поколение — вместе. Порознь это два состояния,
 * между которыми старая кука ещё подходит к новому паролю.
 */
async function setPassword(
  ctx: CoreConfig,
  merchantId: string,
  password: string,
): Promise<void> {
  const passwordHash = await hashPassword(password);
  await ctx.db
    .update(merchants)
    .set({ passwordHash, sessionEpoch: nextEpoch() })
    .where(eq(merchants.id, merchantId));
}

/**
 * Поколение считает база, а не код: два запроса «прочитать и записать»
 * с разных вкладок дали бы одно и то же число, и одна из смен пароля
 * не оборвала бы ничего.
 */
function nextEpoch(): SQL<number> {
  return sql`${merchants.sessionEpoch} + 1`;
}

export async function requestMerchantPasswordReset(
  ctx: CoreConfig,
  email: string,
): Promise<{ notifications: readonly Notification[] }> {
  const [row] = await ctx.db
    .select()
    .from(merchants)
    .where(eq(merchants.email, email.trim().toLowerCase()))
    .limit(1);

  // Незнакомая почта отвечает так же, как знакомая: иначе форма
  // «забыли пароль» стала бы способом перебирать, кто здесь есть.
  if (!row) {
    return { notifications: [] };
  }

  const { token, tokenHash } = issueToken();
  await ctx.db.insert(merchantEmailTokens).values({
    merchantId: row.id,
    purpose: 'password_reset',
    tokenHash,
    expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
  });

  return {
    notifications: [{ kind: 'merchant-password-reset', to: toMerchant(row), token }],
  };
}

export async function resetMerchantPassword(
  ctx: CoreConfig,
  token: string,
  password: string,
): Promise<void> {
  if (!looksLikePassword(password)) {
    throw new InvalidInputError(MERCHANT_COMPLAINTS.password);
  }
  const passwordHash = await hashPassword(password);

  await ctx.db.transaction(async (tx) => {
    const merchantId = await takeToken(tx, token, 'password_reset');
    await tx
      .update(merchants)
      .set({ passwordHash, sessionEpoch: nextEpoch() })
      .where(eq(merchants.id, merchantId));
  });
}

export async function listMerchants(
  ctx: CoreConfig,
  actor: Actor,
  filter: MerchantFilter = {},
): Promise<readonly MerchantView[]> {
  requireStaff(actor);
  const rows = await ctx.db
    .select()
    .from(merchants)
    .where(merchantConditions(filter))
    .orderBy(desc(merchants.createdAt), asc(merchants.id));
  return rows.map(toView);
}

export async function countMerchants(
  ctx: CoreConfig,
  actor: Actor,
  filter: MerchantFilter = {},
): Promise<number> {
  requireStaff(actor);
  const [row] = await ctx.db
    .select({ total: count() })
    .from(merchants)
    .where(merchantConditions(filter));
  return row?.total ?? 0;
}

/**
 * Чем сужается список.
 *
 * Неподтверждённая почта из списка ждущих выпадает: рассматривать
 * анкету от ящика, до которого письмо не дошло, значит рассматривать
 * неизвестно чью. В остальных состояниях подтверждение уже позади.
 */
function merchantConditions(filter: MerchantFilter): SQL | undefined {
  const conditions: SQL[] = [];
  if (filter.status) {
    conditions.push(eq(merchants.status, filter.status));
    if (filter.status === 'pending') {
      conditions.push(isNotNull(merchants.emailVerifiedAt));
    }
  }
  if (filter.query?.trim()) {
    // Знаки шаблона обезвреживаются: «%» в поле поиска — это мерчант с
    // процентом в названии, а не «покажи всех».
    const like = likePattern(filter.query);
    conditions.push(or(merchantNameLike(like), ilike(merchants.email, like))!);
  }
  return conditions.length === 0 ? undefined : and(...conditions);
}

export async function getMerchantCard(
  ctx: CoreConfig,
  actor: Actor,
  merchantId: string,
): Promise<MerchantView> {
  requireStaff(actor);
  const [row] = await ctx.db
    .select()
    .from(merchants)
    .where(eq(merchants.id, merchantId))
    .limit(1);
  if (!row) {
    throw new NotFoundError('Мерчант не найден');
  }
  return toView(row);
}

export async function approveMerchant(
  ctx: CoreConfig,
  actor: Actor,
  merchantId: string,
): Promise<MerchantResult> {
  const { staffId } = requireAdmin(actor);

  return ctx.db.transaction(async (tx) => {
    const row = await lockMerchant(tx, merchantId);
    if (row.emailVerifiedAt === null) {
      throw new InvalidInputError(
        'Почта не подтверждена: анкета от неподтверждённого адреса неизвестно чья',
      );
    }
    if (row.status !== 'pending' && row.status !== 'rejected') {
      throw new TransitionNotAllowedError(
        'Одобрять нечего: мерчант уже активен или отключён',
      );
    }

    const [updated] = await tx
      .update(merchants)
      .set({ status: 'active', approvedAt: new Date(), rejectionReason: null })
      .where(eq(merchants.id, merchantId))
      .returning();

    await recordSettingsChange(tx, staffId, 'merchant', merchantId, { status: 'active' });
    return {
      merchant: toView(updated!),
      notifications: [
        { kind: 'merchant-application-decided', to: toMerchant(updated!) },
      ],
    };
  });
}

export async function rejectMerchant(
  ctx: CoreConfig,
  actor: Actor,
  merchantId: string,
  input: { reason?: string | undefined } = {},
): Promise<MerchantResult> {
  const { staffId } = requireAdmin(actor);
  const reason = input.reason?.trim();
  // Отказ без слов оставляет мерчанта гадать, что переделать, и
  // приводит его в поддержку с тем же вопросом.
  if (!reason) {
    throw new InvalidInputError('Укажите причину отказа');
  }

  return ctx.db.transaction(async (tx) => {
    const row = await lockMerchant(tx, merchantId);
    if (row.status !== 'pending') {
      throw new TransitionNotAllowedError(
        'Отклонить можно анкету на рассмотрении: одобренного мерчанта отключают',
      );
    }

    const [updated] = await tx
      .update(merchants)
      .set({ status: 'rejected', rejectionReason: reason })
      .where(eq(merchants.id, merchantId))
      .returning();

    await recordSettingsChange(tx, staffId, 'merchant', merchantId, {
      status: 'rejected',
      reason,
    });
    return {
      merchant: toView(updated!),
      notifications: [
        {
          kind: 'merchant-application-decided',
          to: toMerchant(updated!),
          rejectionReason: reason,
        },
      ],
    };
  });
}

/**
 * Отключить и включить обратно.
 *
 * Отдельно от одобрения, хотя состояние то же: одобрение — это решение
 * по анкете, а отключение — рабочее состояние, и путать их нельзя.
 * Письма об отключении нет: это не решение по анкете, а мера, о
 * которой мерчанту говорит владелец, — но ключи API перестают работать
 * в ту же секунду.
 */
export async function setMerchantActive(
  ctx: CoreConfig,
  actor: Actor,
  merchantId: string,
  isActive: boolean,
): Promise<MerchantView> {
  const { staffId } = requireAdmin(actor);

  return ctx.db.transaction(async (tx) => {
    const row = await lockMerchant(tx, merchantId);
    const expected = isActive ? 'disabled' : 'active';
    if (row.status !== expected) {
      throw new TransitionNotAllowedError(
        isActive
          ? 'Включить можно отключённого мерчанта'
          : 'Отключить можно активного мерчанта',
      );
    }

    const [updated] = await tx
      .update(merchants)
      .set(
        isActive
          ? { status: 'active', disabledAt: null }
          : { status: 'disabled', disabledAt: new Date() },
      )
      .where(eq(merchants.id, merchantId))
      .returning();

    await recordSettingsChange(tx, staffId, 'merchant', merchantId, {
      status: updated!.status,
    });
    return toView(updated!);
  });
}

async function lockMerchant(tx: Executor, merchantId: string): Promise<MerchantRow> {
  const [row] = await tx
    .select()
    .from(merchants)
    .where(eq(merchants.id, merchantId))
    .limit(1)
    .for('update');
  if (!row) {
    throw new NotFoundError('Мерчант не найден');
  }
  return row;
}
