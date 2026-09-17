import { createHash } from 'node:crypto';
import { and, desc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { apiKeys, merchants } from '@nemo/db';
import { requireMerchantAbility, requireStaff, type Actor } from './actor.js';
import type { CoreConfig } from './context.js';
import { ConflictError, InvalidInputError, NotFoundError } from './errors.js';
import { merchantOwnerRecipient, requireActiveMerchant } from './merchants.js';
import type { Notification } from './notifications.js';
import { randomAlphanumeric } from './secrets.js';

/**
 * Ключи API мерчанта (docs/adr/0017): чем его система подписывает
 * запросы к сервису.
 *
 * Ключ — это мерчант, действующий без кабинета: адаптер API узнаёт его
 * по секрету и отдаёт ядру тот же `Actor`, что и кабинет, — операции не
 * знают, откуда пришёл запрос. Отсюда два правила, которые живут здесь,
 * а не в маршруте: секрет показывается один раз и в базе не лежит, а
 * отозванный ключ и ключ отключённого мерчанта перестают узнаваться в
 * ту же секунду — путь через маршрут не единственный путь к операции.
 */

/** Ключ глазами мерчанта и сотрудника. Секрета здесь нет и не бывает. */
export interface ApiKeyView {
  readonly id: string;
  readonly label: string;
  /** Начало и хвост ключа: «sk_live_…a1b2». По нему ключ узнают в списке. */
  readonly hint: string;
  readonly issuedAt: Date;
  readonly revokedAt: Date | null;
  readonly lastUsedAt: Date | null;
}

export interface IssuedApiKey {
  readonly key: ApiKeyView;
  /** Сам ключ. Отдаётся однажды — здесь; из базы его не восстановить. */
  readonly secret: string;
  readonly notifications: readonly Notification[];
}

export interface ApiKeyResult {
  readonly key: ApiKeyView;
  readonly notifications: readonly Notification[];
}

/**
 * Чем кончилось узнавание ключа.
 *
 * Не исключение, а размеченный ответ: адаптер пишет отвергнутый вызов в
 * журнал мерчанта, а для этого ему надо знать, чей ключ отвергнут.
 * Незнакомый ключ ничей — о нём ответ говорит ровно это и ничего больше.
 */
export type ApiKeyAuth =
  | {
      readonly ok: true;
      readonly merchantId: string;
      readonly keyId: string;
      /** Требует ли мерчант подписи HMAC у своих запросов. */
      readonly signatureRequired: boolean;
    }
  | { readonly ok: false; readonly reason: 'unknown' }
  | {
      readonly ok: false;
      readonly reason: 'revoked' | 'merchant-inactive';
      readonly merchantId: string;
      readonly keyId: string;
      /** Слова отказа — те, что уходят вызывающему и в журнал. */
      readonly message: string;
    };

/**
 * Префиксы ключей: боевой и песочница (spec, Q27). Ключ с чужим
 * префиксом на контуре не узнаётся — он и не найдётся, — но префикс ещё
 * и говорит человеку, куда ключ ведёт, до первого вызова.
 */
export const API_KEY_PREFIXES = ['sk_live_', 'sk_test_'] as const;
export type ApiKeyPrefix = (typeof API_KEY_PREFIXES)[number];

export function isApiKeyPrefix(value: string): value is ApiKeyPrefix {
  return (API_KEY_PREFIXES as readonly string[]).includes(value);
}

/** Подпись ключа: коротко, но не пусто — два безымянных не отличить. */
const MAX_LABEL = 60;

/**
 * Секрет — тридцать два знака из букв и цифр (`secrets.ts`): около
 * 190 бит случайности, столько не перебрать, и поэтому хеш быстрый, а
 * не argon2id, как у пароля.
 */
const SECRET_LENGTH = 32;

/**
 * Как часто обновлять отметку «ходили в последний раз». Запись на
 * каждый вызов удваивала бы обращения к базе ради числа, которое
 * читают раз в неделю.
 */
const LAST_USED_GRAIN_MS = 60_000;

type ApiKeyRow = typeof apiKeys.$inferSelect;

function toView(row: ApiKeyRow): ApiKeyView {
  return {
    id: row.id,
    label: row.label,
    hint: row.hint,
    issuedAt: row.issuedAt,
    revokedAt: row.revokedAt,
    lastUsedAt: row.lastUsedAt,
  };
}

/**
 * Хеш секрета — SHA-256 без соли: соль защищает короткие пароли от
 * радужных таблиц, а у ключа около 190 случайных бит, и таблицы на него не
 * бывает. Зато по хешу ключ ищется одним чтением по индексу.
 */
export function hashApiKey(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/** Начало и хвост ключа — то, что мерчант видит после выпуска. */
export function apiKeyHint(secret: string, prefix: string): string {
  return `${prefix}…${secret.slice(-4)}`;
}

/**
 * Отсутствие префикса — ошибка развёртывания, как и отсутствие ключа
 * шифрования: мерчант ничего не сделал не так, и сообщать ему нечего.
 */
function requireApiKeyPrefix(config: CoreConfig): ApiKeyPrefix {
  const prefix = config.apiKeyPrefix;
  if (!prefix || !isApiKeyPrefix(prefix)) {
    throw new Error(
      `Не задан префикс ключей API (apiKeyPrefix): нужен один из ${API_KEY_PREFIXES.join(', ')}`,
    );
  }
  return prefix;
}

export async function issueApiKey(
  ctx: CoreConfig,
  actor: Actor,
  input: { readonly label: string },
): Promise<IssuedApiKey> {
  const { merchantId } = requireMerchantAbility(actor, 'integration');
  const prefix = requireApiKeyPrefix(ctx);

  const label = input.label.trim();
  if (!label) {
    throw new InvalidInputError('Подпишите ключ: для чего он — «сайт», «бухгалтерия»');
  }
  if (label.length > MAX_LABEL) {
    throw new InvalidInputError(`Подпись ключа: не длиннее ${MAX_LABEL} знаков`);
  }

  // Только одобренному и не отключённому: ключ — право подавать заявки,
  // а оно открывается одобрением анкеты и закрывается отключением.
  await requireActiveMerchant(ctx.db, merchantId);

  const secret = `${prefix}${randomAlphanumeric(SECRET_LENGTH)}`;
  const hint = apiKeyHint(secret, prefix);

  const [row] = await ctx.db
    .insert(apiKeys)
    .values({ merchantId, label, hint, secretHash: hashApiKey(secret) })
    .returning();

  const key = toView(row!);
  return {
    key,
    secret,
    notifications: [
      {
        kind: 'merchant-api-key-issued',
        to: await merchantOwnerRecipient(ctx.db, merchantId),
        label,
        hint,
      },
    ],
  };
}

/**
 * Отзыв — мерчантом, в любом его состоянии: ключ, ушедший на чужую
 * машину, отзывают и при закрытом доступе. Чужой ключ — «не найден», а
 * не «запрещено»: иначе перебором номеров можно узнать, какие есть.
 */
export async function revokeApiKey(
  ctx: CoreConfig,
  actor: Actor,
  keyId: string,
): Promise<ApiKeyResult> {
  const { merchantId } = requireMerchantAbility(actor, 'integration');

  return ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.id, keyId), eq(apiKeys.merchantId, merchantId)))
      .limit(1)
      .for('update');
    if (!row) {
      throw new NotFoundError('Ключ не найден');
    }
    if (row.revokedAt !== null) {
      throw new ConflictError('Ключ уже отозван');
    }

    const [updated] = await tx
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(eq(apiKeys.id, keyId))
      .returning();

    return {
      key: toView(updated!),
      notifications: [
        {
          kind: 'merchant-api-key-revoked',
          to: await merchantOwnerRecipient(tx, merchantId),
          label: row.label,
          hint: row.hint,
        },
      ],
    };
  });
}

export async function listApiKeys(ctx: CoreConfig, actor: Actor): Promise<readonly ApiKeyView[]> {
  return keysOf(ctx, requireMerchantAbility(actor, 'integration').merchantId);
}

/** Ключи мерчанта для карточки в панели: без секретов, с последней активностью. */
export async function listMerchantApiKeys(
  ctx: CoreConfig,
  actor: Actor,
  merchantId: string,
): Promise<readonly ApiKeyView[]> {
  requireStaff(actor);
  return keysOf(ctx, merchantId);
}

async function keysOf(ctx: CoreConfig, merchantId: string): Promise<readonly ApiKeyView[]> {
  const rows = await ctx.db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.merchantId, merchantId))
    .orderBy(desc(apiKeys.issuedAt), desc(apiKeys.id));
  return rows.map(toView);
}

/**
 * Кто пришёл с этим секретом.
 *
 * Состояние мерчанта читается при каждом вызове, а не при выпуске
 * ключа: отключение должно закрывать API в ту же секунду, и кэш здесь
 * означал бы «через минуту». Отметка последнего вызова обновляется не
 * чаще раза в минуту — см. `LAST_USED_GRAIN_MS`.
 */
export async function authenticateApiKey(ctx: CoreConfig, secret: string): Promise<ApiKeyAuth> {
  const [found] = await ctx.db
    .select({
      keyId: apiKeys.id,
      merchantId: apiKeys.merchantId,
      revokedAt: apiKeys.revokedAt,
      status: merchants.status,
      signatureRequired: merchants.signatureRequired,
    })
    .from(apiKeys)
    .innerJoin(merchants, eq(merchants.id, apiKeys.merchantId))
    .where(eq(apiKeys.secretHash, hashApiKey(secret)))
    .limit(1);

  if (!found) {
    return { ok: false, reason: 'unknown' };
  }
  if (found.revokedAt !== null) {
    return {
      ok: false,
      reason: 'revoked',
      merchantId: found.merchantId,
      keyId: found.keyId,
      message: 'Ключ отозван: выпустите новый в кабинете',
    };
  }
  if (found.status !== 'active') {
    return {
      ok: false,
      reason: 'merchant-inactive',
      merchantId: found.merchantId,
      keyId: found.keyId,
      message:
        found.status === 'pending'
          ? 'Анкета ещё на рассмотрении: API откроется после одобрения'
          : 'Доступ к API закрыт: напишите в поддержку',
    };
  }

  const threshold = new Date(Date.now() - LAST_USED_GRAIN_MS);
  await ctx.db
    .update(apiKeys)
    .set({ lastUsedAt: sql`now()` })
    .where(
      and(
        eq(apiKeys.id, found.keyId),
        or(isNull(apiKeys.lastUsedAt), lt(apiKeys.lastUsedAt, threshold)),
      ),
    );

  return {
    ok: true,
    merchantId: found.merchantId,
    keyId: found.keyId,
    signatureRequired: found.signatureRequired,
  };
}

/**
 * Требовать ли подпись HMAC у запросов. Включает сам мерчант; включённая
 * — обязательна для каждого вызова, иначе «по желанию» означало бы
 * «можно и без неё», то есть ничего.
 */
export async function setSignatureRequired(
  ctx: CoreConfig,
  actor: Actor,
  required: boolean,
): Promise<boolean> {
  const { merchantId } = requireMerchantAbility(actor, 'integration');
  const [updated] = await ctx.db
    .update(merchants)
    .set({ signatureRequired: required })
    .where(eq(merchants.id, merchantId))
    .returning({ signatureRequired: merchants.signatureRequired });
  if (!updated) {
    throw new NotFoundError('Мерчант не найден');
  }
  return updated.signatureRequired;
}
