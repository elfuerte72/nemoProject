'use client';

import { useState } from 'react';
import type { RequisitesView } from '@nemo/core';
import type { RequisiteKind } from '@nemo/types';
import { ApiError, del, post } from '@/lib/client-api';
import { describeRequisites } from '@/lib/format';
import { REQUISITE_KIND_LABELS } from '@/lib/labels';

/**
 * Куда клиенту отправить деньги.
 *
 * Сначала способ получения, потом его поля — и все они обязательны:
 * записи, по которой нельзя отправить деньги, не существует. Раньше
 * форма показывала три поля подряд и ни одного обязательного, и клиент
 * гадал, что заполнять.
 *
 * Сохранённый номер клиенту больше не показывается — только последние
 * четыре цифры карты и края адреса: полное значение расшифровывает лишь
 * админ-панель (docs/adr/0002). Поэтому «изменить» здесь означает
 * «завести новую запись», а не «поправить существующую».
 */
export function RequisitesSheet({
  requisites,
  selectedId,
  kinds,
  networks,
  onPick,
  onSaved,
  onRemoved,
}: {
  /** Записи, подходящие валюте, которую клиент получает. */
  readonly requisites: readonly RequisitesView[];
  readonly selectedId: string | undefined;
  /** Способы получения, которыми выдают эту валюту. */
  readonly kinds: readonly RequisiteKind[];
  readonly networks: readonly string[];
  readonly onPick: (requisites: RequisitesView) => void;
  readonly onSaved: (requisites: RequisitesView) => void;
  readonly onRemoved: (requisitesId: string) => void;
}) {
  // Форма открывается сразу, когда выбирать не из чего: лист с одной
  // кнопкой «добавить» — лишнее нажатие на пустом месте.
  const [adding, setAdding] = useState(requisites.length === 0);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function remove(requisitesId: string) {
    setError(undefined);
    setBusy(true);
    try {
      await del(`/api/requisites/${requisitesId}`);
      onRemoved(requisitesId);
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Не удалось удалить реквизиты');
    } finally {
      setBusy(false);
    }
  }

  if (adding) {
    return (
      <RequisitesForm
        kinds={kinds}
        networks={networks}
        onSaved={(saved) => {
          setAdding(false);
          onSaved(saved);
        }}
        onCancel={requisites.length === 0 ? undefined : () => setAdding(false)}
      />
    );
  }

  return (
    <>
      <p className="sheet__body">
        Деньги уйдут на выбранную запись. Номер карты и адрес кошелька хранятся
        зашифрованными — их видно только по краям.
      </p>

      <ul className="rows">
        {requisites.map((one) => (
          <li key={one.id} className="row">
            <button
              type="button"
              onClick={() => onPick(one)}
              aria-pressed={one.id === selectedId}
              className="option option--flush"
            >
              <span className="row__body">
                <span className="row__title">{describeRequisites(one)}</span>
                <span className="row__sub">{REQUISITE_KIND_LABELS[one.kind]}</span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => void remove(one.id)}
              disabled={busy}
              className="link link--muted"
            >
              Удалить
            </button>
          </li>
        ))}
      </ul>

      {error ? <p className="error">{error}</p> : undefined}

      <div className="sheet__actions">
        <button type="button" onClick={() => setAdding(true)} className="btn btn--soft">
          Добавить реквизиты
        </button>
      </div>
    </>
  );
}

/** Ввод новой записи: сначала способ, потом ровно его поля. */
function RequisitesForm({
  kinds,
  networks,
  onSaved,
  onCancel,
}: {
  readonly kinds: readonly RequisiteKind[];
  readonly networks: readonly string[];
  readonly onSaved: (requisites: RequisitesView) => void;
  readonly onCancel: (() => void) | undefined;
}) {
  const [kind, setKind] = useState<RequisiteKind>(kinds[0] ?? 'card');
  const [bankName, setBankName] = useState('');
  const [phone, setPhone] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [network, setNetwork] = useState(networks[0] ?? '');
  const [address, setAddress] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  /** Что отправлять — решает выбранный способ, а не то, что осталось в полях. */
  function body(): Record<string, string> {
    switch (kind) {
      case 'phone':
        return { kind, bankName: bankName.trim(), phone: phone.trim() };
      case 'card':
        return { kind, bankName: bankName.trim(), cardNumber: cardNumber.trim() };
      case 'wallet':
        return { kind, network, address: address.trim() };
    }
  }

  /**
   * Кнопка гаснет, пока не заполнено всё, что нужно этому способу:
   * отказ операции на неполной записи читался бы как поломка, а не как
   * «заполните поля».
   */
  const ready = Object.values(body()).every((value) => value.length > 0);

  async function save() {
    setError(undefined);
    setBusy(true);
    try {
      const saved = await post<{ requisites: RequisitesView }>('/api/requisites', body());
      onSaved(saved.requisites);
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Не удалось сохранить реквизиты');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className="sheet__body">
        Выберите способ получения — дальше приложение спросит ровно то, что нужно для
        него. Номер карты и адрес кошелька сохранятся зашифрованными: дальше вы будете
        видеть только их края.
      </p>

      {/*
        Выбор способа не показывается, когда способ один: валюту выдают
        либо на кошелёк, либо на карту и по телефону, и переключатель без
        альтернативы обещал бы выбор, которого нет.
      */}
      {kinds.length > 1 ? (
        <div className="options">
          {kinds.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setKind(value)}
              aria-pressed={kind === value}
              className="option"
            >
              {REQUISITE_KIND_LABELS[value]}
            </button>
          ))}
        </div>
      ) : undefined}

      <div className="form">
        {kind === 'phone' || kind === 'card' ? (
          <label className="field">
            <span className="field__label">Банк</span>
            <input
              value={bankName}
              onChange={(event) => setBankName(event.target.value)}
              placeholder="Например, Сбербанк"
              className="input"
            />
          </label>
        ) : undefined}

        {kind === 'phone' ? (
          <label className="field">
            <span className="field__label">Телефон для перевода</span>
            <input
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="+7"
              inputMode="tel"
              className="input"
            />
          </label>
        ) : undefined}

        {kind === 'card' ? (
          <label className="field">
            <span className="field__label">Номер карты</span>
            <input
              value={cardNumber}
              onChange={(event) => setCardNumber(event.target.value)}
              placeholder="0000 0000 0000 0000"
              inputMode="numeric"
              autoComplete="cc-number"
              className="input"
            />
          </label>
        ) : undefined}

        {kind === 'wallet' ? (
          <>
            {/*
              Сеть спрашивается до адреса и остаётся видна рядом с ним:
              адрес в разных сетях выглядит одинаково, а перевод не в ту
              не возвращается.
            */}
            <div className="field">
              <span className="field__label">Сеть</span>
              {networks.length === 0 ? (
                <p className="hint">
                  Сети временно недоступны — напишите менеджеру, он отправит перевод
                  вручную.
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
            <label className="field">
              <span className="field__label">
                {network ? `Адрес кошелька в сети ${network}` : 'Адрес кошелька'}
              </span>
              <input
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                placeholder="Адрес кошелька"
                className="input"
              />
            </label>
          </>
        ) : undefined}
      </div>

      {error ? <p className="error">{error}</p> : undefined}

      <div className="sheet__actions">
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy || !ready}
          className="btn btn--gold"
        >
          Сохранить реквизиты
        </button>
        {onCancel ? (
          <button type="button" onClick={onCancel} className="btn btn--soft">
            К списку
          </button>
        ) : undefined}
      </div>
    </>
  );
}
