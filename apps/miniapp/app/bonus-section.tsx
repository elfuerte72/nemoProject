'use client';

import { useEffect, useState } from 'react';
import type { BonusAccountView, WithdrawalRequestView } from '@nemo/core';
import type { WithdrawalMethod } from '@nemo/types';
import { ApiError, get, post } from '@/lib/client-api';
import { formatAmount, formatDate, parseAmount, shortId } from '@/lib/format';
import {
  BONUS_KIND_LABELS,
  WITHDRAWAL_METHOD_LABELS,
  WITHDRAWAL_STATUS_LABELS,
} from '@/lib/labels';
import { getWebApp } from '@/lib/telegram/webapp';
import { InviteIcon, WithdrawIcon } from './ui/icons';
import { MarketingConsentToggle } from './marketing-consent';
import { NoticeSheet, Sheet } from './ui/sheet';

/**
 * Реферальный кабинет: сколько заработал, скольких привёл и как это
 * получить деньгами.
 *
 * О самих рефералах здесь только количество. Их имена — не награда за
 * приглашение: человек, пришедший по ссылке, не соглашался быть
 * показанным тому, кто её прислал.
 */

/**
 * Ссылка собирается здесь, а не в ядре: адрес бота — свойство
 * развёртывания, и операция, знающая его, перестала бы работать при
 * смене имени бота, не сломавшись при этом заметно.
 */
function referralLink(code: string): string | undefined {
  const bot = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;
  return bot ? `https://t.me/${bot}?startapp=${code}` : undefined;
}

/** Сколько «Скопировано» держится на месте кнопки. */
const COPIED_MS = 1600;

const SUBMITTED = {
  title: 'Заявка на вывод принята',
  body: 'Менеджер её рассмотрит и исполнит выплату вручную. Бот сообщит, когда деньги уйдут.',
};

type SheetState =
  | { readonly kind: 'withdraw' }
  | { readonly kind: 'invite' }
  | { readonly kind: 'notice'; readonly title: string; readonly body: string };

export function BonusSection({
  consent,
  onConsentChanged,
}: {
  readonly consent: boolean;
  readonly onConsentChanged: (consent: boolean) => void;
}) {
  const [account, setAccount] = useState<BonusAccountView>();
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequestView[]>([]);
  const [sheet, setSheet] = useState<SheetState>();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const [bonus, mine] = await Promise.all([
          get<{ account: BonusAccountView }>('/api/bonus-account'),
          get<{ requests: WithdrawalRequestView[] }>('/api/withdrawals'),
        ]);
        setAccount(bonus.account);
        setWithdrawals(mine.requests);
      } catch (failure) {
        setError(failure instanceof ApiError ? failure.message : 'Не удалось загрузить кабинет');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

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
    return <p className="empty">Загружаем кабинет…</p>;
  }

  if (!account) {
    return <p className="error">{error ?? 'Не удалось загрузить кабинет'}</p>;
  }

  return (
    <>
      <div className="balance">
        <div className="eyebrow">Бонусный баланс</div>
        <div className="balance__value">
          <span className="balance__number">{formatAmount(account.balance)}</span>
          <span className="balance__unit">баллов</span>
        </div>
        <p className="balance__note">
          Процент от того, что сервис заработал на сделках приглашённых.
        </p>
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

      {withdrawals.length > 0 ? (
        <>
          <div className="section-title">Заявки на вывод</div>
          <ul className="rows">
            {withdrawals.map((request) => (
              <li key={request.id} className="row">
                <span className="row__body">
                  <span className="row__title">
                    {formatAmount(request.amount)} баллов ·{' '}
                    {WITHDRAWAL_METHOD_LABELS[request.method]}
                  </span>
                  <span className="row__sub">
                    {formatDate(request.createdAt)}
                    {request.network ? ` · ${request.network}` : ''}
                    {request.destinationHint ? ` · ${request.destinationHint}` : ''}
                    {request.rejectReason ? ` · ${request.rejectReason}` : ''}
                  </span>
                </span>
                <span className="row__state">{WITHDRAWAL_STATUS_LABELS[request.status]}</span>
              </li>
            ))}
          </ul>
        </>
      ) : undefined}

      <div className="section-title">Движение баллов</div>
      {account.history.length === 0 ? (
        <p className="empty">Движений по баллам пока нет.</p>
      ) : (
        <ul className="rows">
          {account.history.map((entry) => (
            <li key={entry.id} className="row">
              <span className="row__body">
                <span className="row__title">
                  {entry.line
                    ? `${entry.line === 1 ? 'Первая' : 'Вторая'} линия`
                    : BONUS_KIND_LABELS[entry.kind]}
                </span>
                <span className="row__sub">
                  {entry.exchangeRequestId ? `Заявка ${shortId(entry.exchangeRequestId)} · ` : ''}
                  {formatDate(entry.createdAt)}
                  {entry.comment ? ` · ${entry.comment}` : ''}
                </span>
              </span>
              <span
                className={
                  entry.amount.startsWith('-') ? 'row__amount row__amount--out' : 'row__amount'
                }
              >
                {entry.amount.startsWith('-') ? '' : '+'}
                {formatAmount(entry.amount)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/*
        Рассылка — про самого клиента, а не про его баллы, но кабинет
        здесь единственное место, где вообще есть что-то о нём.
      */}
      <MarketingConsentToggle consent={consent} onAnswered={onConsentChanged} />

      {sheet?.kind === 'withdraw' ? (
        <WithdrawSheet
          balance={account.balance}
          onClose={() => setSheet(undefined)}
          onSubmitted={(request) => {
            setWithdrawals((current) => [request, ...current]);
            setSheet({ kind: 'notice', ...SUBMITTED });
          }}
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
  readonly onSubmitted: (request: WithdrawalRequestView) => void;
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
      const created = await post<{ request: WithdrawalRequestView }>('/api/withdrawals', {
        amount: parseAmount(amount),
        method,
        destination: destination.trim(),
        ...(method === 'crypto' ? { network } : {}),
      });
      onSubmitted(created.request);
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
        {/*
          Сеть спрашивается до адреса: он в разных сетях выглядит
          одинаково, и перевод не в ту не возвращается.
        */}
        {method === 'crypto' ? (
          <div className="field">
            <span className="field__label">Сеть</span>
            {networks.length === 0 ? (
              <p className="hint">
                Сети временно недоступны — выплату можно получить на счёт или спросить
                менеджера.
              </p>
            ) : (
              <div className="chips">
                {networks.map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setNetwork(value)}
                    aria-pressed={network === value}
                    className="chips__item"
                  >
                    {value}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : undefined}
        <label className="field">
          <span className="field__label">
            {method === 'bank'
              ? 'Счёт или карта'
              : network
                ? `Адрес кошелька в сети ${network}`
                : 'Адрес кошелька'}
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
