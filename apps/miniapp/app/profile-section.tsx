'use client';

import { useEffect, useState } from 'react';
import type { BonusAccountView, ClientView, RequisitesView, WithdrawalRequestView } from '@nemo/core';
import { requisiteKinds, type WithdrawalMethod } from '@nemo/types';
import { ApiError, get, post } from '@/lib/client-api';
import { referralLink } from '@/lib/referral';
import { formatAmount, formatMonth, parseAmount } from '@/lib/format';
import { WITHDRAWAL_METHOD_LABELS } from '@/lib/labels';
import { getTelegramUser, getWebApp } from '@/lib/telegram/webapp';
import { CardIcon, ChevronRight, InviteIcon, WithdrawIcon } from './ui/icons';
import { Loading } from './ui/loading';
import { MarketingConsentToggle } from './marketing-consent';
import { RequisitesSheet } from './requisites-section';
import { addressLabel, NetworkPicker } from './ui/network-picker';
import { NoticeSheet, Sheet } from './ui/sheet';

/**
 * Профиль клиента: кто он для сервиса, что принесла ему рефералка и
 * куда сервис отправляет ему деньги.
 *
 * Раздел вырос из реферального кабинета и остался на его месте в ряду:
 * баллы — единственное, что у клиента в сервисе накапливается, и
 * прятать их вглубь профиля значило бы прятать причину звать друзей.
 *
 * О самих рефералах здесь только количество. Их имена — не награда за
 * приглашение: человек, пришедший по ссылке, не соглашался быть
 * показанным тому, кто её прислал.
 *
 * Движения по баллам и заявки на вывод отсюда уехали в историю: они
 * рассказывают, что было, а профиль отвечает, что есть сейчас. Дорогу
 * назад держит ссылка под балансом — она открывает ту же историю,
 * сразу отобранную по баллам.
 */

/** Сколько «Скопировано» держится на месте кнопки. */
const COPIED_MS = 1600;

/** «1 запись», «2 записи», «5 записей» — иначе число выглядит опечаткой. */
function plural(count: number): string {
  const tens = count % 100;
  const ones = count % 10;
  if (tens > 10 && tens < 20) return 'записей';
  if (ones === 1) return 'запись';
  if (ones > 1 && ones < 5) return 'записи';
  return 'записей';
}

const SUBMITTED = {
  title: 'Заявка на вывод принята',
  body: 'Менеджер её рассмотрит и исполнит выплату вручную. Бот сообщит, когда деньги уйдут.',
};

type SheetState =
  | { readonly kind: 'withdraw' }
  | { readonly kind: 'invite' }
  | { readonly kind: 'requisites' }
  | { readonly kind: 'notice'; readonly title: string; readonly body: string };

export function ProfileSection({
  revisit,
  client,
  consent,
  onConsentChanged,
  onOpenBonusHistory,
}: {
  readonly revisit: number;
  readonly client: ClientView;
  readonly consent: boolean;
  readonly onConsentChanged: (consent: boolean) => void;
  /** Открыть историю, отобранную по баллам: там видно, за что начислено. */
  readonly onOpenBonusHistory: () => void;
}) {
  const [account, setAccount] = useState<BonusAccountView>();
  const [requisites, setRequisites] = useState<RequisitesView[]>([]);
  const [networks, setNetworks] = useState<string[]>([]);
  const [sheet, setSheet] = useState<SheetState>();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const [bonus, mine, known] = await Promise.all([
          get<{ account: BonusAccountView }>('/api/bonus-account'),
          get<{ requisites: RequisitesView[] }>('/api/requisites'),
          // Справочник сетей нужен форме нового кошелька. Его молчание —
          // не поломка профиля: карту и телефон оно не трогает.
          get<{ networks: string[] }>('/api/networks').catch(() => ({ networks: [] })),
        ]);
        setAccount(bonus.account);
        setRequisites(mine.requisites);
        setNetworks(known.networks);
      } catch (failure) {
        setError(failure instanceof ApiError ? failure.message : 'Не удалось загрузить профиль');
      } finally {
        setLoading(false);
      }
    })();
    // Раздел остаётся в ряду и заново не собирается: баллы начисляются
    // по сделкам приглашённых, то есть меняются без участия хозяина
    // счёта. Признак занятости при этом не поднимается — читается уже
    // показанное, и подменять баланс на «Загружаем…» значило бы моргать
    // числом в ответ на возвращение.
  }, [revisit]);

  const telegram = getTelegramUser();
  const name = [telegram?.first_name, telegram?.last_name].filter(Boolean).join(' ');

  const link = account ? referralLink(account.referralCode) : undefined;

  function copy() {
    if (!link) return;
    void navigator.clipboard?.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), COPIED_MS);
  }

  function share() {
    if (!link) return;
    const url = `https://t.me/share/url?url=${encodeURIComponent(link)}`;
    const webApp = getWebApp();
    if (webApp?.openTelegramLink) {
      webApp.openTelegramLink(url);
    } else {
      window.open(url, '_blank');
    }
  }

  if (loading) {
    return <Loading />;
  }

  if (!account) {
    return <p className="error">{error ?? 'Не удалось загрузить профиль'}</p>;
  }

  return (
    <>
      <div className="whoami">
        {/*
          Фотография берётся у Telegram по его же ссылке. Обычный `img`,
          а не оптимизатор Next: тот проксирует картинку через сервер
          приложения, и ради одного аватара пришлось бы завести туда
          домен Telegram — вместе с ответственностью за то, что сервис
          отдаёт чужие фотографии со своего адреса.
        */}
        {telegram?.photo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={telegram.photo_url} alt="" className="whoami__photo" />
        ) : (
          <span className="whoami__photo whoami__photo--empty" aria-hidden="true">
            {(name || client.username || '?').slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className="whoami__body">
          <span className="whoami__name">{name || client.username || 'Вы'}</span>
          <span className="whoami__sub">
            {client.username ? `@${client.username} · ` : ''}с {formatMonth(client.createdAt)}
          </span>
        </span>
      </div>

      <div className="balance">
        <div className="eyebrow">Реферальные бонусы</div>
        <div className="balance__value">
          <span className="balance__number">{formatAmount(account.balance)}</span>
          <span className="balance__unit">баллов</span>
        </div>
        {/*
          Заработанное стоит рядом с остатком, а не вместо него: выведший
          половину видит в балансе половину, и без второго числа это
          читается как «столько рефералка и принесла».
        */}
        <button type="button" onClick={onOpenBonusHistory} className="balance__earned">
          Заработано всего {formatAmount(account.earned)} — за что начислено
        </button>
      </div>

      <div className="quick-row">
        <button type="button" onClick={() => setSheet({ kind: 'withdraw' })} className="quick">
          <span className="quick__circle">
            <WithdrawIcon />
          </span>
          <span className="quick__label">Вывод</span>
        </button>
        <button type="button" onClick={() => setSheet({ kind: 'invite' })} className="quick">
          <span className="quick__circle">
            <InviteIcon />
          </span>
          <span className="quick__label">Пригласить</span>
        </button>
      </div>

      <div className="split">
        <div className="split__cell">
          <div className="split__value">{account.line1Count}</div>
          <div className="split__label">первая линия</div>
        </div>
        <div className="split__rule" />
        <div className="split__cell">
          <div className="split__value">{account.line2Count}</div>
          <div className="split__label">вторая линия</div>
        </div>
      </div>

      {link ? (
        <button type="button" onClick={copy} className="tile bonus__link">
          <span className="tile__body">
            <span className="tile__label">Ваша ссылка</span>
            <span className="tile__value">{link.replace('https://', '')}</span>
          </span>
          <span className="link">{copied ? 'Скопировано' : 'Копировать'}</span>
        </button>
      ) : (
        <p className="empty">Реферальная ссылка появится, когда бот будет настроен.</p>
      )}

      {error ? <p className="error">{error}</p> : undefined}

      {/*
        Реквизиты — про самого клиента, а не про его баллы: по ним
        приходит и обмен, и выплата. Список один на оба дела, и живёт он
        здесь, потому что заводить его посреди подачи заявки — не то
        место, где о нём вспоминают заранее.
      */}
      <button
        type="button"
        onClick={() => setSheet({ kind: 'requisites' })}
        className="tile"
      >
        <span className="tile__icon">
          <CardIcon />
        </span>
        <span className="tile__body">
          <span className="tile__label">Мои реквизиты</span>
          <span className="tile__value">
            {requisites.length === 0
              ? 'Пока не заведены'
              : `${requisites.length} ${plural(requisites.length)}`}
          </span>
        </span>
        <ChevronRight />
      </button>

      <MarketingConsentToggle consent={consent} onAnswered={onConsentChanged} />

      {sheet?.kind === 'withdraw' ? (
        <WithdrawSheet
          balance={account.balance}
          onClose={() => setSheet(undefined)}
          onSubmitted={() => setSheet({ kind: 'notice', ...SUBMITTED })}
        />
      ) : undefined}

      {sheet?.kind === 'invite' ? (
        <Sheet title="Пригласить" onClose={() => setSheet(undefined)}>
          <p className="sheet__body">
            Отправьте свою ссылку в любой чат. Как только приглашённый сделает первый обмен, вам
            начислятся баллы — и половина этого же процента пойдёт с обменов тех, кого приведёт
            он.
          </p>
          {link ? (
            <>
              <div className="tile sheet__tile">
                <span className="tile__body">
                  <span className="tile__value">{link.replace('https://', '')}</span>
                </span>
              </div>
              <div className="sheet__actions">
                <button type="button" onClick={share} className="btn btn--gold">
                  Переслать
                </button>
                <button type="button" onClick={copy} className="btn btn--soft">
                  {copied ? 'Скопировано' : 'Копировать'}
                </button>
              </div>
            </>
          ) : (
            <p className="empty">Реферальная ссылка появится, когда бот будет настроен.</p>
          )}
        </Sheet>
      ) : undefined}

      {sheet?.kind === 'requisites' ? (
        <Sheet title="Мои реквизиты" onClose={() => setSheet(undefined)}>
          <RequisitesSheet
            requisites={requisites}
            // Все три способа, а не подходящие одной валюте: здесь запись
            // заводят заранее, ещё не выбрав, что менять.
            kinds={requisiteKinds}
            networks={networks}
            onSaved={(saved) => setRequisites((current) => [saved, ...current])}
            onRemoved={(id) => setRequisites((current) => current.filter((one) => one.id !== id))}
          />
        </Sheet>
      ) : undefined}

      {sheet?.kind === 'notice' ? (
        <NoticeSheet title={sheet.title} body={sheet.body} onClose={() => setSheet(undefined)} />
      ) : undefined}
    </>
  );
}

/** Заявка на вывод: сколько и куда. */
function WithdrawSheet({
  balance,
  onClose,
  onSubmitted,
}: {
  readonly balance: string;
  readonly onClose: () => void;
  readonly onSubmitted: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<WithdrawalMethod>('bank');
  const [network, setNetwork] = useState('');
  const [destination, setDestination] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  /*
   * Сети берутся из справочника, а не из перечисления в коде: сеть, в
   * которой кошелёк сервиса временно недоступен, администратор гасит из
   * панели, и предлагать её клиенту после этого нельзя.
   */
  const [networks, setNetworks] = useState<string[]>([]);

  useEffect(() => {
    void get<{ networks: string[] }>('/api/networks')
      .then((result) => {
        setNetworks(result.networks);
        setNetwork((current) => current || (result.networks[0] ?? ''));
      })
      // Молчание справочника — не поломка формы: выплату на счёт оно не
      // трогает, а про криптовалюту скажет пустой список сетей.
      .catch(() => setNetworks([]));
  }, []);

  async function submit() {
    setError(undefined);
    setBusy(true);
    try {
      // Поданная заявка отсюда никуда не кладётся: её место — в
      // истории, и туда она попадёт при следующем заходе в раздел.
      await post<{ request: WithdrawalRequestView }>('/api/withdrawals', {
        amount: parseAmount(amount),
        method,
        destination: destination.trim(),
        ...(method === 'crypto' ? { network } : {}),
      });
      onSubmitted();
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Не удалось подать заявку на вывод');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="Вывод баллов" onClose={onClose}>
      <p className="sheet__body">
        Доступно {formatAmount(balance)} баллов. Реквизиты сохранятся зашифрованными — дальше
        видны будут только последние знаки, а выплату исполнит менеджер.
      </p>

      <div className="segment">
        {(Object.keys(WITHDRAWAL_METHOD_LABELS) as WithdrawalMethod[]).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setMethod(value)}
            aria-pressed={method === value}
            className="segment__item"
          >
            {value === 'bank' ? 'На счёт' : 'В криптовалюте'}
          </button>
        ))}
      </div>

      <div className="form">
        <label className="field">
          <span className="field__label">Сколько вывести</span>
          <input
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            placeholder="0"
            className="input"
          />
        </label>
        {method === 'crypto' ? (
          <NetworkPicker
            networks={networks}
            selected={network}
            empty="Сети временно недоступны — выплату можно получить на счёт или спросить менеджера."
            onPick={setNetwork}
          />
        ) : undefined}
        <label className="field">
          <span className="field__label">
            {method === 'bank' ? 'Счёт или карта' : addressLabel(network)}
          </span>
          <input
            value={destination}
            onChange={(event) => setDestination(event.target.value)}
            placeholder={method === 'bank' ? '0000 0000 0000 0000' : 'Адрес кошелька'}
            className="input"
          />
        </label>
      </div>

      {error ? <p className="error">{error}</p> : undefined}

      <div className="sheet__actions">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={
            busy ||
            !amount.trim() ||
            !destination.trim() ||
            // Криптоперевод без сети отправить некуда: тот же адрес
            // живёт в нескольких, и выбор наугад — потерянные деньги.
            (method === 'crypto' && !network)
          }
          className="btn btn--gold"
        >
          Подать заявку на вывод
        </button>
      </div>
    </Sheet>
  );
}
