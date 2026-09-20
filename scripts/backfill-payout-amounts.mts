/**
 * Разовая починка: сумма к выдаче у заявок, подтверждённых без неё.
 *
 * До 20 сентября 2026 ядро принимало подтверждение курса без суммы к
 * выдаче — там, где котировки не дал никто, менеджер называл только
 * курс. Заявка оставалась без числа навсегда: в кабинете мерчанта
 * стояло «58 000 RUB → USDT», в карточке прочерк, и сколько клиент
 * получил, не знал ни он, ни менеджер месяц спустя.
 *
 * Новые заявки число получают сами. Этот скрипт достаёт его для
 * прежних — из того же, из чего его посчитало бы ядро: курс сделки
 * умножается на отданную сумму и округляется до знака валюты выдачи.
 * Ничего не выдумывается: курс у заявки записан, он и есть
 * обязательство сервиса.
 *
 * Трогает только строки, где курс есть, а суммы нет. Заявка, ещё не
 * дошедшая до подтверждения, суммы и не должна иметь — её не касаемся.
 *
 * **Смотреть глазами перед `--apply`.** Курс означает «сколько
 * получаемой валюты за единицу отдаваемой», и умножение верно только
 * если он записан по направлению сделки. 20 сентября 2026 этот самый
 * прогон напечатал «120 000 RUB × 81,5 = 9 780 000 USDT»: курс был
 * записан кривым сидом, одним числом на все направления. Строки
 * печатаются до записи именно поэтому — чушь видно сразу, и чинить
 * тогда надо источник, а не следствие.
 *
 * Запуск (сначала без записи — посмотреть, что получится):
 *   pnpm tsx --env-file=.env scripts/backfill-payout-amounts.mts
 *   pnpm tsx --env-file=.env scripts/backfill-payout-amounts.mts --apply
 *
 * Куда пишем — называется вслух, как и у сидов: база контура зовётся
 * `nemo`, ровно как продовая, и по имени их не различить.
 *   SEED_ALLOW=nemo@localhost:5433 … --apply
 */
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { createDatabase, currencies, exchangeRequests } from '@nemo/db';
import { Money } from '@nemo/types';

function target(url: string): string {
  const withoutUser = url.replace(/^[a-z]+:\/\/[^@]*@/i, '');
  const hostPort = withoutUser.split('/')[0] ?? '';
  const database = (withoutUser.split('/')[1] ?? '').split('?')[0];
  return `${database}@${hostPort}`;
}

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Не задан DATABASE_URL');

const where = target(url);
const apply = process.argv.includes('--apply');

if (apply && !where.startsWith('nemo_dev@') && process.env.SEED_ALLOW !== where) {
  throw new Error(
    `Откажусь писать в ${where}. Локальная nemo_dev — без вопросов; ` +
      `иначе задайте SEED_ALLOW=${where}, убедившись, что это та база.`,
  );
}

const db = createDatabase(url);

const decimalsOf = new Map<string, number>(
  (await db.select().from(currencies)).map((one) => [one.code, one.decimals]),
);

const rows = await db
  .select({
    id: exchangeRequests.id,
    fromAmount: exchangeRequests.fromAmount,
    fromCode: exchangeRequests.fromCode,
    toCode: exchangeRequests.toCode,
    finalRate: exchangeRequests.finalRate,
  })
  .from(exchangeRequests)
  .where(and(isNull(exchangeRequests.toAmount), isNotNull(exchangeRequests.finalRate)));

console.log(`Цель: ${where}`);
console.log(`Заявок с курсом, но без суммы к выдаче: ${rows.length}`);

let fixed = 0;
let skipped = 0;

for (const row of rows) {
  const decimals = decimalsOf.get(row.toCode);
  if (decimals === undefined) {
    // Валюты нет в справочнике — считать не по чему, и выдумывать знак
    // нельзя: ошибка в знаке это ошибка в деньгах.
    console.log(`  ${row.id}: валюты ${row.toCode} нет в справочнике — пропущена`);
    skipped += 1;
    continue;
  }

  const amount = Money.roundTo(
    Money.multiply(Money.toAmount(row.fromAmount), Money.toAmount(row.finalRate!)),
    decimals,
  );

  if (apply) {
    await db
      .update(exchangeRequests)
      .set({ toAmount: amount })
      .where(eq(exchangeRequests.id, row.id));
  }
  console.log(
    `  ${row.id}: ${row.fromAmount} ${row.fromCode} × ${row.finalRate} = ${amount} ${row.toCode}`,
  );
  fixed += 1;
}

console.log(
  apply
    ? `Записано: ${fixed}${skipped ? `, пропущено: ${skipped}` : ''}`
    : `Посчитано без записи: ${fixed}${skipped ? `, пропущено: ${skipped}` : ''}. Повторите с --apply`,
);

process.exit(0);
