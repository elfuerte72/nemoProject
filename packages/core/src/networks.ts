import { asc, eq } from 'drizzle-orm';
import { transferNetworks } from '@nemo/db';
import { requireAdmin, type Actor } from './actor.js';
import type { CoreConfig, Executor } from './context.js';
import { InvalidInputError, NotFoundError } from './errors.js';
import { recordSettingsChange } from './settings-audit.js';

/**
 * Справочник сетей перевода.
 *
 * Один на весь сервис: и реквизиты обмена, и заявки на вывод берут сети
 * отсюда. Двух разных правд о том, куда сервис умеет отправлять, не
 * существует — иначе клиент подаст заявку в сеть, из которой ему не
 * отправят.
 *
 * Признак активности, а не удаление: сеть гасят на время — пока кошелёк
 * в ней недоступен, — а на выключенную ссылаются прошлые заявки.
 */

export interface NetworkView {
  readonly code: string;
  readonly isActive: boolean;
}

/**
 * Сети, в которые сервис отправляет прямо сейчас. Без исполнителя:
 * список нужен и клиенту в форме реквизитов, и менеджеру в панели, и
 * секрета в нём нет.
 */
export async function listActiveNetworks(ctx: CoreConfig): Promise<readonly string[]> {
  const rows = await ctx.db
    .select({ code: transferNetworks.code })
    .from(transferNetworks)
    .where(eq(transferNetworks.isActive, true))
    .orderBy(asc(transferNetworks.code));
  return rows.map((row) => row.code);
}

/** Весь справочник — администратору, который им управляет. */
export async function listNetworks(
  ctx: CoreConfig,
  actor: Actor,
): Promise<readonly NetworkView[]> {
  requireAdmin(actor);
  return ctx.db
    .select({ code: transferNetworks.code, isActive: transferNetworks.isActive })
    .from(transferNetworks)
    .orderBy(asc(transferNetworks.code));
}

export async function setNetworkActive(
  ctx: CoreConfig,
  actor: Actor,
  code: string,
  isActive: boolean,
): Promise<NetworkView> {
  const admin = requireAdmin(actor);

  return ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .update(transferNetworks)
      .set({ isActive })
      .where(eq(transferNetworks.code, code))
      .returning({ code: transferNetworks.code, isActive: transferNetworks.isActive });

    if (!row) {
      throw new NotFoundError(`Сеть ${code} не заведена`);
    }

    await recordSettingsChange(tx, admin.staffId, 'transfer_network', code, {
      action: isActive ? 'enabled' : 'disabled',
    });
    return row;
  });
}

/**
 * Сеть, в которую сервис отправляет. Выключенная — отказ: клиент не
 * должен подавать заявку, которую заведомо не исполнят.
 *
 * Отдельно от ссылки на справочник в базе: та ловит несуществующую сеть,
 * а эта — выключенную, и говорит об этом словами, а не кодом нарушенного
 * ограничения.
 */
export async function requireActiveNetwork(
  executor: Executor,
  code: string,
): Promise<void> {
  const [row] = await executor
    .select({ isActive: transferNetworks.isActive })
    .from(transferNetworks)
    .where(eq(transferNetworks.code, code))
    .limit(1);

  if (!row) {
    throw new InvalidInputError(`Сеть ${code} сервисом не поддерживается`);
  }
  if (!row.isActive) {
    throw new InvalidInputError(`Сеть ${code} временно недоступна: выберите другую`);
  }
}
