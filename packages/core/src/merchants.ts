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
  isNull,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { hashPassword, verifyPassword } from '@nemo/crypto';
import { merchantEmailTokens, merchants, merchantUsers } from '@nemo/db';
import {
  looksLikeEmail,
  looksLikePassword,
  looksLikePhone,
  looksLikeWebsite,
  MERCHANT_COMPLAINTS,
  MERCHANT_STAFF_COMPLAINTS,
  REQUISITE_COMPLAINTS,
  type MerchantStatus,
  type MerchantUserRole,
} from '@nemo/types';
import {
  requireAdmin,
  requireMerchant,
  requireMerchantAbility,
  requireMerchantUser,
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
import { readServiceSettings } from './settings.js';
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
type MerchantUserRow = typeof merchantUsers.$inferSelect;

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
 * и сверяется при каждом запросе — смена пароля и закрытие доступа
 * обрывают все сессии человека разом, не перебирая их.
 */
export interface MerchantSession {
  readonly merchantId: string;
  /** Кто именно вошёл: людей у мерчанта несколько (тикет 17). */
  readonly userId: string;
  readonly sessionEpoch: number;
  readonly role: MerchantUserRole;
  /** Название организации — его кабинет ставит в шапку. */
  readonly name: string;
  /** Имя вошедшего: им подписан список заявок и меню кабинета. */
  readonly userName: string;
  readonly status: MerchantStatus;
  /**
   * Ждут ли от вошедшего подтверждения адреса. Состояние «на
   * рассмотрении» бывает по двум причинам — письмо не открыто или
   * анкета ещё не рассмотрена, — и говорить о них одними словами
   * нельзя: в первом случае от мерчанта ждут действия, во втором
   * ждать должен он.
   *
   * У всех, кроме владельца, здесь всегда «нет»: их адрес не
   * подтверждается вовсе — пароль им задаёт владелец и передаёт лично.
   */
  readonly needsEmailVerification: boolean;
}

/** Человек у мерчанта глазами кабинета: без хеша пароля, разумеется. */
export interface MerchantUserView {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly role: MerchantUserRole;
  readonly emailVerifiedAt: Date | null;
  readonly disabledAt: Date | null;
  readonly createdAt: Date;
}

export interface MerchantFilter {
  readonly status?: MerchantStatus | undefined;
  /** Название или почта: по ним мерчанта и ищут. */
  readonly query?: string | undefined;
}

/**
 * Мерчант наружу — вместе с владельцем: почта и подтверждение адреса
 * принадлежат человеку, а спрашивают о них у организации («на какой
 * адрес писать этому мерчанту»). Владелец у мерчанта есть всегда: его
 * заводит та же транзакция, что и анкету.
 */
function toView(row: MerchantRow, owner: OwnerColumns): MerchantView {
  return {
    id: row.id,
    email: owner.email,
    name: row.name,
    site: row.site,
    contactName: row.contactName,
    phone: row.phone,
    about: row.about,
    status: row.status,
    rejectionReason: row.rejectionReason,
    emailVerifiedAt: owner.emailVerifiedAt,
    approvedAt: row.approvedAt,
    disabledAt: row.disabledAt,
    signatureRequired: row.signatureRequired,
    createdAt: row.createdAt,
  };
}

interface OwnerColumns {
  readonly email: string;
  readonly emailVerifiedAt: Date | null;
}

function toUserView(row: MerchantUserRow): MerchantUserView {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    emailVerifiedAt: row.emailVerifiedAt,
    disabledAt: row.disabledAt,
    createdAt: row.createdAt,
  };
}

/**
 * Владелец рядом со своей организацией — там, где мерчантов читают
 * списком: его почта и есть та, по которой мерчанта знают и ищут.
 * Внутренним, а не левым: мерчанта без владельца не бывает, и строка,
 * выпавшая из списка, сказала бы о поломке громче, чем пустая почта.
 */
function ownerJoin(): SQL {
  return and(eq(merchantUsers.merchantId, merchants.id), eq(merchantUsers.role, 'owner'))!;
}

/**
 * Владелец кабинета: тот, кому сервис пишет о деньгах.
 *
 * Читается отдельным запросом, а не join-ом, там, где строка мерчанта
 * уже прочитана и заперта на запись: `for update` по join-у запер бы
 * заодно и строку человека, которая к решению по анкете отношения не
 * имеет.
 */
async function ownerOf(executor: Executor, merchantId: string): Promise<MerchantUserRow> {
  const [row] = await executor
    .select()
    .from(merchantUsers)
    .where(and(eq(merchantUsers.merchantId, merchantId), eq(merchantUsers.role, 'owner')))
    .limit(1);
  if (!row) {
    throw new NotFoundError('У мерчанта нет владельца: кабинет без хозяина');
  }
  return row;
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
 * Ключ подтверждения уходит уведомлением, а ссылку из него собирает
 * доставка (`@nemo/email`): на каком домене стоит кабинет, ядро не
 * знает. Тем же ключом из ответа пользуется сид разработки — письма
 * там никуда не отправляются.
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
    const [row] = await tx
      .insert(merchants)
      .values({
        name,
        site,
        contactName,
        phone,
        about: input.about?.trim() || null,
      })
      .returning();

    /*
     * Занятость почты сторожит индекс, а не проверка перед вставкой:
     * между «занята ли» и «пишу» вклинивается вторая вкладка, и обе
     * проверки проходят. Пустой ответ здесь — это «кто-то уже завёл», и
     * говорится об этом теми же словами, что и в обычном отказе.
     *
     * Строка мерчанта при этом уже вставлена — и откатывается вместе с
     * отказом: транзакция на обе таблицы одна, иначе занятая почта
     * оставляла бы за собой организацию без хозяина.
     */
    const [owner] = await tx
      .insert(merchantUsers)
      .values({
        merchantId: row!.id,
        email,
        passwordHash,
        // Имя человека — контактное лицо анкеты: другого о нём пока не
        // спрашивали, а «Владелец» в списке заявок ничего не говорит.
        name: contactName,
        role: 'owner',
      })
      .onConflictDoNothing({ target: merchantUsers.email })
      .returning();
    if (owner === undefined) {
      throw new ConflictError(MERCHANT_COMPLAINTS.emailTaken);
    }

    await tx.insert(merchantEmailTokens).values({
      merchantUserId: owner.id,
      purpose: 'email_verification',
      tokenHash,
      expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS),
    });

    return {
      merchant: toView(row!, owner),
      notifications: [
        { kind: 'merchant-email-verification', to: toMerchant(row!.id, owner.email), token },
      ],
    };
  });
}

/**
 * Прежние ключи той же цели — в расход.
 *
 * Живых ссылок на один ящик должно быть столько же, сколько писем,
 * которых мерчант ждёт, — одна. Иначе забытое письмо недельной
 * давности открывает кабинет ровно так же, как свежее, а попросивший
 * ссылку трижды не знает, какая из трёх сработает.
 */
async function spendOldTokens(
  tx: Executor,
  merchantUserId: string,
  purpose: 'email_verification' | 'password_reset',
): Promise<void> {
  await tx
    .update(merchantEmailTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(merchantEmailTokens.merchantUserId, merchantUserId),
        eq(merchantEmailTokens.purpose, purpose),
        isNull(merchantEmailTokens.usedAt),
      ),
    );
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
  return row.merchantUserId;
}

/**
 * Письмо подтверждения заново — по просьбе того, кто вошёл.
 *
 * Ссылка одноразовая, а письма теряются: их съедает спам-фильтр, их
 * открывают через двое суток, по ним проходит сканер ссылок почтового
 * шлюза. Без второго письма мерчант остаётся с неподтверждённым
 * адресом навсегда — анкету к рассмотрению не примут, а завести
 * кабинет заново нельзя: почта занята им же самим.
 *
 * Просит вошедший, а не всякий, кто назвал адрес: так эта операция не
 * становится способом слать письма на чужие ящики и перебирать, кто
 * здесь заведён. Вход подтверждения не требует — потому и просит.
 */
export async function resendMerchantEmailVerification(
  ctx: CoreConfig,
  actor: Actor,
): Promise<MerchantResult> {
  const merchantId = requireMerchant(actor);
  const { token, tokenHash } = issueToken();

  return ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(merchants)
      .where(eq(merchants.id, merchantId))
      .limit(1)
      .for('update');

    if (!row) {
      throw new NotFoundError('Мерчант не найден');
    }
    // Подтверждают адрес владельца: по нему принимается решение об
    // анкете. Просить об этом может кто угодно из вошедших — письмо
    // всё равно уходит на тот же адрес, чужого ящика из него не
    // достать.
    const owner = await ownerOf(tx, merchantId);
    if (owner.emailVerifiedAt !== null) {
      throw new ConflictError('Почта уже подтверждена');
    }

    await spendOldTokens(tx, owner.id, 'email_verification');
    await tx.insert(merchantEmailTokens).values({
      merchantUserId: owner.id,
      purpose: 'email_verification',
      tokenHash,
      expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS),
    });

    return {
      merchant: toView(row, owner),
      notifications: [
        { kind: 'merchant-email-verification', to: toMerchant(row.id, owner.email), token },
      ],
    };
  });
}

export async function verifyMerchantEmail(
  ctx: CoreConfig,
  token: string,
): Promise<MerchantView> {
  return ctx.db.transaction(async (tx) => {
    const userId = await takeToken(tx, token, 'email_verification');
    const [user] = await tx
      .update(merchantUsers)
      .set({ emailVerifiedAt: new Date() })
      .where(eq(merchantUsers.id, userId))
      .returning();
    const [row] = await tx
      .select()
      .from(merchants)
      .where(eq(merchants.id, user!.merchantId))
      .limit(1);
    return toView(row!, user!);
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
  const [found] = await ctx.db
    .select({ user: merchantUsers, merchant: merchants })
    .from(merchantUsers)
    .innerJoin(merchants, eq(merchants.id, merchantUsers.merchantId))
    .where(eq(merchantUsers.email, email))
    .limit(1);

  // Пароль проверяется и тогда, когда человека нет: иначе ответ по
  // незнакомой почте приходил бы заметно быстрее, и перебор шёл бы по
  // времени ответа.
  const hash = found?.user.passwordHash ?? (await unknownMerchantHash());
  const ok = await verifyPassword(hash, input.password);
  if (!found || !ok) {
    throw new ForbiddenError(MERCHANT_COMPLAINTS.credentials);
  }
  /*
   * Закрытый доступ отказывает после проверки пароля, а не вместо неё:
   * «доступ закрыт» по незнакомой почте рассказало бы перебирающему,
   * что такой человек здесь есть. Отказ при этом свой — тому, кого
   * закрыл собственный владелец, «почта или пароль не подходят»
   * означало бы сломанный пароль и поход в поддержку сервиса вместо
   * разговора с начальником.
   */
  if (found.user.disabledAt !== null) {
    throw new ForbiddenError('Доступ в кабинет закрыт: спросите владельца кабинета');
  }
  return toSession(found.user, found.merchant);
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

function toSession(user: MerchantUserRow, merchant: MerchantRow): MerchantSession {
  return {
    merchantId: merchant.id,
    userId: user.id,
    sessionEpoch: user.sessionEpoch,
    role: user.role,
    name: merchant.name,
    userName: user.name,
    status: merchant.status,
    needsEmailVerification: user.role === 'owner' && user.emailVerifiedAt === null,
  };
}

/**
 * Сессия по куке: тот ли это человек и то ли поколение.
 *
 * Поколение сверяется здесь, а не в приложении: правило «смена пароля
 * обрывает сессии» должно действовать при любом пути к кабинету, а
 * маршрутов у него много.
 *
 * Закрытый доступ обрывает сессию тем же поколением, что и смена
 * пароля: второго способа не пускать вошедшего здесь не заводится —
 * два способа разошлись бы, и один из них однажды забыли бы позвать.
 */
export async function getMerchantSession(
  ctx: CoreConfig,
  userId: string,
  sessionEpoch: number,
): Promise<MerchantSession> {
  const [found] = await ctx.db
    .select({ user: merchantUsers, merchant: merchants })
    .from(merchantUsers)
    .innerJoin(merchants, eq(merchants.id, merchantUsers.merchantId))
    .where(eq(merchantUsers.id, userId))
    .limit(1);

  if (!found || found.user.sessionEpoch !== sessionEpoch) {
    throw new ForbiddenError('Сессия больше не действует: войдите заново');
  }
  return toSession(found.user, found.merchant);
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
export async function recipientOf(
  executor: Executor,
  owner: Owner,
  submittedByUserId: string | null = null,
): Promise<Recipient> {
  if (owner.kind === 'client') {
    return toClient(owner.clientId);
  }
  const book = await merchantAddressBook(executor, [
    { clientId: null, merchantId: owner.merchantId, submittedByUserId },
  ]);
  return book.for({ clientId: null, merchantId: owner.merchantId, submittedByUserId });
}

/**
 * Владелец как адресат: письма о ключах, вебхуках и решении по анкете
 * уходят ему, а не тому, кто нажал кнопку. Ключи и вебхуки ведёт он
 * один, а решение по анкете — про его организацию.
 */
export async function merchantOwnerRecipient(
  executor: Executor,
  merchantId: string,
): Promise<Recipient> {
  const owner = await ownerOf(executor, merchantId);
  return toMerchant(merchantId, owner.email);
}

/** Строка, у которой спрашивают адресата: заявка или заявка на вывод. */
export interface OwnedRow {
  readonly clientId: bigint | null;
  readonly merchantId: string | null;
  readonly submittedByUserId?: string | null | undefined;
}

/**
 * Кому писать о заявках — пачкой: одним запросом на прогон
 * планировщика вместо запроса на заявку.
 *
 * Правило здесь одно и живёт в одном месте: письмо уходит тому, кто
 * заявку подал, а если подавшего нет — заявку завёл ключ API либо её
 * подали до появления отметки — или доступ ему закрыт, то владельцу.
 * Человеку, который больше не входит, письмо о курсе ни к чему, а
 * мерчант без адресата остался бы без ответа о своих деньгах.
 */
export interface MerchantAddressBook {
  readonly for: (row: OwnedRow) => Recipient;
}

export async function merchantAddressBook(
  executor: Executor,
  rows: readonly OwnedRow[],
): Promise<MerchantAddressBook> {
  const merchantIds = [
    ...new Set(rows.map((row) => row.merchantId).filter((id): id is string => id !== null)),
  ];
  const userIds = [
    ...new Set(
      rows.map((row) => row.submittedByUserId).filter((id): id is string => Boolean(id)),
    ),
  ];

  const people =
    merchantIds.length === 0
      ? []
      : await executor
          .select({
            id: merchantUsers.id,
            merchantId: merchantUsers.merchantId,
            email: merchantUsers.email,
            role: merchantUsers.role,
            disabledAt: merchantUsers.disabledAt,
          })
          .from(merchantUsers)
          .where(
            and(
              inArray(merchantUsers.merchantId, merchantIds),
              userIds.length === 0
                ? eq(merchantUsers.role, 'owner')
                : or(eq(merchantUsers.role, 'owner'), inArray(merchantUsers.id, userIds)),
            ),
          );

  const owners = new Map(
    people.filter((one) => one.role === 'owner').map((one) => [one.merchantId, one]),
  );
  const byId = new Map(people.map((one) => [one.id, one]));

  return {
    for: (row) => {
      if (row.clientId !== null) return toClient(row.clientId);
      if (row.merchantId === null) {
        throw new NotFoundError('У строки нет владельца: ни клиента, ни мерчанта');
      }
      const submitted = row.submittedByUserId ? byId.get(row.submittedByUserId) : undefined;
      if (submitted && submitted.disabledAt === null) {
        return toMerchant(row.merchantId, submitted.email);
      }
      const owner = owners.get(row.merchantId);
      if (!owner) {
        throw new NotFoundError('У мерчанта нет владельца: кабинет без хозяина');
      }
      return toMerchant(row.merchantId, owner.email);
    },
  };
}

/**
 * Своя анкета — самому мерчанту.
 *
 * Отдельно от `getMerchantCard`, который читает сотрудник: тот отдаёт
 * ещё и заявки, и решения администратора, и права у него другие. Здесь
 * же — то, что мерчант о себе заполнил, и состояние с причиной отказа:
 * причину он должен видеть, иначе исправлять ему нечего.
 */
export async function getMerchantProfile(
  ctx: CoreConfig,
  actor: Actor,
): Promise<MerchantView> {
  const merchantId = requireMerchant(actor);
  const [row] = await ctx.db
    .select()
    .from(merchants)
    .where(eq(merchants.id, merchantId))
    .limit(1);

  if (!row) {
    throw new NotFoundError('Мерчант не найден');
  }
  return toView(row, await ownerOf(ctx.db, merchantId));
}

/**
 * Свой пароль — со знанием нынешнего.
 *
 * Меняет его себе каждый, кого мерчант завёл: пароль — свойство
 * человека, и владелец, меняющий его за оператора, вместо этого
 * задаёт новый (`setMerchantUserPassword`) и передаёт лично.
 */
export async function changeMerchantPassword(
  ctx: CoreConfig,
  actor: Actor,
  input: { currentPassword: string; newPassword: string },
): Promise<void> {
  const userId = requireMerchantUser(actor);
  if (!looksLikePassword(input.newPassword)) {
    throw new InvalidInputError(MERCHANT_COMPLAINTS.password);
  }

  const [row] = await ctx.db
    .select()
    .from(merchantUsers)
    .where(eq(merchantUsers.id, userId))
    .limit(1);
  if (!row || !(await verifyPassword(row.passwordHash, input.currentPassword))) {
    throw new ForbiddenError(MERCHANT_COMPLAINTS.credentials);
  }

  await setPassword(ctx.db, userId, input.newPassword);
}

/**
 * Новый пароль и новое поколение — вместе. Порознь это два состояния,
 * между которыми старая кука ещё подходит к новому паролю.
 */
async function setPassword(
  executor: Executor,
  userId: string,
  password: string,
): Promise<void> {
  const passwordHash = await hashPassword(password);
  await executor
    .update(merchantUsers)
    .set({ passwordHash, sessionEpoch: nextEpoch() })
    .where(eq(merchantUsers.id, userId));
}

/**
 * Поколение считает база, а не код: два запроса «прочитать и записать»
 * с разных вкладок дали бы одно и то же число, и одна из смен пароля
 * не оборвала бы ничего.
 */
function nextEpoch(): SQL<number> {
  return sql`${merchantUsers.sessionEpoch} + 1`;
}

export async function requestMerchantPasswordReset(
  ctx: CoreConfig,
  email: string,
): Promise<{ notifications: readonly Notification[] }> {
  const [row] = await ctx.db
    .select()
    .from(merchantUsers)
    .where(eq(merchantUsers.email, email.trim().toLowerCase()))
    .limit(1);

  // Незнакомая почта отвечает так же, как знакомая: иначе форма
  // «забыли пароль» стала бы способом перебирать, кто здесь есть.
  // Так же молчит и закрытый доступ: пароль ему менять не за чем, а
  // разный ответ выдал бы, что такой человек здесь был.
  if (!row || row.disabledAt !== null) {
    return { notifications: [] };
  }

  const { token, tokenHash } = issueToken();
  await ctx.db.transaction(async (tx) => {
    await spendOldTokens(tx, row.id, 'password_reset');
    await tx.insert(merchantEmailTokens).values({
      merchantUserId: row.id,
      purpose: 'password_reset',
      tokenHash,
      expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
    });
  });

  return {
    notifications: [
      { kind: 'merchant-password-reset', to: toMerchant(row.merchantId, row.email), token },
    ],
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
    const userId = await takeToken(tx, token, 'password_reset');
    await tx
      .update(merchantUsers)
      .set({ passwordHash, sessionEpoch: nextEpoch() })
      .where(eq(merchantUsers.id, userId));
  });
}

/**
 * Ник поддержки для мерчантов — без спроса о том, кто спрашивает.
 *
 * Прав он не требует: этот ник кабинет показывает каждому мерчанту и
 * каждое письмо ставит подписью, секрета в нём нет. Отдельная операция,
 * а не чтение настроек целиком: настройки — администратору, а ник
 * нужен доставке писем, у которой актора нет вовсе.
 */
/**
 * Люди мерчанта: кто входит в его кабинет (тикет 17 трекера кабинета).
 *
 * Ведёт их владелец, и это право `staff` из таблицы `@nemo/types`:
 * завести человека — значит выдать доступ к чужим деньгам, и решает
 * это тот, чьи они.
 *
 * Список без разбора на действующих и закрытых: закрытый доступ — это
 * отметка в строке, а не уход из списка, и владелец, забывший, кого
 * закрыл в прошлом месяце, увидит это здесь, а не догадается по
 * пустому месту.
 */
export async function listMerchantUsers(
  ctx: CoreConfig,
  actor: Actor,
): Promise<readonly MerchantUserView[]> {
  const { merchantId } = requireMerchantAbility(actor, 'staff');
  const rows = await ctx.db
    .select()
    .from(merchantUsers)
    .where(eq(merchantUsers.merchantId, merchantId))
    // Владелец первым, дальше по времени: список читают сверху, а
    // начинается он с того, кто за всё отвечает.
    .orderBy(asc(merchantUsers.role), asc(merchantUsers.createdAt), asc(merchantUsers.id));
  return rows.map(toUserView);
}

export interface AddMerchantUserInput {
  readonly email: string;
  readonly password: string;
  readonly name: string;
  readonly role: MerchantUserRole;
}

/**
 * Завести человека: почта, пароль, имя и роль.
 *
 * Пароль задаёт владелец и передаёт лично — приглашение по почте
 * добавило бы подтверждение адреса ради ничего, а письма без пароля
 * войти не помогают. Адрес при этом настоящий: по нему работает
 * «забыли пароль», и почта — то, чем человек входит.
 */
export async function addMerchantUser(
  ctx: CoreConfig,
  actor: Actor,
  input: AddMerchantUserInput,
): Promise<MerchantUserView> {
  const { merchantId } = requireMerchantAbility(actor, 'staff');
  // Владелец у кабинета один, и заводится он вместе с анкетой:
  // второй — это второй адрес, по которому сервис пишет о деньгах.
  if (input.role === 'owner') {
    throw new InvalidInputError(MERCHANT_STAFF_COMPLAINTS.ownerRole);
  }
  const email = normalizeEmail(input.email);
  if (!looksLikePassword(input.password)) {
    throw new InvalidInputError(MERCHANT_COMPLAINTS.password);
  }
  const name = input.name.trim();
  if (!name) {
    throw new InvalidInputError(MERCHANT_STAFF_COMPLAINTS.name);
  }

  const passwordHash = await hashPassword(input.password);
  const [row] = await ctx.db
    .insert(merchantUsers)
    .values({ merchantId, email, passwordHash, name, role: input.role })
    .onConflictDoNothing({ target: merchantUsers.email })
    .returning();
  if (row === undefined) {
    throw new ConflictError(MERCHANT_COMPLAINTS.emailTaken);
  }
  return toUserView(row);
}

/**
 * Имя и роль. Сессию смена роли не обрывает: человек остаётся тем же,
 * а что ему теперь можно, спрашивается у базы при каждом запросе —
 * поколение здесь ни при чём.
 */
export async function updateMerchantUser(
  ctx: CoreConfig,
  actor: Actor,
  userId: string,
  input: { name?: string | undefined; role?: MerchantUserRole | undefined },
): Promise<MerchantUserView> {
  const { merchantId } = requireMerchantAbility(actor, 'staff');

  return ctx.db.transaction(async (tx) => {
    const row = await lockMerchantUser(tx, merchantId, userId);
    if (input.role !== undefined && (row.role === 'owner' || input.role === 'owner')) {
      throw new InvalidInputError(MERCHANT_STAFF_COMPLAINTS.ownerRole);
    }
    const name = input.name?.trim();
    if (input.name !== undefined && !name) {
      throw new InvalidInputError(MERCHANT_STAFF_COMPLAINTS.name);
    }

    const [updated] = await tx
      .update(merchantUsers)
      .set({
        ...(name === undefined ? {} : { name }),
        ...(input.role === undefined ? {} : { role: input.role }),
      })
      .where(eq(merchantUsers.id, userId))
      .returning();
    return toUserView(updated!);
  });
}

/**
 * Новый пароль человеку — от владельца, без знания нынешнего: он его и
 * не знает, пароль передавался лично и мог быть забыт.
 *
 * Себе так пароль не меняют: в настройках спрашивают нынешний, и это
 * не формальность — вошедший в оставленный без присмотра браузер
 * иначе сменил бы пароль владельца и запер бы его самого.
 */
export async function setMerchantUserPassword(
  ctx: CoreConfig,
  actor: Actor,
  userId: string,
  password: string,
): Promise<void> {
  const { merchantId, userId: actorUserId } = requireMerchantAbility(actor, 'staff');
  if (userId === actorUserId) {
    throw new InvalidInputError(MERCHANT_STAFF_COMPLAINTS.ownerPassword);
  }
  if (!looksLikePassword(password)) {
    throw new InvalidInputError(MERCHANT_COMPLAINTS.password);
  }

  await ctx.db.transaction(async (tx) => {
    await lockMerchantUser(tx, merchantId, userId);
    await setPassword(tx, userId, password);
  });
}

/**
 * Закрыть доступ и открыть обратно.
 *
 * Доступ закрывается, а не удаляется: на человека ссылаются поданные
 * им заявки — то же правило, по которому архивируется, а не исчезает
 * запись реквизита. Обрывается вход поколением сессии: второго
 * способа не пускать вошедшего здесь не заводится — два способа
 * разошлись бы, и один из них однажды забыли бы позвать.
 */
export async function setMerchantUserAccess(
  ctx: CoreConfig,
  actor: Actor,
  userId: string,
  input: { allowed: boolean },
): Promise<MerchantUserView> {
  const { merchantId } = requireMerchantAbility(actor, 'staff');

  return ctx.db.transaction(async (tx) => {
    const row = await lockMerchantUser(tx, merchantId, userId);
    if (row.role === 'owner') {
      throw new InvalidInputError(MERCHANT_STAFF_COMPLAINTS.ownerAccess);
    }

    const [updated] = await tx
      .update(merchantUsers)
      .set(
        input.allowed
          ? { disabledAt: null }
          : // Поколение растёт только при закрытии: открывая доступ
            // заново, обрывать нечего — прежние куки уже не подходят.
            { disabledAt: new Date(), sessionEpoch: nextEpoch() },
      )
      .where(eq(merchantUsers.id, userId))
      .returning();
    return toUserView(updated!);
  });
}

/**
 * Человек своего мерчанта, запертый на запись.
 *
 * Чужой здесь — «такого нет», а не «нельзя»: кабинет не должен
 * отвечать, существует ли человек с таким идентификатором у соседа.
 */
async function lockMerchantUser(
  tx: Executor,
  merchantId: string,
  userId: string,
): Promise<MerchantUserRow> {
  const [row] = await tx
    .select()
    .from(merchantUsers)
    .where(and(eq(merchantUsers.id, userId), eq(merchantUsers.merchantId, merchantId)))
    .limit(1)
    .for('update');
  if (!row) {
    throw new NotFoundError(MERCHANT_STAFF_COMPLAINTS.notFound);
  }
  return row;
}

export async function merchantSupportUsername(ctx: CoreConfig): Promise<string | null> {
  const { merchantSupportUsername: username } = await readServiceSettings(ctx.db);
  return username;
}

export async function listMerchants(
  ctx: CoreConfig,
  actor: Actor,
  filter: MerchantFilter = {},
): Promise<readonly MerchantView[]> {
  requireStaff(actor);
  const rows = await ctx.db
    .select({ merchant: merchants, owner: merchantUsers })
    .from(merchants)
    .innerJoin(merchantUsers, ownerJoin())
    .where(merchantConditions(filter))
    .orderBy(desc(merchants.createdAt), asc(merchants.id));
  return rows.map((row) => toView(row.merchant, row.owner));
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
    .innerJoin(merchantUsers, ownerJoin())
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
      conditions.push(isNotNull(merchantUsers.emailVerifiedAt));
    }
  }
  if (filter.query?.trim()) {
    // Знаки шаблона обезвреживаются: «%» в поле поиска — это мерчант с
    // процентом в названии, а не «покажи всех».
    const like = likePattern(filter.query);
    conditions.push(or(merchantNameLike(like), ilike(merchantUsers.email, like))!);
  }
  return conditions.length === 0 ? undefined : and(...conditions);
}

export async function getMerchantCard(
  ctx: CoreConfig,
  actor: Actor,
  merchantId: string,
): Promise<MerchantView> {
  requireStaff(actor);
  const [found] = await ctx.db
    .select({ merchant: merchants, owner: merchantUsers })
    .from(merchants)
    .innerJoin(merchantUsers, ownerJoin())
    .where(eq(merchants.id, merchantId))
    .limit(1);
  if (!found) {
    throw new NotFoundError('Мерчант не найден');
  }
  return toView(found.merchant, found.owner);
}

export async function approveMerchant(
  ctx: CoreConfig,
  actor: Actor,
  merchantId: string,
): Promise<MerchantResult> {
  const { staffId } = requireAdmin(actor);

  return ctx.db.transaction(async (tx) => {
    const row = await lockMerchant(tx, merchantId);
    const owner = await ownerOf(tx, merchantId);
    if (owner.emailVerifiedAt === null) {
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
      merchant: toView(updated!, owner),
      notifications: [
        {
          kind: 'merchant-application-decided',
          to: toMerchant(merchantId, owner.email),
        },
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
    const owner = await ownerOf(tx, merchantId);
    return {
      merchant: toView(updated!, owner),
      notifications: [
        {
          kind: 'merchant-application-decided',
          to: toMerchant(merchantId, owner.email),
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
    return toView(updated!, await ownerOf(tx, merchantId));
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
