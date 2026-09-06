import { HowTo, Moment } from '@nemo/ui';
import { getCore } from '@/lib/core';
import { viewer } from '@/lib/reads';
import { MERCHANT_STATUS_LABELS } from '@/lib/labels';
import { DisabledBanner } from '@/app/ui/disabled-banner';
import { PasswordForm } from './password-form';

export const dynamic = 'force-dynamic';

/**
 * Настройки: кто вы у нас и как поменять пароль.
 *
 * Анкета показана целиком и только на чтение: она рассмотрена
 * администратором, и правка её из кабинета означала бы решение,
 * принятое по одной анкете, и работу по другой. Меняется она через
 * поддержку — и это сказано здесь же, а не додумывается.
 */

const HOW_TO = [
  {
    title: 'Почему анкета не правится',
    detail:
      'Её рассматривал администратор, и решение принято по тому, что в ней написано. ' +
      'Изменились название, телефон или контактное лицо — напишите в поддержку.',
  },
  {
    title: 'Смена пароля закрывает все входы',
    detail:
      'В том числе на других устройствах и в других браузерах. Так и задумано: пароль ' +
      'меняют, когда он мог утечь, и старые входы после этого жить не должны.',
  },
];

export default async function SettingsPage() {
  const { actor, session } = await viewer();
  const profile = await getCore().getMerchantProfile(actor);

  return (
    <main className="page">
      <DisabledBanner status={session.status} />

      <header className="page__head">
        <div>
          <h1 className="page__title">Настройки</h1>
          <p className="page__sub">Анкета, пароль и выход.</p>
        </div>
      </header>

      <HowTo title="Как это устроено" sub="Что здесь меняется, а что через поддержку" items={HOW_TO} />

      <section className="card">
        <h2 className="card__title">Анкета</h2>
        <Line label="Название" value={profile.name} />
        <Line label="Почта" value={profile.email} />
        <Line label="Контактное лицо" value={profile.contactName} />
        <Line label="Телефон" value={profile.phone} />
        <Line label="Сайт" value={profile.site ?? '—'} />
        <Line label="Чем занимаетесь" value={profile.about ?? '—'} />
        <Line label="Состояние" value={MERCHANT_STATUS_LABELS[profile.status]} />
        {profile.rejectionReason ? (
          <Line label="Причина отказа" value={profile.rejectionReason} />
        ) : undefined}
        <p className="muted">
          Анкета подана <Moment at={profile.createdAt.toISOString()} mode="day" />
          {profile.approvedAt ? (
            <>
              {' · одобрена '}
              <Moment at={profile.approvedAt.toISOString()} mode="day" />
            </>
          ) : undefined}
        </p>
      </section>

      <PasswordForm />
    </main>
  );
}

/** Поле анкеты: подпись и значение — теми же деталями, что в панели. */
function Line({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="field">
      <span className="label">{label}</span>
      <span>{value}</span>
    </div>
  );
}
