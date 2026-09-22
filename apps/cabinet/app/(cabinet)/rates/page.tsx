import { exchangeKindSchema } from '@nemo/types';
import { firstParam } from '@nemo/ui';
import { getCore } from '@/lib/core';
import { listDirectionRates } from '@/lib/direction-rates';
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
 * Ряда плиток над таблицей нет намеренно. Минимальная сумма и срок
 * оплаты — про заявку, а не про курс: срок идёт с выдачи реквизитов, то
 * есть уже внутри сделки, а минимум направления и так стоит колонкой в
 * строке. Счётчик направлений считал строки, которые видно. Оба числа
 * названы словами в подсказке, а первый экран остался под тем, за чем
 * сюда приходят.
 *
 * Подсказка «как устроено» тоже живёт в клиентской части — внутри
 * табло, а не здесь: она показывает путь денег на живых числах той
 * строки, которую мерчант выбрал, и на той сумме, которую набрал.
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

      <RatesBoard
        directions={shown.directions}
        minAmount={shown.terms.minAmount}
        kind={kind}
        hasCash={hasCash}
      />
    </main>
  );
}
