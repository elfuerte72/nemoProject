import { and, desc, eq, inArray } from 'drizzle-orm';
import { conciergeKnowledge, exchangeRequests } from '@nemo/db';
import { Money } from '@nemo/types';
import { bonusBalance } from './bonus-account.js';
import type { CoreConfig } from './context.js';
import { getExchangeTerms } from './exchange-requests.js';
import { getQuote } from './rates.js';
import { readServiceSettings } from './settings.js';

/**
 * Справка: всё, что консьерж знает, когда отвечает этому клиенту.
 *
 * Собирает её ядро, а не модель инструментами. Причина в том же, в чём
 * и вся застава: числа в ответе бывают только те, что назвал сервис, — а
 * значит их надо назвать до вопроса, а не доверить их добыче. Заодно
 * это и есть «только читать»: читает база, модель получает готовое.
 *
 * Числа отсюда потом сверяются с ответом, поэтому справка — обычный
 * текст, а не документ: то, что клиент прочитает, и то, что проверит
 * застава, должно быть одним и тем же.
 */

/** Состояния, при которых заявка ещё живёт и о ней спрашивают. */
const OPEN_STATUSES = ['new', 'in_progress', 'rate_confirmed', 'payment_received'] as const;

/**
 * Сколько заявок клиента попадает в справку.
 *
 * Три: спрашивают про последнюю, изредка про предыдущую. Вся история в
 * запросе — это плата за токены и разбавленная справка, в которой
 * модель теряет то, о чём спросили.
 */
const REQUESTS_IN_FACTS = 3;

const STATUS_WORDS: Readonly<Record<string, string>> = {
  new: 'принята, ждёт менеджера',
  in_progress: 'менеджер взял в работу',
  rate_confirmed: 'выданы реквизиты, ждёт оплаты',
  payment_received: 'оплата получена, готовится отправка',
};

export async function conciergeFacts(ctx: CoreConfig, clientId: bigint): Promise<string> {
  const [knowledge, requests, balance, terms, settings] = await Promise.all([
    readKnowledge(ctx),
    readOpenRequests(ctx, clientId),
    bonusBalance(ctx.db, clientId),
    getExchangeTerms(ctx),
    readServiceSettings(ctx.db),
  ]);

  const rates = await readRates(ctx, terms.pairs);

  /*
   * Стабильное — вперёд, волатильное — в хвост. Провайдер кэширует
   * префикс запроса, совпавший с прошлым с нулевого токена, и кэш-хит
   * дешевле обычного входа на порядки. База знаний и минималка меняются
   * раз в неделю, курсы — каждые полминуты: курс, стоящий в середине,
   * рвал бы префикс на каждом запросе.
   */
  return [
    knowledge,
    `# Минимальная сумма обмена\n${terms.minAmount} ${terms.minAmountCode}`,
    '',
    /*
     * Ставки публичны — решение владельца: рефералка работает на
     * прозрачности. Живой строкой из настроек, а не статьёй базы знаний:
     * администратор поменял ставку — бот называет новую тем же днём.
     * Доля считается от дохода сервиса по заявке, не от суммы обмена, —
     * назвать её иначе значило бы пообещать чужие деньги.
     */
    '# Ставки реферальной программы',
    `Первая линия: ${percent(settings.referralLine1Bps)} от дохода сервиса по обмену приглашённого. `
      + `Вторая линия, приглашённые ими: ${percent(settings.referralLine2Bps)}.`,
    '',
    '# Курсы сейчас',
    rates.length > 0
      ? rates.join('\n')
      : 'Котировок сейчас нет. Курс назовёт менеджер при подаче заявки.',
    '',
    '# Заявки этого клиента',
    requests.length > 0 ? requests.join('\n') : 'Открытых заявок нет.',
    '',
    `# Бонусные баллы клиента\n${balance}`,
  ]
    .filter((block) => block !== '')
    .join('\n');
}

/** Базисные пункты процентом: 500 → «5%», 250 → «2,5%». */
function percent(bps: number): string {
  return `${(bps / 100).toString().replace('.', ',')}%`;
}

/**
 * База знаний — та, что правит администратор. Идёт первой: начало
 * запроса весит больше конца, а спрашивают чаще всего про сервис, а не
 * про свою заявку.
 */
async function readKnowledge(ctx: CoreConfig): Promise<string> {
  const rows = await ctx.db
    .select({ title: conciergeKnowledge.title, body: conciergeKnowledge.body })
    .from(conciergeKnowledge)
    .where(eq(conciergeKnowledge.isActive, true))
    .orderBy(conciergeKnowledge.position, conciergeKnowledge.title);

  if (rows.length === 0) return '';

  return rows.map((row) => `# ${row.title}\n${row.body}`).join('\n\n');
}

async function readOpenRequests(
  ctx: CoreConfig,
  clientId: bigint,
): Promise<readonly string[]> {
  const rows = await ctx.db
    .select()
    .from(exchangeRequests)
    .where(
      and(
        eq(exchangeRequests.clientId, clientId),
        inArray(exchangeRequests.status, [...OPEN_STATUSES]),
      ),
    )
    .orderBy(desc(exchangeRequests.createdAt))
    .limit(REQUESTS_IN_FACTS);

  return rows.map((row) => {
    const rate = row.finalRate ?? row.requestRate;
    return [
      `Обмен ${row.fromAmount} ${row.fromCode} на ${row.toCode}`,
      row.toAmount === null ? undefined : `к получению ${row.toAmount} ${row.toCode}`,
      rate === null ? 'курс назовёт менеджер' : `курс ${rate}`,
      STATUS_WORDS[row.status] ?? row.status,
    ]
      .filter((one) => one !== undefined)
      .join(', ');
  });
}

/**
 * Курсы по электронным направлениям.
 *
 * Наличные сюда не идут вовсе: котировок наличного рынка у сервиса нет,
 * и строка о них в справке означала бы курс, которого не существует.
 * Молчащий источник — тоже рабочее состояние: справка тогда честно
 * говорит, что курс назовёт менеджер.
 */
async function readRates(
  ctx: CoreConfig,
  pairs: Awaited<ReturnType<typeof getExchangeTerms>>['pairs'],
): Promise<readonly string[]> {
  const electronic = pairs.filter((pair) => pair.kind === 'electronic');

  const quoted = await Promise.all(
    electronic.map(async (pair) => {
      const quote = await getQuote(ctx, { fromCode: pair.fromCode, toCode: pair.toCode });
      return quote === null || Money.isZero(quote.rate)
        ? undefined
        : `${pair.fromCode} → ${pair.toCode}: ${quote.rate}`;
    }),
  );

  return quoted.filter((one): one is string => one !== undefined);
}
