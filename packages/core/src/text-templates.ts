import { asc, eq } from 'drizzle-orm';
import { textTemplates } from '@nemo/db';
import { requireAdmin, requireStaff, type Actor } from './actor.js';
import type { CoreConfig, Executor } from './context.js';
import { InvalidInputError } from './errors.js';
import { recordSettingsChange } from './settings-audit.js';

/**
 * Заготовки текста: то, что менеджер вставляет в заявку, и то, что
 * читает клиент.
 *
 * Справочник «ключ — текст», а не колонки в настройках: формулировки
 * разнородны и меняются чаще, чем стоит гонять миграции.
 *
 * Значения по умолчанию лежат в коде, и пустой справочник ничего не
 * ломает: развёрнутый сервис работает до первого захода администратора
 * в настройки. Плата за правку без выкатки — тексты в базе не проходят
 * ревью; значения в коде остаются образцом тона.
 */

/**
 * Ключи заготовок. Перечислением, а не произвольной строкой: заготовка,
 * которую никто не читает, — опечатка в ключе, и заметить её иначе можно
 * только по жалобе клиента.
 */
export const textTemplateKeys = [
  'payment_requisites_rub',
  'payment_requisites_usdt',
  'bot_greeting',
  'bot_support',
  'bot_referral',
] as const;
export type TextTemplateKey = (typeof textTemplateKeys)[number];

/**
 * Где заготовка применяется.
 *
 * Не украшение списка: реквизиты для оплаты менеджер вставляет в
 * заявку одним нажатием, и приветствие бота, попавшее в тот же список,
 * ушло бы клиенту вместо счёта.
 */
export const textTemplateScopes = ['payment', 'bot'] as const;
export type TextTemplateScope = (typeof textTemplateScopes)[number];

interface TemplateDefault {
  /** Как заготовка называется в панели: подпись, а не текст для клиента. */
  readonly title: string;
  readonly scope: TextTemplateScope;
  readonly body: string;
}

/**
 * Значения по умолчанию.
 *
 * Реквизиты сервиса здесь не выдуманы: правдоподобный номер карты в
 * заготовке менеджер однажды отправил бы клиенту как настоящий. Текст по
 * умолчанию говорит ровно то, что есть, — реквизиты не заданы.
 */
const DEFAULTS: Record<TextTemplateKey, TemplateDefault> = {
  payment_requisites_rub: {
    title: 'Оплата рублями',
    scope: 'payment',
    body:
      'Реквизиты для оплаты рублями пока не заданы: администратор задаёт их ' +
      'в разделе настроек. До этого номер придётся набирать руками.',
  },
  payment_requisites_usdt: {
    title: 'Оплата в USDT',
    scope: 'payment',
    body:
      'Адрес кошелька сервиса пока не задан: администратор задаёт его в ' +
      'разделе настроек. До этого адрес придётся набирать руками.',
  },
  bot_greeting: {
    title: 'Приветствие бота',
    scope: 'bot',
    body:
      'Здравствуйте. Это обменник USDT и рублей — переводом или наличными.\n\n' +
      'Курс видно сразу: по нему и обменяем. Открывайте обменник, выбирайте ' +
      'направление и сумму — заявку возьмёт менеджер, а бот напишет на каждом шаге.\n\n' +
      'Кнопки внизу: курс — цифрой прямо здесь, ссылка — чтобы позвать знакомых, ' +
      'поддержка — если что-то непонятно.',
  },
  bot_support: {
    title: 'Ответ на кнопку поддержки',
    scope: 'bot',
    body:
      'Напишите вопрос прямо сюда, в этот чат. Его прочитает менеджер и ' +
      'ответит здесь же — держать открытым приложение для этого не нужно.',
  },
  bot_referral: {
    title: 'Подпись к реферальной ссылке',
    scope: 'bot',
    body:
      'Меняю здесь USDT и рубли: курс видно сразу, заявку ведёт менеджер. ' +
      'По этой ссылке — заходите:',
  },
};

export interface TextTemplateView {
  readonly key: TextTemplateKey;
  readonly title: string;
  /** Где заготовка применяется: в заявке у менеджера или в боте. */
  readonly scope: TextTemplateScope;
  readonly body: string;
  /** Правда, пока администратор не правил заготовку: текст из кода. */
  readonly isDefault: boolean;
  readonly updatedAt: Date | null;
}

/**
 * Текст заготовки: из справочника, а при пустом справочнике — из кода.
 * Читается операциями сервиса, а не только панелью.
 */
export async function readTextTemplate(
  executor: Executor,
  key: TextTemplateKey,
): Promise<string> {
  const [row] = await executor
    .select({ body: textTemplates.body })
    .from(textTemplates)
    .where(eq(textTemplates.key, key))
    .limit(1);

  return row?.body ?? DEFAULTS[key].body;
}

/**
 * Все заготовки — сотруднику: менеджер вставляет их в заявку, а правит
 * администратор.
 */
export async function listTextTemplates(
  ctx: CoreConfig,
  actor: Actor,
): Promise<readonly TextTemplateView[]> {
  requireStaff(actor);

  const rows = await ctx.db
    .select()
    .from(textTemplates)
    .orderBy(asc(textTemplates.key));
  const stored = new Map(rows.map((row) => [row.key, row]));

  // Список ведёт код, а не справочник: заготовка, которой в базе ещё
  // нет, должна быть видна администратору — иначе он не узнает, что её
  // можно задать.
  return textTemplateKeys.map((key) => {
    const row = stored.get(key);
    return {
      key,
      title: DEFAULTS[key].title,
      scope: DEFAULTS[key].scope,
      body: row?.body ?? DEFAULTS[key].body,
      isDefault: row === undefined,
      updatedAt: row?.updatedAt ?? null,
    };
  });
}

export async function updateTextTemplate(
  ctx: CoreConfig,
  actor: Actor,
  key: TextTemplateKey,
  body: string,
): Promise<TextTemplateView> {
  const admin = requireAdmin(actor);
  const text = body.trim();
  if (!text) {
    // Пустая заготовка молча вернула бы значение из кода, и
    // администратор решил бы, что правка не сохранилась.
    throw new InvalidInputError('Текст заготовки пуст: сбросить её к значению из кода нельзя');
  }

  return ctx.db.transaction(async (tx) => {
    const before = await readTextTemplate(tx, key);
    const [row] = await tx
      .insert(textTemplates)
      .values({ key, body: text })
      .onConflictDoUpdate({
        target: textTemplates.key,
        set: { body: text, updatedAt: new Date() },
      })
      .returning();

    await recordSettingsChange(tx, admin.staffId, 'text_template', key, {
      before,
      after: text,
    });

    return {
      key,
      title: DEFAULTS[key].title,
      scope: DEFAULTS[key].scope,
      body: row!.body,
      isDefault: false,
      updatedAt: row!.updatedAt,
    };
  });
}
