import { cookies } from 'next/headers';
import { merchantRoleCan } from '@nemo/types';
import { EmptyState, HowTo } from '@nemo/ui';
import { TZ_COOKIE, localMidnight, readTzOffset } from '@nemo/ui/period';
import { allowedHere } from '@/lib/access';
import { getCore } from '@/lib/core';
import { listDirectionRates } from '@/lib/direction-rates';
import { countSince, getPosSettings, listInvoices } from '@/lib/mock/store';
import { acquirer, IMITATION } from '@/lib/pos/acquirer';
import { POS_HOW_TO, PREVIEW_NOTE } from '@/lib/pos-texts';
import { viewer } from '@/lib/reads';
import { DisabledBanner } from '@/app/ui/disabled-banner';
import { NoAccess } from '@/app/ui/no-access';
import { Terminal, type RecentInvoice } from './terminal';

export const dynamic = 'force-dynamic';

/** Сколько последних счетов стоит рядом с терминалом: экран, а не список. */
const RECENT = 8;

/**
 * POS-терминал: покупатель выбирает валюту и называет сумму, мерчант
 * создаёт счёт, покупатель платит по QR.
 *
 * Назван словом владельца со звонка 8 сентября 2026 — он показывал
 * «посттерминал» у образца и просил перенести его.
 *
 * Экран нарисован целиком, денег за ним нет — так решено 10 сентября
 * 2026 (`backlog.md`): платёж принимает имитация провайдера
 * (`lib/pos/acquirer.ts`), и сказано об этом сверху и прямо. Умолчать
 * значило бы обещать приём платежей, которого у сервиса не существует.
 *
 * Валюты — все, которые сервис выдаёт за рубли: покупатель у стойки
 * платит рублями, а получает то, за чем пришёл. Курс тот же, что в
 * разделе «Курсы» и на экране новой заявки, с наценкой мерчанта
 * поверх; наценку владелец задаёт в разделе «Настройки», и здесь её
 * только видно.
 */
export default async function PosPage() {
  const access = await allowedHere('/pos');
  if (!access.ok) return <NoAccess ability={access.ability} />;

  const { actor, session } = await viewer();
  const offset = readTzOffset((await cookies()).get(TZ_COOKIE)?.value);
  const { directions, terms } = await listDirectionRates(getCore());
  const settings = getPosSettings(actor.merchantId);
  /*
   * Провайдер называется окружением, и опечатка в его имени — отказ
   * словами на этом экране, а не пятисотый ответ: тот, кто разворачивает,
   * увидит причину там же, где увидел бы терминал.
   */
  let provider: ReturnType<typeof acquirer> | null = null;
  let providerComplaint: string | null = null;
  try {
    provider = acquirer();
  } catch (error) {
    providerComplaint = error instanceof Error ? error.message : String(error);
  }

  // Смена — сутки по часам того, кто смотрит: терминал работает день, а
  // не с полуночи по UTC.
  const shift = countSince(actor.merchantId, localMidnight(new Date(), offset));

  const sellable = directions
    .filter((one) => one.fromCode === 'RUB')
    .map((one) => ({ fromCode: one.fromCode, toCode: one.toCode, rate: one.rate }));

  const recent: RecentInvoice[] = listInvoices(actor.merchantId)
    .slice(0, RECENT)
    .map((one) => ({
      id: one.id,
      number: one.number,
      status: one.status,
      payAmount: one.payAmount,
      payCode: one.payCode,
      amount: one.amount,
      code: one.code,
      createdAt: one.createdAt,
      demo: one.demo,
    }));

  const howTo = (
    <HowTo title="Как это устроено" sub="Что здесь работает, а что имитация" items={POS_HOW_TO} />
  );

  return (
    <main className="page">
      <DisabledBanner status={session.status} />

      <header className="page__head">
        <div>
          <h1 className="page__title">POS-терминал</h1>
          <p className="page__sub">{PREVIEW_NOTE}</p>
        </div>
      </header>

      {/*
        Подсказку с путём денег рисует сам терминал — на тех числах,
        которые в нём набраны. Здесь она стоит только там, где терминала
        нет: словами, без показа.
      */}
      {provider === null ? (
        <>
          {howTo}
          <EmptyState
            icon="exchange"
            title="Провайдер приёма не подключён"
            text={providerComplaint ?? 'Проверьте переменную POS_ACQUIRER в окружении кабинета.'}
          />
        </>
      ) : sellable.length === 0 ? (
        <>
          {howTo}
          <EmptyState
            icon="exchange"
            title="Направлений с рублями нет"
            text="POS-терминал считает цену по направлениям, в которых сервис выдаёт валюту за рубли. Пока таких нет, создать счёт не из чего."
          />
        </>
      ) : (
        <Terminal
          directions={sellable}
          shift={shift}
          authorName={session.userName}
          minAmount={terms.minAmount}
          markupBps={settings.markupBps}
          canPrice={merchantRoleCan(session.role, 'pricing')}
          ttlMinutes={terms.unpaidTtlMinutes}
          provider={{ title: provider.title, imitation: provider.name === IMITATION }}
          recent={recent}
        />
      )}
    </main>
  );
}
