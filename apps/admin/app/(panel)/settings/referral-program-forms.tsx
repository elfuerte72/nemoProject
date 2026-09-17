'use client';

import { useState } from 'react';
import type { ReferralProgramView, ReferralTierView, ServiceSettingsView } from '@nemo/core';
import { MAX_REFERRAL_DEPTH, referralLineTitle } from '@nemo/types';
import { decimalFromInput } from '@/lib/decimal-input';
import { bpsToPercent } from '@/lib/percent';
import {
  draftsToLines,
  linesToDrafts,
  tierDraftToInput,
  type TierDraft,
} from '@/lib/referral-program-forms';
import { useSettingsSend } from './use-settings-send';

/**
 * Реферальная программа: базовые ставки линий, уровни и порог вывода.
 *
 * Линии — списком: строк столько, сколько оплачивается, последнюю можно
 * убрать, пятую — добавить. Уровни — карточками, каждая сохраняется
 * отдельно: они независимы, и одна кнопка на все спрашивала бы
 * подтверждения того, чего администратор не трогал.
 */
export function ReferralProgramForms({
  program,
  settings,
}: {
  program: ReferralProgramView;
  settings: ServiceSettingsView;
}) {
  const { error, busy, send } = useSettingsSend();

  return (
    <>
      {error ? <p className="error">{error}</p> : undefined}
      {/*
        Ключ с глубиной и ставками: после сохранения страница перечитана,
        и черновики обязаны показать сохранённое — включая поле новой
        линии, которого до сохранения не было.
      */}
      <LinesCard key={programKey(program)} program={program} busy={busy} onSend={send} />
      <TiersCard program={program} busy={busy} onSend={send} />
      <WithdrawalCard settings={settings} busy={busy} onSend={send} />
    </>
  );
}

type Send = (path: string, body: unknown) => Promise<unknown>;

function programKey(program: ReferralProgramView): string {
  return program.lines.map((one) => `${one.line}:${one.rateBps}`).join(',');
}

function lineLabel(index: number): string {
  return `${referralLineTitle(index + 1)} линия`;
}

function LinesCard({ program, busy, onSend }: { program: ReferralProgramView; busy: boolean; onSend: Send }) {
  const [drafts, setDrafts] = useState<string[]>(() => linesToDrafts(program.lines));
  const lines = draftsToLines(drafts);

  return (
    <section className="card">
      <h2 className="card__title">Линии и базовые ставки</h2>
      <p className="card__note">
        Процент от дохода сервиса по заявке реферала; шаг — сотая процента. Сколько строк,
        столько линий оплачивается, не больше пяти. Уже сделанные начисления от смены
        ставок не меняются.
      </p>
      <div className="form-row">
        {drafts.map((draft, index) => (
          <label key={index} className="field">
            <span className="label">{lineLabel(index)}, %</span>
            <input
              className="input"
              value={draft}
              inputMode="decimal"
              onChange={(event) =>
                setDrafts((current) =>
                  current.map((one, at) => (at === index ? event.target.value : one)),
                )
              }
            />
          </label>
        ))}
      </div>
      <div className="row__actions">
        <button
          type="button"
          className="btn btn--ghost"
          disabled={busy || drafts.length >= MAX_REFERRAL_DEPTH}
          onClick={() => setDrafts((current) => [...current, ''])}
        >
          Добавить линию
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          // Первая линия — сама программа: без неё платить некому.
          disabled={busy || drafts.length <= 1}
          onClick={() => setDrafts((current) => current.slice(0, -1))}
        >
          Убрать последнюю
        </button>
        <button
          type="button"
          className="btn btn--gold"
          disabled={busy || lines === null}
          onClick={() => onSend('/api/referral-program', { action: 'lines', lines })}
        >
          Сохранить линии
        </button>
      </div>
    </section>
  );
}

function tierToDraft(tier: ReferralTierView, depth: number): TierDraft {
  return {
    id: tier.id,
    name: tier.name,
    threshold: String(tier.minActiveReferrals),
    rates: Array.from({ length: depth }, (_, index) => {
      const rate = tier.rates.find((one) => one.line === index + 1);
      return rate ? bpsToPercent(rate.rateBps) : '';
    }),
  };
}

function emptyTier(depth: number): TierDraft {
  return { name: '', threshold: '', rates: Array.from({ length: depth }, () => '') };
}

function TiersCard({ program, busy, onSend }: { program: ReferralProgramView; busy: boolean; onSend: Send }) {
  const [adding, setAdding] = useState(false);

  return (
    <section className="card">
      <div className="card__head">
        <div>
          <h2 className="card__title">Уровни</h2>
          <p className="card__note">
            Порог — активные рефералы первой линии: приведённые самим клиентом с хотя бы
            одной исполненной заявкой. Действует самый высокий из достигнутых. Пустая ставка
            линии наследует базовую.
          </p>
        </div>
        <div className="page__actions">
          <button
            type="button"
            className="btn btn--ghost"
            disabled={busy || adding}
            onClick={() => setAdding(true)}
          >
            Добавить уровень
          </button>
        </div>
      </div>

      {program.tiers.length === 0 && !adding ? (
        <p className="empty">Уровней нет: всем действуют базовые ставки.</p>
      ) : undefined}

      {program.tiers.map((tier) => (
        <TierEditor
          key={`${tier.id}:${program.depth}:${tier.rates.map((one) => one.rateBps).join(',')}`}
          initial={tierToDraft(tier, program.depth)}
          busy={busy}
          onSend={onSend}
        />
      ))}
      {adding ? (
        <TierEditor
          initial={emptyTier(program.depth)}
          busy={busy}
          onSend={onSend}
          onCancel={() => setAdding(false)}
        />
      ) : undefined}
    </section>
  );
}

function TierEditor({
  initial,
  busy,
  onSend,
  onCancel,
}: {
  initial: TierDraft;
  busy: boolean;
  onSend: Send;
  onCancel?: (() => void) | undefined;
}) {
  const [draft, setDraft] = useState<TierDraft>(initial);
  const [deleting, setDeleting] = useState(false);
  const input = tierDraftToInput(draft);

  return (
    <div className="tier-editor">
      <div className="form-row">
        <label className="field">
          <span className="label">Название</span>
          <input
            className="input"
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            placeholder="Серебро"
          />
        </label>
        <label className="field">
          <span className="label">Порог, активных рефералов</span>
          <input
            className="input"
            value={draft.threshold}
            inputMode="numeric"
            onChange={(event) => setDraft({ ...draft, threshold: event.target.value })}
          />
        </label>
        {draft.rates.map((rate, index) => (
          <label key={index} className="field">
            <span className="label">{lineLabel(index)}, %</span>
            <input
              className="input"
              value={rate}
              inputMode="decimal"
              placeholder="базовая"
              onChange={(event) =>
                setDraft({
                  ...draft,
                  rates: draft.rates.map((one, at) => (at === index ? event.target.value : one)),
                })
              }
            />
          </label>
        ))}
      </div>
      <div className="row__actions">
        <button
          type="button"
          className="btn btn--gold"
          disabled={busy || input === null}
          onClick={async () => {
            // Черновик нового уровня остаётся на экране, пока сервер не
            // принял его: отказ ядра словами стоит над формой.
            const saved = await onSend('/api/referral-program', { action: 'tier', ...input });
            if (saved) onCancel?.();
          }}
        >
          {draft.id ? 'Сохранить уровень' : 'Завести уровень'}
        </button>
        {onCancel ? (
          <button type="button" className="btn btn--ghost" disabled={busy} onClick={onCancel}>
            Отмена
          </button>
        ) : undefined}
        {draft.id ? (
          // Удаление спрашивает подтверждение раскрытием, а не гашением
          // кнопки: погашенная теряет фокус.
          <button
            type="button"
            className="btn btn--ghost"
            disabled={busy}
            onClick={() => setDeleting((open) => !open)}
          >
            Удалить
          </button>
        ) : undefined}
      </div>
      {deleting && draft.id ? (
        <div className="confirm">
          <p className="card__note">
            Уровень исчезнет, клиенты на нём перейдут на ставку ниже. Прошлые начисления не
            изменятся.
          </p>
          <button
            type="button"
            className="btn btn--danger"
            disabled={busy}
            onClick={() => onSend('/api/referral-program', { action: 'delete-tier', id: draft.id })}
          >
            Удалить уровень «{draft.name}»
          </button>
        </div>
      ) : undefined}
    </div>
  );
}

function WithdrawalCard({ settings, busy, onSend }: { settings: ServiceSettingsView; busy: boolean; onSend: Send }) {
  const [minWithdrawal, setMinWithdrawal] = useState<string>(settings.minWithdrawalAmount);
  return (
    <section className="card">
      <h2 className="card__title">Вывод баллов</h2>
      <p className="card__note">
        Ниже этого порога заявка на вывод не принимается; клиент видит порог рядом с балансом.
      </p>
      <div className="form-row">
        <label className="field">
          <span className="label">Минимум на вывод, баллов</span>
          <input
            className="input"
            value={minWithdrawal}
            onChange={(event) => setMinWithdrawal(event.target.value)}
            inputMode="decimal"
          />
        </label>
      </div>
      <div className="row__actions">
        <button
          type="button"
          disabled={busy}
          className="btn btn--gold"
          onClick={() =>
            onSend('/api/settings', { minWithdrawalAmount: decimalFromInput(minWithdrawal) })
          }
        >
          Сохранить
        </button>
      </div>
    </section>
  );
}
