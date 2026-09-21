import { exchangeKindSchema } from '@nemo/types';
import { firstParam, HowTo, Stat, Stats } from '@nemo/ui';
import { formatMoney } from '@nemo/ui/format';
import { getCore } from '@/lib/core';
import { listDirectionRates } from '@/lib/direction-rates';
import { RATES_HOW_TO } from '@/lib/exchange-texts';
import { viewer } from '@/lib/reads';
import { DisabledBanner } from '@/app/ui/disabled-banner';
import { RatesBoard } from './board';

export const dynamic = 'force-dynamic';

/**
 * Раздел «Курсы»: весь справочник направлений живым курсом — тем же,
 * что бот показывает клиенту по кнопке «Курс».
 *
 * Табло, а не три карточки подряд: мерчант приходит сюда с одним
 * вопросом — «какой у вас курс», — и ответ стоит одним плотным списком.
 * Рублёвая пара при этом остаётся отдельным блоком: сервис стоит по обе
 * её стороны, и котировок у неё две.
 *
 * Курс приходит в открытую страницу сам, потоком событий
 * (`app/api/rates/stream`), поэтому числа живут в клиентской части, а
 * сервер отдаёт лишь первый снимок. Отметка времени у каждой строки
 * своя: биржевая котировка живёт минуту, опорный курс банка — сутки, и
 * одна отметка на всё табло соврала бы про половину строк.
 */
export default async function RatesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const asked = exchangeKindSchema.safeParse(firstParam(params.kind));
  const kind = asked.success ? asked.data : 'electronic';

  const { session } = await viewer();
  const shown = await listDirectionRates(getCore(), kind);

  /*
   * Есть ли наличные направления вовсе: таба, за которым пусто, быть не
   * должно — он обещает раздел, которого нет. Спрашивать справочник
   * второй раз для этого незачем: `listDirectionRates` отдаёт условия
   * целиком, со всеми парами, а по виду сделки фильтрует свой список.
   */
  const hasCash = shown.terms.pairs.some((pair) => pair.kind === 'cash');

  return (
    <main className="page">
      <DisabledBanner status={session.status} />

      <header className="page__head">
        <div>
          <h1 className="page__title">Курсы</h1>
          <p className="page__sub">
            Курс с учётом наценки: по нему и обменяем. Обновляется раз в минуту — прямо на
            странице.
          </p>
        </div>
      </header>

      <HowTo title="Как это устроено" sub="Что за число и как долго оно держится" items={RATES_HOW_TO} />

      <Stats>
        <Stat
          label="Минимальная сумма"
          value={formatMoney(shown.terms.minAmount, shown.terms.minAmountCode)}
          note="считается по стороне заявки в USDT"
        />
        <Stat
          label="Срок оплаты"
          value={`${shown.terms.unpaidTtlMinutes} мин`}
          note="с выдачи реквизитов; столько держится курс"
        />
        <Stat
          label="Направлений"
          value={shown.directions.length}
          note={kind === 'cash' ? 'наличных' : 'безналичных, из кабинета и по API'}
        />
      </Stats>

      <RatesBoard
        directions={shown.directions}
        minAmount={shown.terms.minAmount}
        kind={kind}
        hasCash={hasCash}
      />
    </main>
  );
}
