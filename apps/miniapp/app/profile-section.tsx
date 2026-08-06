'use client';

import { useEffect, useState } from 'react';
import type { BonusAccountView, ClientView, RequisitesView, WithdrawalRequestView } from '@nemo/core';
import { requisiteKinds } from '@nemo/types';
import { ApiError, get, post } from '@/lib/client-api';
import { referralLink } from '@/lib/referral';
import {
  describeRequisites,
  formatAmount,
  formatBps,
  formatMonth,
  parseAmount,
} from '@/lib/format';
import { REQUISITE_KIND_LABELS } from '@/lib/labels';
import { getTelegramUser, haptic, openTelegram, supportLink } from '@/lib/telegram/webapp';
import { CardIcon, ChevronRight, InviteIcon, SupportIcon, WithdrawIcon } from './ui/icons';
import { Failure } from './ui/failure';
import { Loading } from './ui/loading';
import { useCopied } from './ui/use-copied';
import { MarketingConsentToggle } from './marketing-consent';
import { RequisitesSheet } from './requisites-section';
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
  const { copied, copy } = useCopied();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  /** Счётчик попыток: им же заводится повторное чтение после отказа. */
  const [attempt, setAttempt] = useState(0);

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
        setError(undefined);
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
  }, [revisit, attempt]);

  const telegram = getTelegramUser();
  const name = [telegram?.first_name, telegram?.last_name].filter(Boolean).join(' ');
  const support = supportLink();

  const link = account ? referralLink(account.referralCode) : undefined;

  function copyLink() {
    if (link) copy(link);
  }

  function share() {
    if (!link) return;
    openTelegram(`https://t.me/share/url?url=${encodeURIComponent(link)}`);
  }

  if (loading) {
    return <Loading />;
  }

  if (!account) {
    return (
      <Failure
        message={error ?? 'Не удалось загрузить профиль'}
        onRetry={() => setAttempt((was) => was + 1)}
      />
    );
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

      {/*
        Отказ стоит под тем, что не удалось прочитать, а не в середине
        списка плиток: разделив их собой, он рвал бы зазор между ними —
        а стоя рядом с балансом, он говорит ровно о том, чего в нём не
        хватает.
      */}
      {error ? <p className="error">{error}</p> : undefined}

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

      {/*
        Сколько привёл и по какой ставке. Ставка стоит рядом с числом
        приглашённых, а не в тексте где-то ниже: без неё в этой плашке
        два числа, которые ни о чём не говорят, — а вопрос к
        реферальной программе один, «сколько мне за это платят».
      */}
      <div className="split">
        <div className="split__cell">
          <div className="split__value">{account.line1Count}</div>
          <div className="split__label">первая линия</div>
          <div className="split__rate">{formatBps(account.line1Bps)} с их обменов</div>
        </div>
        <div className="split__rule" />
        <div className="split__cell">
          <div className="split__value">{account.line2Count}</div>
          <div className="split__label">вторая линия</div>
          <div className="split__rate">{formatBps(account.line2Bps)} с их обменов</div>
        </div>
      </div>

      {link ? (
        <button type="button" onClick={copyLink} className="tile bonus__link">
          <span className="tile__body">
            <span className="tile__label">Ваша ссылка</span>
            <span className="tile__value">{link.replace('https://', '')}</span>
          </span>
          <span className="link">{copied ? 'Скопировано' : 'Копировать'}</span>
        </button>
      ) : (
        <p className="empty">Реферальная ссылка появится, когда бот будет настроен.</p>
      )}

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

      {/*
        Разговор с менеджером — здесь же, рядом с прочим о самом клиенте.
        Приложение пять раз отсылает к менеджеру словами: за курсом по
        наличным, за старыми записями истории, за переводом в погашенной
        сети, — и ни одна из этих строк не была кнопкой. Ведёт она в тот
        самый чат, где клиента и читают: своего адреса поддержки у
        сервиса нет, обращение живёт в переписке.
      */}
      {support ? (
        <button type="button" onClick={() => openTelegram(support)} className="tile">
          <span className="tile__icon">
            <SupportIcon />
          </span>
          <span className="tile__body">
            <span className="tile__label">Поддержка</span>
            <span className="tile__value">Написать менеджеру</span>
          </span>
          <ChevronRight />
        </button>
      ) : undefined}

      <MarketingConsentToggle consent={consent} onAnswered={onConsentChanged} />

      {sheet?.kind === 'withdraw' ? (
        <WithdrawSheet
          balance={account.balance}
          requisites={requisites}
          onClose={() => setSheet(undefined)}
          onSubmitted={() => setSheet({ kind: 'notice', ...SUBMITTED })}
          onAddRequisites={() => setSheet({ kind: 'requisites' })}
        />
      ) : undefined}

      {sheet?.kind === 'invite' ? (
        <Sheet title="Пригласить" onClose={() => setSheet(undefined)}>
          {/*
            Условия названы числами, а не «процентом» вообще: программа,
            в которой не видно ставки, не работает — звать знакомых, не
            зная, сколько за это платят, никто не станет.

            База начисления названа тоже. Процент считается от дохода
            сервиса по заявке, а не от её суммы (docs/adr/0003), и клиент,
            прочитавший «5% с обмена», ждал бы пять процентов от
            обменянного миллиона.
          */}
          <p className="sheet__body">
            Отправьте свою ссылку в любой чат. Когда приглашённый обменяет — вам начислится{' '}
            {formatBps(account.line1Bps)} того, что сервис заработал на его заявке. С обменов
            тех, кого приведёт он, начисляется {formatBps(account.line2Bps)}. Баллы выводятся
            деньгами на любой из ваших реквизитов.
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
                <button type="button" onClick={copyLink} className="btn btn--soft">
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

/**
 * Заявка на вывод: сколько и на какую из сохранённых записей.
 *
 * Реквизит здесь больше не вводят — его выбирают из того же списка, что
 * и при обмене. Ввод заново означал бы, что клиент, однажды сохранивший
 * карту, набирает её номер второй раз, а сервис хранит два ответа на
 * вопрос, куда ему платить.
 *
 * Способ выплаты из формы тоже ушёл: его знает сама запись — телефон и
 * карта уходят банковским переводом, кошелёк криптовалютой.
 */
function WithdrawSheet({
  balance,
  requisites,
  onClose,
  onSubmitted,
  onAddRequisites,
}: {
  readonly balance: string;
  readonly requisites: readonly RequisitesView[];
  readonly onClose: () => void;
  readonly onSubmitted: () => void;
  /** Записей нет — заводить их лист вывода не умеет, это дело профиля. */
  readonly onAddRequisites: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [selected, setSelected] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  // Погашенная сеть выбирается не больше, чем при обмене: заявку в неё
  // некому исполнить.
  const offered = requisites.filter((one) => one.isAvailable);
  const picked = selected ?? offered[0]?.id;

  async function submit() {
    if (!picked) return;
    setError(undefined);
    setBusy(true);
    try {
      // Поданная заявка отсюда никуда не кладётся: её место — в
      // истории, и туда она попадёт при следующем заходе в раздел.
      await post<{ request: WithdrawalRequestView }>('/api/withdrawals', {
        amount: parseAmount(amount),
        requisitesId: picked,
      });
      haptic('success');
      onSubmitted();
    } catch (failure) {
      haptic('error');
      setError(failure instanceof ApiError ? failure.message : 'Не удалось подать заявку на вывод');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="Вывод баллов" onClose={onClose}>
      <p className="sheet__body">
        Доступно {formatAmount(balance)} баллов. Выплату исполнит менеджер вручную — на ту же
        запись, на которую приходят обмены.
      </p>

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
      </div>

      {offered.length === 0 ? (
        <p className="empty">
          Выплату некуда отправить: заведите реквизиты — карту, перевод по телефону или кошелёк.
        </p>
      ) : (
        <>
          <div className="section-title">Куда перечислить</div>
          <ul className="rows">
            {offered.map((one) => (
              <li key={one.id} className="row">
                <button
                  type="button"
                  onClick={() => setSelected(one.id)}
                  aria-pressed={one.id === picked}
                  className="option option--flush"
                >
                  <span className="row__body">
                    <span className="row__title">{describeRequisites(one)}</span>
                    <span className="row__sub">{REQUISITE_KIND_LABELS[one.kind]}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {error ? <p className="error">{error}</p> : undefined}

      <div className="sheet__actions">
        {offered.length === 0 ? (
          <button type="button" onClick={onAddRequisites} className="btn btn--gold">
            Завести реквизиты
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || !amount.trim() || !picked}
            className="btn btn--gold"
          >
            Подать заявку на вывод
          </button>
        )}
      </div>
    </Sheet>
  );
}
