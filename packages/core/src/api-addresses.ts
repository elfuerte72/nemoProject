import { isIP } from 'node:net';
import { and, asc, count, eq } from 'drizzle-orm';
import { merchantApiAddresses } from '@nemo/db';
import { requireMerchantAbility, type Actor } from './actor.js';
import type { CoreConfig } from './context.js';
import { ConflictError, InvalidInputError, NotFoundError } from './errors.js';
import { isUniqueViolation } from './unique-violation.js';

/**
 * Разрешённые адреса для вызовов API мерчанта (24 сентября 2026, по
 * образцу «Разрешённых адресов» Love&Pay).
 *
 * Ключ в заголовке удостоверяет мерчанта, но не машину: ушедший ключ
 * работает с любого компьютера. Список адресов закрывает это — вызов
 * с узнанным ключом, но с чужого адреса, отвергается, и отказ пишется
 * в журнал мерчанта: видно, откуда пробовали. Пустой список — вызовы с
 * любого адреса, как было до него.
 *
 * Правило честно ровно настолько, насколько честен адрес. На нашем
 * развёртывании его ставит Traefik: у недоверенных клиентов он
 * вычищает `X-Forwarded-For` и пишет адрес соединения сам, так что
 * первый адрес в цепочке подделать нельзя (проверено 24 сентября 2026:
 * `forwardedHeaders` не настроен, а по умолчанию он именно такой).
 *
 * Разбор и сверка — чистые функции без базы: адаптер API зовёт сверку
 * на каждом вызове, и ошибка в ней либо запирает мерчанта, либо пускает
 * чужого, — это проверяется тестом на каждое написание.
 */

export interface ApiAddressView {
  readonly id: string;
  /** Приведённый вид: «203.0.113.0/24», одиночный — без маски. */
  readonly address: string;
  readonly note: string | null;
  readonly createdAt: Date;
}

/** Сколько адресов у мерчанта: серверов у него единицы, а не сотни. */
export const MAX_API_ADDRESSES = 50;

const MAX_NOTE = 60;

/**
 * Шире этого подсеть не заводится: /8 у IPv4 — это шестнадцать
 * миллионов адресов, а IPv6 короче /32 не выдаёт даже провайдерам.
 * Шире — значит «почти весь интернет», то есть список ни о чём.
 */
const WIDEST = { 4: 8, 6: 32 } as const;

type Version = 4 | 6;

interface Parsed {
  readonly version: Version;
  /** Адрес числом: 32 бита у IPv4, 128 у IPv6. */
  readonly bits: bigint;
  readonly prefix: number;
}

const WIDTH: Record<Version, number> = { 4: 32, 6: 128 };

const COMPLAINT_FORMAT =
  'Адрес — IP вроде 203.0.113.7 или подсеть вроде 203.0.113.0/24; IPv6 тоже годится';

/**
 * Приводит написанное человеком к виду, в котором адрес хранится:
 * подсеть — к её началу, одиночный — без маски, IPv6 — сжатым строчными,
 * IPv4 внутри IPv6 — к IPv4. Не адрес, адрес внутренней сети и слишком
 * широкая подсеть — отказ словами.
 */
export function normalizeApiAddress(input: string): string {
  const parsed = parseEntry(input.trim());
  if (!parsed) throw new InvalidInputError(COMPLAINT_FORMAT);

  if (parsed.prefix < WIDEST[parsed.version]) {
    throw new InvalidInputError(
      `Подсеть шире /${WIDEST[parsed.version]} — это почти весь интернет: ` +
        'назовите адреса своих серверов',
    );
  }
  const network = masked(parsed);
  if (inRanges(network, SERVICE)) {
    throw new InvalidInputError(
      'Это служебный адрес — групповая рассылка или зарезервированный диапазон: запрос ' +
        'с него не приходит. Назовите публичный адрес своего сервера',
    );
  }
  if (inRanges(network, INTERNAL)) {
    throw new InvalidInputError(
      'Это адрес внутренней сети: к нам запрос приходит с публичного адреса вашего ' +
        'сервера — его и назовите',
    );
  }
  return format(network);
}

/**
 * Пускать ли вызов с этого адреса. Пустой список пускает всех; адрес,
 * который не разобрать, при непустом списке не пускается — список
 * заведён, чтобы не пускать неизвестно кого.
 */
export function addressAllowed(allowed: readonly string[], address: string): boolean {
  if (allowed.length === 0) return true;
  const caller = parseAddress(address.trim());
  if (!caller) return false;

  return allowed.some((entry) => {
    const range = parseEntry(entry);
    if (!range || range.version !== caller.version) return false;
    const shift = BigInt(WIDTH[range.version] - range.prefix);
    return caller.bits >> shift === range.bits >> shift;
  });
}

/** Адрес с необязательной маской. */
function parseEntry(text: string): Parsed | null {
  const [address, prefixText, ...rest] = text.split('/');
  if (address === undefined || rest.length > 0) return null;
  const parsed = parseAddress(address);
  if (!parsed) return null;
  if (prefixText === undefined) return parsed;

  if (!/^\d{1,3}$/.test(prefixText)) return null;
  const prefix = Number(prefixText);
  // Маска IPv4-адреса, записанного через IPv6, отсчитывается от 128:
  // «::ffff:1.2.3.0/120» — это /24 у IPv4.
  const width = parsed.fromMapped ? 128 : WIDTH[parsed.version];
  if (prefix > width) return null;
  const own = parsed.fromMapped ? prefix - 96 : prefix;
  if (own < 0) return null;
  return { version: parsed.version, bits: parsed.bits, prefix: own };
}

/** Один адрес, без маски. IPv4 внутри IPv6 возвращается как IPv4. */
function parseAddress(text: string): (Parsed & { readonly fromMapped: boolean }) | null {
  const version = isIP(text);
  if (version === 4) {
    return { version: 4, bits: ipv4Bits(text), prefix: 32, fromMapped: false };
  }
  if (version !== 6) return null;

  const bits = ipv6Bits(text);
  if (bits === null) return null;
  // «::ffff:a.b.c.d»: старшие 80 бит нули, дальше 16 единиц.
  if (bits >> 32n === 0xffffn) {
    return { version: 4, bits: bits & 0xffffffffn, prefix: 32, fromMapped: true };
  }
  return { version: 6, bits, prefix: 128, fromMapped: false };
}

function ipv4Bits(text: string): bigint {
  return text.split('.').reduce((acc, octet) => (acc << 8n) | BigInt(Number(octet)), 0n);
}

/** Восемь групп по шестнадцать бит; `::` разворачивается в недостающие нули. */
function ipv6Bits(text: string): bigint | null {
  let source = text.toLowerCase();
  // Хвост в виде IPv4 — «::ffff:1.2.3.4» — переводится в две группы.
  const dotted = source.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const v4 = ipv4Bits(dotted[1]!);
    source =
      source.slice(0, -dotted[1]!.length) +
      `${(v4 >> 16n).toString(16)}:${(v4 & 0xffffn).toString(16)}`;
  }

  const halves = source.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;

  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  let bits = 0n;
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    bits = (bits << 16n) | BigInt(parseInt(group, 16));
  }
  return bits;
}

function masked(parsed: Parsed): Parsed {
  const shift = BigInt(WIDTH[parsed.version] - parsed.prefix);
  return { ...parsed, bits: (parsed.bits >> shift) << shift };
}

function format(parsed: Parsed): string {
  const address = parsed.version === 4 ? formatIpv4(parsed.bits) : formatIpv6(parsed.bits);
  return parsed.prefix === WIDTH[parsed.version] ? address : `${address}/${parsed.prefix}`;
}

function formatIpv4(bits: bigint): string {
  return [24n, 16n, 8n, 0n].map((shift) => String((bits >> shift) & 0xffn)).join('.');
}

/**
 * Сжатая запись по RFC 5952: строчные, без ведущих нулей, самая длинная
 * серия нулевых групп (от двух) — через `::`, при равных — первая.
 */
function formatIpv6(bits: bigint): string {
  const groups = Array.from({ length: 8 }, (_, index) =>
    ((bits >> BigInt((7 - index) * 16)) & 0xffffn).toString(16),
  );

  let bestStart = -1;
  let bestLength = 1;
  for (let start = 0; start < 8; start += 1) {
    let length = 0;
    while (start + length < 8 && groups[start + length] === '0') length += 1;
    if (length > bestLength) {
      bestStart = start;
      bestLength = length;
    }
  }
  if (bestStart === -1) return groups.join(':');
  return `${groups.slice(0, bestStart).join(':')}::${groups.slice(bestStart + bestLength).join(':')}`;
}

/**
 * Внутренние сети: частные, петля, локальные ссылки, общий адрес
 * провайдера. С них запрос к публичному API не приходит.
 */
const INTERNAL: readonly Parsed[] = ranges([
  ['10.0.0.0', 8],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['100.64.0.0', 10],
  ['0.0.0.0', 8],
  ['::', 127],
  ['fc00::', 7],
  ['fe80::', 10],
  // Устаревшие адреса площадки: тоже внутренние, просто старые.
  ['fec0::', 10],
]);

/**
 * Служебные диапазоны: групповая рассылка и зарезервированное вместе с
 * широковещательным 255.255.255.255. Документационные сети (TEST-NET)
 * сюда не входят: адреса из них — ровно то, чем пишут примеры.
 */
const SERVICE: readonly Parsed[] = ranges([
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
  ['ff00::', 8],
]);

function ranges(list: readonly (readonly [string, number])[]): readonly Parsed[] {
  return list.map(([address, prefix]) => {
    const parsed = parseAddress(address)!;
    return { version: parsed.version, bits: parsed.bits, prefix };
  });
}

/** Подсеть лежит в диапазоне, если в нём лежит её начало. */
function inRanges(network: Parsed, list: readonly Parsed[]): boolean {
  return list.some((range) => {
    if (range.version !== network.version) return false;
    const shift = BigInt(WIDTH[range.version] - range.prefix);
    return network.bits >> shift === range.bits >> shift;
  });
}

type AddressRow = typeof merchantApiAddresses.$inferSelect;

function toView(row: AddressRow): ApiAddressView {
  return { id: row.id, address: row.address, note: row.note, createdAt: row.createdAt };
}

export async function listApiAddresses(
  ctx: CoreConfig,
  actor: Actor,
): Promise<readonly ApiAddressView[]> {
  const { merchantId } = requireMerchantAbility(actor, 'integration');
  const rows = await ctx.db
    .select()
    .from(merchantApiAddresses)
    .where(eq(merchantApiAddresses.merchantId, merchantId))
    .orderBy(asc(merchantApiAddresses.createdAt), asc(merchantApiAddresses.id));
  return rows.map(toView);
}

/**
 * Список адресов для адаптера API — без проверки прав: его зовёт
 * узнавание ключа, у которого актора ещё нет.
 */
export async function apiAddressesOf(ctx: CoreConfig, merchantId: string): Promise<readonly string[]> {
  const rows = await ctx.db
    .select({ address: merchantApiAddresses.address })
    .from(merchantApiAddresses)
    .where(eq(merchantApiAddresses.merchantId, merchantId));
  return rows.map((row) => row.address);
}

export async function addApiAddress(
  ctx: CoreConfig,
  actor: Actor,
  input: { readonly address: string; readonly note: string },
): Promise<ApiAddressView> {
  const { merchantId } = requireMerchantAbility(actor, 'integration');
  const address = normalizeApiAddress(input.address);
  const note = input.note.trim();
  if (note.length > MAX_NOTE) {
    throw new InvalidInputError(`Заметка к адресу: не длиннее ${MAX_NOTE} знаков`);
  }

  return ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .select({ total: count() })
      .from(merchantApiAddresses)
      .where(eq(merchantApiAddresses.merchantId, merchantId));
    if ((row?.total ?? 0) >= MAX_API_ADDRESSES) {
      throw new InvalidInputError(
        `Адресов не больше ${MAX_API_ADDRESSES}: объедините соседние в подсеть`,
      );
    }

    try {
      const [created] = await tx
        .insert(merchantApiAddresses)
        .values({ merchantId, address, note: note || null })
        .returning();
      return toView(created!);
    } catch (error) {
      if (isUniqueViolation(error, 'merchant_api_addresses_merchant_address_key')) {
        throw new ConflictError(`Адрес ${address} уже в списке`);
      }
      throw error;
    }
  });
}

/** Чужой адрес — «не найден», а не «запрещено»: как у ключей. */
export async function removeApiAddress(ctx: CoreConfig, actor: Actor, id: string): Promise<void> {
  const { merchantId } = requireMerchantAbility(actor, 'integration');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundError('Адрес не найден');

  const deleted = await ctx.db
    .delete(merchantApiAddresses)
    .where(and(eq(merchantApiAddresses.id, id), eq(merchantApiAddresses.merchantId, merchantId)))
    .returning({ id: merchantApiAddresses.id });
  if (deleted.length === 0) throw new NotFoundError('Адрес не найден');
}
