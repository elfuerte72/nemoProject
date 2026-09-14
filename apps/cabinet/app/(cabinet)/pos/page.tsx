import { cookies } from 'next/headers';
import Link from 'next/link';
import { EmptyState, HowTo } from '@nemo/ui';
import { TZ_COOKIE, localMidnight, readTzOffset } from '@nemo/ui/period';
import { allowedHere } from '@/lib/access';
import { getCore } from '@/lib/core';
import { listDirectionRates } from '@/lib/direction-rates';
import { countSince } from '@/lib/mock/store';
import { POS_HOW_TO, PREVIEW_NOTE } from '@/lib/pos-texts';
import { viewer } from '@/lib/reads';
import { DisabledBanner } from '@/app/ui/disabled-banner';
import { NoAccess } from '@/app/ui/no-access';
import { Terminal } from './terminal';

export const dynamic = 'force-dynamic';

/**
 * POS-терминал: покупатель выбирает валюту и называет сумму, мерчант
 * создаёт счёт.
 *
 * Назван словом владельца со звонка 8 сентября 2026 — он показывал
 * «посттерминал» у образца и просил перенести его.
 *
 * Экран нарисован, денег за ним нет — так решено 10 сентября 2026
 * (`backlog.md`). Сказано об этом сверху и прямо: умолчать значило бы
 * обещать приём платежей, которого у сервиса не существует.
 *
 * Валюты — те, которые сервис выдаёт за рубли: покупатель у стойки
 * платит рублями, а получает то, за чем пришёл. Курс тот же, что в
 * разделе «Курсы» и на экране новой заявки.
 */
export default async function PosPage() {
  const access = await allowedHere('/pos');
  if (!access.ok) return <NoAccess ability={access.ability} />;

  const { actor, session } = await viewer();
  const offset = readTzOffset((await cookies()).get(TZ_COOKIE)?.value);
  const { directions, terms } = await listDirectionRates(getCore());

  // Смена — сутки по часам того, кто смотрит: терминал работает день, а
  // не с полуночи по UTC.
  const shift = countSince(actor.merchantId, localMidnight(new Date(), offset));

  const sellable = directions
    .filter((one) => one.fromCode === 'RUB')
    .map((one) => ({ fromCode: one.fromCode, toCode: one.toCode, rate: one.rate }));

  return (
    <main className="page">
      <DisabledBanner status={session.status} />

      <header className="page__head">
        <div>
          <h1 className="page__title">POS-терминал</h1>
          <p className="page__sub">{PREVIEW_NOTE}</p>
        </div>
        <div className="page__actions">
          <Link className="btn btn--soft btn--tiny" href="/invoices">
            Счета
          </Link>
        </div>
      </header>

      <HowTo title="Как это устроено" sub="Что здесь работает, а что нарисовано" items={POS_HOW_TO} />

      {sellable.length === 0 ? (
        <EmptyState
          icon="exchange"
          title="Направлений с рублями нет"
          text="POS-терминал считает цену по направлениям, в которых сервис выдаёт валюту за рубли. Пока таких нет, создать счёт не из чего."
        />
      ) : (
        <Terminal
          directions={sellable}
          shift={shift}
          merchantName={session.name}
          minAmount={terms.minAmount}
        />
      )}
    </main>
  );
}
