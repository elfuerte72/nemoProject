import { cookies } from 'next/headers';
import Link from 'next/link';
import { EmptyState, HowTo, Moment, Tabs } from '@nemo/ui';
import { formatByCurrency } from '@nemo/ui/money-list';
import { TZ_COOKIE, readTzOffset, resolvePeriod } from '@nemo/ui/period';
import type { MerchantActivity } from '@nemo/core';
import { requireStaffPage } from '@/lib/auth/require-session';
import { getCore } from '@/lib/core';
import { MERCHANT_TABS, MERCHANT_TAB_LABELS, pickMerchantStatus } from '@/lib/merchant-rows';
import { MERCHANT_STATUS_LABELS, merchantPillClass } from '@/app/ui/merchant-card';
import { MerchantsSearch } from './merchants-search';

export const dynamic = 'force-dynamic';

/**
 * Мерчанты: бизнесы, которые пользуются сервисом как услугой обмена
 * (docs/adr/0017).
 *
 * Список и карточка — обеим ролям: менеджер ведёт их заявки и должен
 * знать, с кем имеет дело. Решения — только администратору, и это не
 * формальность: одобрение открывает право создавать обязательства
 * сервиса по курсу.
 */

const HOW_TO = [
  {
    title: 'Кто такой мерчант',
    detail:
      'Бизнес, который меняет через нас деньги — свои или своего покупателя. Заявки подаёт ' +
      'сам, из кабинета или программно, и платит по ним тоже сам. Telegram у него нет: есть ' +
      'почта, пароль и ключи.',
  },
  {
    title: 'Что даёт одобрение',
    detail:
      'Право подавать заявки по нашему курсу. Курс заявки — обязательство сервиса, и одобряя ' +
      'анкету, вы решаете, кому разрешено такие обязательства создавать. Поэтому кнопка ' +
      'только у администратора.',
  },
  {
    title: 'Анкета на рассмотрении',
    detail:
      'Сюда попадает только та, чей адрес почты подтверждён письмом. Анкета от адреса, до ' +
      'которого письмо не дошло, — неизвестно чья, и рассматривать её не из чего.',
  },
  {
    title: 'Что происходит при отключении',
    detail:
      'Ключи API перестают работать в ту же секунду — новых заявок не будет. Открытые заявки ' +
      'доходят до конца: деньги по ним уже отправлены. Вход в кабинет остаётся, чтобы мерчант ' +
      'видел, чем всё кончилось.',
  },
];

export default async function MerchantsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { actor } = await requireStaffPage();

  const params = await searchParams;
  const query = single(params.q);
  const status = pickMerchantStatus(single(params.status)) ?? 'pending';

  const core = getCore();
  // Активность за тридцать дней — одним запросом на всех, не по строке;
  // окно — то же, что у чипа «30 дней» в карточке: от местной полуночи.
  const offset = readTzOffset((await cookies()).get(TZ_COOKIE)?.value);
  const since = resolvePeriod({ period: '30d' }, new Date(), offset).from;
  const [rows, activity, ...counts] = await Promise.all([
    core.listMerchants(actor, { status, ...(query ? { query } : {}) }),
    core.merchantActivitySince(actor, since),
    ...MERCHANT_TABS.map((one) =>
      core.countMerchants(actor, { status: one, ...(query ? { query } : {}) }),
    ),
  ]);

  const suffix = query ? `&q=${encodeURIComponent(query)}` : '';

  return (
    <main className="page page--wide">
      <header className="page__head">
        <div>
          <h1 className="page__title">Мерчанты</h1>
          <p className="page__sub">
            Бизнесы, которые меняют через нас деньги. Открыть — анкета, контакты и заявки.
          </p>
        </div>
      </header>

      <HowTo title="Как это устроено" sub="Кто такой мерчант и что решает одобрение" items={HOW_TO} />

      <div className="filters">
        <MerchantsSearch query={query} />
        <Tabs
          label="Кого показывать"
          items={MERCHANT_TABS.map((one, index) => ({
            href: `/merchants?status=${one}${suffix}`,
            label: MERCHANT_TAB_LABELS[one],
            count: counts[index] ?? 0,
            current: status === one,
          }))}
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon="user"
          title={query ? 'Никого не нашлось' : 'Пока пусто'}
          text={
            query
              ? 'Поиск идёт по названию и почте. Попробуйте другую часть слова.'
              : status === 'pending'
                ? 'Новые анкеты встанут сюда — после того, как мерчант подтвердит почту.'
                : 'В этом состоянии сейчас никого.'
          }
        />
      ) : (
        <ul className="rows">
          {rows.map((merchant) => (
            <li key={merchant.id} className="row">
              <Link className="row__main" href={`/merchants/${merchant.id}`}>
                <span className="row__title">{merchant.name}</span>
                <span className="row__meta">
                  {merchant.email} · {merchant.contactName} · подана{' '}
                  <Moment at={merchant.createdAt.toISOString()} mode="day" />
                </span>
                {/*
                  Исполнено за тридцать дней и оборот по валютам: по ним
                  видно, кто из активных работает, а кто только одобрен.
                */}
                <span className="row__meta">{activityLine(activity.get(merchant.id))}</span>
              </Link>
              <span className={merchantPillClass(merchant.status)}>
                {MERCHANT_STATUS_LABELS[merchant.status]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

/** Исполнено за тридцать дней и оборот по валютам — или честное «нет». */
function activityLine(done: MerchantActivity | undefined): string {
  return done
    ? `за 30 дней исполнено ${done.completed} · оборот ${formatByCurrency(done.turnover)}`
    : 'за 30 дней исполненных заявок нет';
}

function single(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? '';
}
