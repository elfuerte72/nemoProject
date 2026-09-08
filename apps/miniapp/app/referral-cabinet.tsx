'use client';

import { useEffect, useState } from 'react';
import type {
  BonusAccountView,
  MyReferralView,
  MyReferralsPage,
  ReferralCabinetStats,
} from '@nemo/core';
import { ApiError, get } from '@/lib/client-api';
import { formatAmount, formatBps, formatDay } from '@/lib/format';
import {
  barHeight,
  compareCount,
  PERIOD_FILTERS,
  periodRange,
  tallest,
  type PeriodKey,
} from '@/lib/referral-stats-view';
import {
  allReferralsButton,
  nextTierNote,
  pendingNote,
  previousNote,
  REFERRAL_TEXTS,
  referralRowSub,
} from '@/lib/referral-texts';
import { Sheet } from './ui/sheet';

/**
 * Реферальный кабинет внутри профиля: уровень и ставки, статистика за
 * период, рефералы обезличенно.
 *
 * Всё посчитано сервером: экран показывает готовые числа и не складывает
 * баллы (`backlog.md`, «Прирост баллов за период»). Столбики — разметкой
 * на CSS: библиотека графиков в Mini App не едет ради одной полосы.
 *
 * О рефералах — ни имени, ни ника: строка говорит, когда пришёл и что
 * принёс, но не кто это. Правило то же, что у ядра, и экран его
 * только повторяет.
 */

const SOURCE_WORDS = { individual: 'личная ставка', tier: 'уровень', base: 'базовая' } as const;

/** Уровень и ставки по линиям — то, за что здесь платят. */
export function TierCard({ account }: { readonly account: BonusAccountView }) {
  const tier = account.tier;
  return (
    <div className="tier">
      <div className="tier__head">
        <span className="eyebrow">{tier ? 'Ваш уровень' : 'Ваши ставки'}</span>
        {tier ? (
          <span className="tier__name">{tier.current?.name ?? 'пока без уровня'}</span>
        ) : undefined}
      </div>
      {/*
        Ставка каждой линии — с источником: клиент с личной ставкой
        должен видеть, что она личная, иначе таблица уровней в подсказке
        врала бы ему в лицо.
      */}
      <ul className="tier__lines">
        {account.lines.map((line) => (
          <li key={line.line} className="tier__row">
            <span className="tier__line">
              {referralLineName(line.line)} линия
              <span className="tier__count"> · {line.count}</span>
            </span>
            <span className="tier__rate">
              {formatBps(line.rateBps)}
              <span className="tier__source">
                {' '}
                {line.source === 'tier' && line.tierName
                  ? `уровень «${line.tierName}»`
                  : SOURCE_WORDS[line.source]}
              </span>
            </span>
          </li>
        ))}
      </ul>
      {tier?.next ? (
        <div className="tier-progress">
          <div className="tier-progress__track">
            <div
              className="tier-progress__bar"
              style={{ width: `${Math.min(100, Math.round((tier.activeReferrals / tier.next.minActiveReferrals) * 100))}%` }}
            />
          </div>
          {/*
            «Активный» здесь — реферал первой линии с исполненной
            заявкой: так считается уровень. Плитка «стали активными» в
            статистике ниже считает по всем линиям — подпись у неё своя.
          */}
          <p className="tier-progress__note">
            {nextTierNote(tier.next.name, tier.toNext, tier.activeReferrals)}
          </p>
        </div>
      ) : tier?.current ? (
        <p className="tier-progress__note">{REFERRAL_TEXTS.topTier}</p>
      ) : undefined}
    </div>
  );
}

/** Статистика за период: плитки, столбики по дням, оборот приведённых. */
export function ReferralStats({ revisit }: { readonly revisit: number }) {
  const [period, setPeriod] = useState<PeriodKey>('30');
  const [stats, setStats] = useState<ReferralCabinetStats>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const { from, to, offsetMinutes } = periodRange(period);
        const query = new URLSearchParams({
          from: from.toISOString(),
          to: to.toISOString(),
          offset: String(offsetMinutes),
        });
        const reply = await get<{ stats: ReferralCabinetStats }>(`/api/referral-stats?${query}`);
        if (!alive) return;
        setStats(reply.stats);
        setError(undefined);
      } catch (failure) {
        if (!alive) return;
        setError(failure instanceof ApiError ? failure.message : 'Не удалось загрузить статистику');
      }
    })();
    return () => {
      alive = false;
    };
    // Период — свой запрос при смене фильтра; возвращение в раздел
    // перечитывает то же самое, как и остальной профиль.
  }, [period, revisit]);

  const current = stats?.current;
  const previous = stats?.previous;
  const peak = stats ? tallest(stats.byDay.map((day) => day.accrued)) : '0';

  return (
    <>
      <h2 className="section-title">Статистика</h2>
      <div className="filters" role="group" aria-label="За какой период">
        {PERIOD_FILTERS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setPeriod(id)}
            aria-pressed={period === id}
            className="filter"
          >
            {label}
          </button>
        ))}
      </div>

      {error ? <p className="error">{error}</p> : undefined}

      {current && previous ? (
        <>
          <div className="stat-grid">
            <StatTile label="Пришли" value={String(current.joined)} note={compareCount(current.joined, previous.joined)} />
            <StatTile
              label="Стали активными"
              value={String(current.activated)}
              note={activatedNote(current.activated, previous.activated)}
            />
            <StatTile
              label="Начислено"
              value={formatAmount(current.accrued)}
              note={{ tone: 'flat', text: previousNote(formatAmount(previous.accrued)) }}
            />
            <StatTile
              label="Выплачено"
              value={formatAmount(current.paid)}
              note={{ tone: 'flat', text: previousNote(formatAmount(previous.paid)) }}
            />
          </div>
          {stats.pending !== '0' ? <p className="muted">{pendingNote(formatAmount(stats.pending))}</p> : undefined}

          {/*
            Две недели по дням: столбик — начислено, число под ним —
            сколько пришло. Высота — доля от самого высокого дня, и
            пустые дни стоят нулями, а не пропусками.
          */}
          <div className="bars" role="img" aria-label="Начислено по дням за две недели">
            {stats.byDay.map((day) => (
              <div key={day.day} className="bar">
                <div className="bar__track">
                  <div className="bar__fill" style={{ height: `${barHeight(day.accrued, peak)}%` }} />
                </div>
                <span className={day.joined > 0 ? 'bar__joined' : 'bar__joined bar__joined--none'}>
                  {day.joined > 0 ? `+${day.joined}` : '·'}
                </span>
              </div>
            ))}
          </div>
          <p className="muted bars__note">{REFERRAL_TEXTS.barsNote}</p>

          <p className="muted">
            Оборот приведённых за период:{' '}
            {current.turnover.length === 0
              ? REFERRAL_TEXTS.noTurnover
              : current.turnover.map((line) => `${formatAmount(line.amount)} ${line.code}`).join(' · ')}
          </p>
        </>
      ) : error ? undefined : (
        <p className="muted">{REFERRAL_TEXTS.counting}</p>
      )}
    </>
  );
}

/** «Стали активными» считается по всем линиям, а уровень — по первой: подпись это различает. */
function activatedNote(current: number, previous: number): { tone: 'up' | 'down' | 'flat'; text: string } {
  const note = compareCount(current, previous);
  return { tone: note.tone, text: `${note.text} · ${REFERRAL_TEXTS.activatedNote}` };
}

function StatTile({
  label,
  value,
  note,
}: {
  readonly label: string;
  readonly value: string;
  readonly note: { readonly tone: 'up' | 'down' | 'flat'; readonly text: string };
}) {
  return (
    <div className="stat-tile">
      <span className="stat-tile__label">{label}</span>
      <span className="stat-tile__value">{value}</span>
      <span className={`stat-tile__note stat-tile__note--${note.tone}`}>{note.text}</span>
    </div>
  );
}

const FIRST_ROWS = 5;

/** Рефералы обезличенно: первые строки и лист со всеми. */
export function ReferralsBlock({ revisit }: { readonly revisit: number }) {
  const [page, setPage] = useState<MyReferralsPage | 'loading' | 'failed'>('loading');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    void get<{ page: MyReferralsPage }>(`/api/referrals?limit=${FIRST_ROWS}`)
      .then((reply) => {
        if (alive) setPage(reply.page);
      })
      .catch(() => {
        if (alive) setPage('failed');
      });
    return () => {
      alive = false;
    };
  }, [revisit]);

  // Загрузка, отказ и пустота — три разных состояния: «пока никого» при
  // отказе сети врало бы тому, у кого рефералы есть.
  if (page === 'loading') {
    return (
      <>
        <h2 className="section-title">Рефералы</h2>
        <p className="muted">{REFERRAL_TEXTS.counting}</p>
      </>
    );
  }
  if (page === 'failed') {
    return (
      <>
        <h2 className="section-title">Рефералы</h2>
        <p className="error">{REFERRAL_TEXTS.referralsFailed}</p>
      </>
    );
  }
  if (page.total === 0) {
    return (
      <>
        <h2 className="section-title">Рефералы</h2>
        <p className="muted">{REFERRAL_TEXTS.noReferrals}</p>
      </>
    );
  }

  return (
    <>
      <h2 className="section-title">Рефералы</h2>
      <ul className="rows">
        {page.items.map((one, index) => (
          <ReferralRow key={index} referral={one} />
        ))}
      </ul>
      {page.total > page.items.length ? (
        <button type="button" className="link link--block" onClick={() => setOpen(true)}>
          {allReferralsButton(page.total)}
        </button>
      ) : undefined}
      {open ? <ReferralsSheet total={page.total} onClose={() => setOpen(false)} /> : undefined}
    </>
  );
}

function ReferralRow({ referral }: { readonly referral: MyReferralView }) {
  // Заголовок — откуда пришёл; у линий глубже первой код чужой, и
  // строка называет только то, что своё: линию.
  const title = referral.via
    ? referral.via.kind === 'promo'
      ? `промокод ${referral.via.label}`
      : `ссылка «${referral.via.label}»`
    : 'из вашей сети';
  const sub = referralRowSub({
    line: referral.line,
    since: formatDay(referral.joinedAt).toLocaleLowerCase('ru'),
    completedCount: referral.completedCount,
    last: referral.lastExchangeAt ? formatDay(referral.lastExchangeAt).toLocaleLowerCase('ru') : null,
  });
  return (
    <li className="row">
      <span className="row__body">
        <span className="row__title">{title}</span>
        <span className="row__sub">{sub}</span>
      </span>
      <span className={referral.active ? 'row__amount' : 'row__amount row__amount--out'}>
        {referral.active ? `+${formatAmount(referral.brought)}` : '—'}
      </span>
    </li>
  );
}

function ReferralsSheet({ total, onClose }: { readonly total: number; readonly onClose: () => void }) {
  const [items, setItems] = useState<MyReferralView[]>([]);
  const [next, setNext] = useState<number | null>(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function loadMore() {
    if (next === null || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const reply = await get<{ page: MyReferralsPage }>(`/api/referrals?offset=${next}`);
      setItems((current) => [...current, ...reply.page.items]);
      setNext(reply.page.nextOffset);
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : REFERRAL_TEXTS.referralsFailed);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void loadMore();
    // Первая страница — при открытии; дальше по кнопке.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Sheet title={`Рефералы — ${total}`} onClose={onClose}>
      <ul className="rows">
        {items.map((one, index) => (
          <ReferralRow key={index} referral={one} />
        ))}
      </ul>
      {error ? <p className="error">{error}</p> : undefined}
      {next !== null ? (
        <div className="sheet__actions">
          <button type="button" className="btn btn--soft" disabled={busy} onClick={() => void loadMore()}>
            {busy ? 'Читаем…' : 'Показать ещё'}
          </button>
        </div>
      ) : undefined}
    </Sheet>
  );
}
