'use client';

import { useEffect, useState } from 'react';
import type { BonusAccountView, WithdrawalRequestView } from '@nemo/core';
import type { WithdrawalMethod } from '@nemo/types';
import { ApiError, get, post } from '@/lib/client-api';
import {
  BONUS_KIND_LABELS,
  WITHDRAWAL_METHOD_LABELS,
  WITHDRAWAL_STATUS_LABELS,
} from '@/lib/labels';
import { getWebApp } from '@/lib/telegram/webapp';

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

export function BonusSection() {
  const [account, setAccount] = useState<BonusAccountView>();
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequestView[]>([]);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<WithdrawalMethod>('bank');
  const [destination, setDestination] = useState('');
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(true);

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
        setError(
          failure instanceof ApiError ? failure.message : 'Не удалось загрузить кабинет',
        );
      } finally {
        setBusy(false);
      }
    })();
  }, []);

  async function requestWithdrawal(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);
    setNotice(undefined);
    setBusy(true);
    try {
      const created = await post<{ request: WithdrawalRequestView }>('/api/withdrawals', {
        amount: amount.replace(',', '.').trim(),
        method,
        destination: destination.trim(),
      });
      setWithdrawals((current) => [created.request, ...current]);
      setAmount('');
      setDestination('');
      setNotice('Заявка на вывод принята. Менеджер её рассмотрит.');
    } catch (failure) {
      setError(
        failure instanceof ApiError ? failure.message : 'Не удалось подать заявку на вывод',
      );
    } finally {
      setBusy(false);
    }
  }

  const link = account ? referralLink(account.referralCode) : undefined;

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

  return (
    <div style={styles.page}>
      <section>
        <h2 style={styles.heading}>Бонусный баланс</h2>
        <p style={styles.balance}>{account?.balance ?? '—'}</p>
        <p style={styles.muted}>
          Баллы начисляются, когда приведённый вами клиент совершает обмен: процент от
          того, что сервис на этой сделке заработал.
        </p>
      </section>

      <section>
        <h2 style={styles.heading}>Моя сеть</h2>
        <p>
          Первая линия — {account?.line1Count ?? 0}, вторая — {account?.line2Count ?? 0}
        </p>
        {link ? (
          <div style={styles.linkBlock}>
            <code style={styles.link}>{link}</code>
            <div style={styles.row}>
              <button
                type="button"
                onClick={() => void navigator.clipboard?.writeText(link)}
                style={styles.secondary}
              >
                Скопировать
              </button>
              <button type="button" onClick={share} style={styles.secondary}>
                Переслать
              </button>
            </div>
          </div>
        ) : (
          <p style={styles.muted}>Реферальная ссылка появится, когда бот будет настроен.</p>
        )}
      </section>

      <section>
        <h2 style={styles.heading}>Вывод баллов</h2>
        <form onSubmit={requestWithdrawal} style={styles.form}>
          <input
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            placeholder="Сколько вывести"
            style={styles.input}
          />
          <select
            value={method}
            onChange={(event) => setMethod(event.target.value as WithdrawalMethod)}
            style={styles.input}
          >
            {Object.entries(WITHDRAWAL_METHOD_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <input
            value={destination}
            onChange={(event) => setDestination(event.target.value)}
            placeholder={method === 'bank' ? 'Номер счёта или карты' : 'Адрес кошелька'}
            style={styles.input}
          />
          <p style={styles.muted}>
            Реквизиты сохраняются в зашифрованном виде: дальше вы будете видеть только их
            последние знаки. Выплату исполняет менеджер вручную.
          </p>
          <button type="submit" disabled={busy} style={styles.button}>
            Подать заявку на вывод
          </button>
        </form>
      </section>

      {error ? <p style={styles.error}>{error}</p> : undefined}
      {notice ? <p>{notice}</p> : undefined}

      <section>
        <h2 style={styles.heading}>Мои заявки на вывод</h2>
        {withdrawals.length === 0 ? (
          <p style={styles.muted}>Заявок на вывод пока нет.</p>
        ) : (
          <ul style={styles.list}>
            {withdrawals.map((request) => (
              <li key={request.id} style={styles.item}>
                <div>
                  {request.amount} баллов · {WITHDRAWAL_METHOD_LABELS[request.method]}
                  {request.destinationHint ? ` ${request.destinationHint}` : ''}
                </div>
                <div style={styles.muted}>
                  {WITHDRAWAL_STATUS_LABELS[request.status]}
                  {request.rejectReason ? ` — ${request.rejectReason}` : ''}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 style={styles.heading}>История баллов</h2>
        {!account || account.history.length === 0 ? (
          <p style={styles.muted}>Движений по баллам пока нет.</p>
        ) : (
          <ul style={styles.list}>
            {account.history.map((entry) => (
              <li key={entry.id} style={styles.item}>
                <div>
                  {entry.amount} · {BONUS_KIND_LABELS[entry.kind]}
                  {entry.line ? ` (${entry.line === 1 ? 'первая' : 'вторая'} линия)` : ''}
                </div>
                <div style={styles.muted}>
                  {entry.createdAt ? new Date(entry.createdAt).toLocaleDateString('ru-RU') : ''}
                  {entry.exchangeRequestId
                    ? ` · за сделку ${entry.exchangeRequestId.slice(0, 8)}`
                    : ''}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

const styles = {
  page: { display: 'flex', flexDirection: 'column', gap: '2rem' },
  heading: { fontSize: '1rem', marginBottom: '0.5rem' },
  balance: { fontSize: '1.8rem', fontWeight: 600 },
  form: { display: 'flex', flexDirection: 'column', gap: '0.6rem' },
  input: { padding: '0.6rem', fontSize: '1rem' },
  button: { padding: '0.75rem', fontSize: '1rem', fontWeight: 600 },
  secondary: { padding: '0.5rem 0.8rem', fontSize: '0.9rem' },
  row: { display: 'flex', gap: '0.5rem' },
  linkBlock: { display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.75rem' },
  link: { fontSize: '0.85rem', wordBreak: 'break-all', userSelect: 'all' },
  muted: { opacity: 0.7, fontSize: '0.85rem', lineHeight: 1.45 },
  error: { color: '#c0392b', fontSize: '0.9rem' },
  list: { listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '0.75rem' },
  item: { borderTop: '1px solid rgba(128,128,128,0.25)', paddingTop: '0.6rem' },
} satisfies Record<string, React.CSSProperties>;
