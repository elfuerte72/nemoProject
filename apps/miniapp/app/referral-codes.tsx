'use client';

import { useState } from 'react';
import type { BonusAccountView, ReferralCodeStats, ReferralCodeView } from '@nemo/core';
import type { ReferralCodeKind } from '@nemo/types';
import { ApiError, post } from '@/lib/client-api';
import { formatAmount } from '@/lib/format';
import { codeLink, newCodeObstacle, shareUrl } from '@/lib/referral-codes-view';
import { REFERRAL_TEXTS } from '@/lib/referral-texts';
import { haptic, openTelegram } from '@/lib/telegram/webapp';
import { TrashIcon } from './ui/icons';
import { ConfirmSheet, NoticeSheet, Sheet } from './ui/sheet';
import { SwipeRow } from './ui/swipe-row';
import { useCopied } from './ui/use-copied';

/**
 * Ссылки и промокоды клиента: чем звать и откуда приходят.
 *
 * Кодов несколько, у каждого название — статистика по нему говорит,
 * что сработало: сторис или канал. Ссылка копируется, показывается
 * QR-кодом и пересылается в Telegram; промокод — слово, его называют
 * голосом. Архив — знаком в ряду и смахиванием, с подтверждением
 * листом, как у реквизита; последняя ссылка не архивируется — правило
 * ядра, экран его лишь повторяет, не рисуя знак.
 *
 * «Есть промокод?» — пока клиент чист: ни реферера, ни заявок. Признак
 * приходит со счётом, решает всё равно операция.
 */

type SheetState =
  | { readonly kind: 'add' }
  | { readonly kind: 'qr'; readonly code: ReferralCodeView }
  | { readonly kind: 'archive'; readonly code: ReferralCodeView }
  | { readonly kind: 'notice'; readonly title: string; readonly body: string };

export function CodesBlock({
  account,
  codeStats,
  onChanged,
}: {
  readonly account: BonusAccountView;
  /** Статистика по кодам за выбранный период — из сводки, если уже пришла. */
  readonly codeStats?: readonly ReferralCodeStats[] | undefined;
  /** Счёт перечитать: код добавлен, убран или введён чужой промокод. */
  readonly onChanged: () => void;
}) {
  const [sheet, setSheet] = useState<SheetState>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const { copied, copy } = useCopied();
  const links = account.codes.filter((one) => one.kind === 'link');

  function shareCode(code: ReferralCodeView) {
    const link = codeLink(code);
    if (link) openTelegram(shareUrl(link, REFERRAL_TEXTS.shareText));
  }

  async function archive(code: ReferralCodeView) {
    setBusy(true);
    setError(undefined);
    try {
      await post(`/api/referral-codes/${code.id}/archive`);
      haptic('success');
      setSheet(undefined);
      onChanged();
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Не удалось убрать код');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h2 className="section-title">Ссылки и промокоды</h2>
      <ul className="rows">
        {account.codes.map((code) => {
          const link = codeLink(code);
          const stats = codeStats?.find((one) => one.id === code.id);
          const removable = code.kind === 'promo' || links.length > 1;
          const body = (
            <span className="row__body">
              <span className="row__title">
                {code.label}
                {code.kind === 'promo' ? <span className="row__tag"> промокод</span> : undefined}
              </span>
              <span className="row__sub row__sub--wrap">{link ? link.replace('https://', '') : code.code}</span>
              {stats ? (
                <span className="row__sub">
                  пришли {stats.joined} · начислено {formatAmount(stats.accrued)}
                </span>
              ) : undefined}
              <span className="code-actions">
                <button
                  type="button"
                  className="chip-btn"
                  onClick={() => copy(link ?? code.code)}
                >
                  {copied ? 'Скопировано' : 'Копировать'}
                </button>
                {link ? (
                  <>
                    <button type="button" className="chip-btn" onClick={() => setSheet({ kind: 'qr', code })}>
                      QR
                    </button>
                    <button type="button" className="chip-btn" onClick={() => shareCode(code)}>
                      Поделиться
                    </button>
                  </>
                ) : undefined}
              </span>
            </span>
          );
          return removable ? (
            <SwipeRow key={code.id} action="Убрать" onAction={() => setSheet({ kind: 'archive', code })} disabled={busy}>
              {body}
              <button
                type="button"
                onClick={() => setSheet({ kind: 'archive', code })}
                disabled={busy}
                aria-label={`Убрать: ${code.label}`}
                className="row__remove"
              >
                <TrashIcon />
              </button>
            </SwipeRow>
          ) : (
            <li key={code.id} className="row">
              {body}
            </li>
          );
        })}
      </ul>

      {error && !sheet ? <p className="error">{error}</p> : undefined}

      <div className="sheet__actions">
        <button type="button" onClick={() => setSheet({ kind: 'add' })} className="btn btn--soft">
          Добавить ссылку или промокод
        </button>
      </div>

      {account.canEnterPromo ? (
        <PromoEntry
          onBound={() => {
            setSheet({ kind: 'notice', title: 'Промокод принят', body: REFERRAL_TEXTS.promoAccepted });
            onChanged();
          }}
        />
      ) : undefined}

      {sheet?.kind === 'add' ? (
        <AddCodeSheet
          onClose={() => setSheet(undefined)}
          onAdded={() => {
            setSheet(undefined);
            onChanged();
          }}
        />
      ) : undefined}

      {sheet?.kind === 'qr' ? (
        <Sheet title={sheet.code.label} onClose={() => setSheet(undefined)}>
          {/*
            Картинку рисует сервер: библиотека в бандл не едет, а адрес
            публичен — ссылка и так уходит в чужие чаты.
          */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="qr" src={`/api/referral-qr/${encodeURIComponent(sheet.code.code)}`} alt="QR-код ссылки" />
          <p className="sheet__body">{codeLink(sheet.code)?.replace('https://', '')}</p>
          <div className="sheet__actions">
            <button type="button" className="btn btn--gold" onClick={() => shareCode(sheet.code)}>
              Переслать в Telegram
            </button>
          </div>
        </Sheet>
      ) : undefined}

      {sheet?.kind === 'archive' ? (
        <ConfirmSheet
          title={sheet.code.kind === 'promo' ? 'Убрать промокод?' : 'Убрать ссылку?'}
          body={REFERRAL_TEXTS.archiveBody}
          confirm={busy ? 'Убираем…' : 'Убрать'}
          busy={busy}
          error={error}
          onConfirm={() => void archive(sheet.code)}
          onClose={() => setSheet(undefined)}
        />
      ) : undefined}

      {sheet?.kind === 'notice' ? (
        <NoticeSheet title={sheet.title} body={sheet.body} onClose={() => setSheet(undefined)} />
      ) : undefined}
    </>
  );
}

function AddCodeSheet({ onClose, onAdded }: { readonly onClose: () => void; readonly onAdded: () => void }) {
  const [kind, setKind] = useState<ReferralCodeKind>('link');
  const [label, setLabel] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const obstacle = newCodeObstacle({ kind, label, code });
  const touched = label.length > 0 || code.length > 0;

  async function submit() {
    if (obstacle) return;
    setBusy(true);
    setError(undefined);
    try {
      await post('/api/referral-codes', { kind, label, ...(kind === 'promo' ? { code } : {}) });
      haptic('success');
      onAdded();
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Не удалось завести код');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="Новый код" onClose={onClose}>
      <div className="segment" role="group" aria-label="Что завести">
        <button type="button" className="segment__item" aria-pressed={kind === 'link'} onClick={() => setKind('link')}>
          Ссылка
        </button>
        <button type="button" className="segment__item" aria-pressed={kind === 'promo'} onClick={() => setKind('promo')}>
          Промокод
        </button>
      </div>
      <p className="sheet__body">{kind === 'link' ? REFERRAL_TEXTS.newLink : REFERRAL_TEXTS.newPromo}</p>
      <label className="field">
        <span className="field__label">Название</span>
        <input
          className="input"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder={kind === 'link' ? 'Сторис' : 'Друзьям'}
          maxLength={40}
        />
      </label>
      {kind === 'promo' ? (
        <label className="field">
          <span className="field__label">Слово</span>
          <input
            className="input"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="SUMMER26"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            maxLength={16}
          />
        </label>
      ) : undefined}
      {touched && obstacle ? <p className="notice">{obstacle}</p> : undefined}
      {error ? <p className="error">{error}</p> : undefined}
      <div className="sheet__actions">
        <button type="button" className="btn btn--gold" disabled={busy || obstacle !== null} onClick={() => void submit()}>
          {busy ? 'Заводим…' : kind === 'link' ? 'Завести ссылку' : 'Завести промокод'}
        </button>
      </div>
    </Sheet>
  );
}

function PromoEntry({ onBound }: { readonly onBound: () => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function apply() {
    setBusy(true);
    setError(undefined);
    try {
      await post('/api/promo', { code });
      haptic('success');
      setCode('');
      onBound();
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Не удалось применить промокод');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="promo-entry">
      <span className="tile__label">Есть промокод?</span>
      <p className="muted">{REFERRAL_TEXTS.promoHint}</p>
      <div className="promo-entry__row">
        <input
          className="input"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="Слово от знакомого"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
        />
        <button type="button" className="btn btn--soft" disabled={busy || code.trim().length === 0} onClick={() => void apply()}>
          {busy ? '…' : 'Применить'}
        </button>
      </div>
      {error ? <p className="error">{error}</p> : undefined}
    </div>
  );
}
