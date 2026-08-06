'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { SaveServiceAccountInput, ServiceAccountView } from '@nemo/core';
import {
  looksLikeCardNumber,
  looksLikePhone,
  looksLikeWalletAddress,
  requisiteKindSuits,
  type CurrencyKind,
  type RequisiteKind,
} from '@nemo/types';
import { describeServiceAccount, pillClass, REQUISITE_KIND_LABELS } from '@/lib/labels';

/**
 * Ведение счетов сервиса (docs/adr/0008).
 *
 * Форма повторяет правила ядра — контрольную цифру карты, число цифр
 * телефона, форму адреса сети, — чтобы сказать об опечатке до
 * сохранения. Это не замена проверке: правило живёт в операции, а
 * форма его только повторяет.
 *
 * Способ приёма выбирается первым, и от него зависит, какие поля
 * показаны: у кошелька не бывает банка, и поле, которое всё равно
 * нельзя заполнить, только сбивает.
 */

const KIND_ORDER: readonly RequisiteKind[] = ['phone', 'card', 'wallet'];

/** Что набрано в форме. Одно поле на все способы: показывается нужное. */
interface Draft {
  kind: RequisiteKind;
  currencyCode: string;
  bankName: string;
  holderName: string;
  phone: string;
  cardNumber: string;
  network: string;
  address: string;
  note: string;
}

/**
 * Валюты, которые вообще приходят этим способом: рубли на карту и по
 * телефону, USDT на кошелёк. Правило то же, что в ядре и у клиента, —
 * своей копии здесь нет, и меняя способ, форма сама переставляет
 * валюту: карту в USDT операция отвергнет, и предлагать её незачем.
 */
function suitableCurrencies(
  currencies: readonly { readonly code: string; readonly kind: CurrencyKind }[],
  kind: RequisiteKind,
): readonly string[] {
  return currencies.filter((one) => requisiteKindSuits(kind, one.kind)).map((one) => one.code);
}

function firstSuitable(
  currencies: readonly { readonly code: string; readonly kind: CurrencyKind }[],
  kind: RequisiteKind,
): string {
  return suitableCurrencies(currencies, kind)[0] ?? '';
}

function emptyDraft(currencyCode: string, network: string): Draft {
  return {
    kind: 'phone',
    currencyCode,
    bankName: '',
    holderName: '',
    phone: '',
    cardNumber: '',
    network,
    address: '',
    note: '',
  };
}

/**
 * Что уйдёт в операцию. Собирается по способу: лишнее поле операция
 * отвергнет, а собранное здесь целиком — это ровно тот набор, который
 * держит ограничение базы.
 */
function saved(draft: Draft): SaveServiceAccountInput {
  const common = {
    currencyCode: draft.currencyCode,
    ...(draft.note.trim() ? { note: draft.note.trim() } : {}),
  };
  switch (draft.kind) {
    case 'phone':
      return {
        ...common,
        kind: 'phone',
        bankName: draft.bankName.trim(),
        holderName: draft.holderName.trim(),
        phone: draft.phone.trim(),
      };
    case 'card':
      return {
        ...common,
        kind: 'card',
        bankName: draft.bankName.trim(),
        holderName: draft.holderName.trim(),
        cardNumber: draft.cardNumber.trim(),
      };
    case 'wallet':
      return {
        ...common,
        kind: 'wallet',
        network: draft.network,
        address: draft.address.trim(),
      };
  }
}

/** Чего не хватает или что не сходится. Пусто — форму можно отправлять. */
function complaint(draft: Draft): string | undefined {
  if (!draft.currencyCode) return 'Выберите валюту';
  switch (draft.kind) {
    case 'phone':
      if (!draft.bankName.trim() || !draft.holderName.trim()) return 'Заполните банк и получателя';
      if (!looksLikePhone(draft.phone)) return 'В номере телефона должно быть от 10 до 15 цифр';
      return undefined;
    case 'card':
      if (!draft.bankName.trim() || !draft.holderName.trim()) return 'Заполните банк и получателя';
      if (!looksLikeCardNumber(draft.cardNumber))
        return 'Номер карты не сходится по контрольной цифре';
      return undefined;
    case 'wallet':
      if (!draft.network) return 'Выберите сеть';
      if (!looksLikeWalletAddress(draft.network, draft.address))
        return `Адрес не похож на адрес сети ${draft.network}`;
      return undefined;
  }
}

export function ServiceAccountForms({
  accounts,
  currencies,
  networks,
  canEdit,
}: {
  accounts: readonly ServiceAccountView[];
  currencies: readonly { readonly code: string; readonly kind: CurrencyKind }[];
  networks: readonly string[];
  /** Ведёт список администратор; менеджер его только читает. */
  canEdit: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft>(() =>
    emptyDraft(firstSuitable(currencies, 'phone'), networks[0] ?? ''),
  );
  /** Какой счёт правится. Пусто — форма заводит новый. */
  const [editing, setEditing] = useState<string>();

  async function send(body: unknown): Promise<boolean> {
    setError(undefined);
    setBusy(true);
    try {
      const response = await fetch('/api/service-accounts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const refusal = (await response.json()) as { error?: string };
        setError(refusal.error ?? 'Счёт не сохранён');
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError('Не удалось связаться с сервером. Повторите попытку.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const account = saved(draft);
    const ok = await send(
      editing ? { action: 'update', accountId: editing, account } : { action: 'add', account },
    );
    if (ok) {
      setDraft(emptyDraft(firstSuitable(currencies, 'phone'), networks[0] ?? ''));
      setEditing(undefined);
    }
  }

  /**
   * Взять счёт в правку. Номер карты и адрес не подставляются: панель
   * их не знает — она видит последние цифры и края адреса. Правка
   * поэтому требует набрать номер заново, и это честно: сохранённый
   * наполовину счёт был бы счётом, по которому платят наугад.
   */
  function edit(account: ServiceAccountView) {
    setEditing(account.id);
    setError(undefined);
    setDraft({
      kind: account.kind,
      currencyCode: account.currencyCode,
      bankName: account.bankName ?? '',
      holderName: account.holderName ?? '',
      phone: account.phone ?? '',
      cardNumber: '',
      network: account.network ?? networks[0] ?? '',
      address: '',
      note: account.note ?? '',
    });
  }

  const wrong = complaint(draft);

  return (
    <>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : undefined}

      {canEdit ? (
        <section className="card">
          <h2 className="card__title">{editing ? 'Правка счёта' : 'Новый счёт'}</h2>
          <p className="card__note">
            Валюта — та, которой клиент платит по заявке: счёт не в той валюте до
            менеджера не дойдёт. Номер карты и адрес кошелька хранятся зашифрованными и
            обратно в эту форму не подставляются — правя счёт, наберите номер заново.
          </p>

          <div className="form-row">
            {/*
              Способ — поле пошире: «перевод по номеру телефона» в
              колонку на сто семьдесят пикселей не помещается, а
              обрезанное название способа приёма читается наугад.
            */}
            <label className="field field--wide">
              <span className="label">Способ</span>
              <select
                className="input"
                value={draft.kind}
                onChange={(event) => {
                  const kind = event.target.value as RequisiteKind;
                  // Валюта переставляется вместе со способом: рубли на
                  // кошелёк не приходят, и оставленная от карты валюта
                  // вернулась бы отказом операции.
                  const codes = suitableCurrencies(currencies, kind);
                  setDraft({
                    ...draft,
                    kind,
                    currencyCode: codes.includes(draft.currencyCode)
                      ? draft.currencyCode
                      : (codes[0] ?? ''),
                  });
                }}
              >
                {KIND_ORDER.map((kind) => (
                  <option key={kind} value={kind}>
                    {REQUISITE_KIND_LABELS[kind]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field field--narrow">
              <span className="label">Валюта</span>
              <select
                className="input"
                value={draft.currencyCode}
                onChange={(event) => setDraft({ ...draft, currencyCode: event.target.value })}
              >
                {suitableCurrencies(currencies, draft.kind).map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {draft.kind === 'wallet' ? (
            <div className="form-row">
              <label className="field field--narrow">
                <span className="label">Сеть</span>
                <select
                  className="input"
                  value={draft.network}
                  onChange={(event) => setDraft({ ...draft, network: event.target.value })}
                >
                  {networks.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="label">Адрес кошелька</span>
                <input
                  className="input mono"
                  value={draft.address}
                  onChange={(event) => setDraft({ ...draft, address: event.target.value })}
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
            </div>
          ) : (
            <>
              <div className="form-row">
                <label className="field">
                  <span className="label">Банк</span>
                  <input
                    className="input"
                    value={draft.bankName}
                    onChange={(event) => setDraft({ ...draft, bankName: event.target.value })}
                  />
                </label>
                <label className="field">
                  <span className="label">Получатель — его имя увидит клиент</span>
                  <input
                    className="input"
                    value={draft.holderName}
                    onChange={(event) => setDraft({ ...draft, holderName: event.target.value })}
                  />
                </label>
              </div>
              <label className="field">
                <span className="label">
                  {draft.kind === 'phone' ? 'Телефон для перевода' : 'Номер карты'}
                </span>
                <input
                  className="input mono"
                  value={draft.kind === 'phone' ? draft.phone : draft.cardNumber}
                  onChange={(event) =>
                    setDraft(
                      draft.kind === 'phone'
                        ? { ...draft, phone: event.target.value }
                        : { ...draft, cardNumber: event.target.value },
                    )
                  }
                  inputMode={draft.kind === 'phone' ? 'tel' : 'numeric'}
                  autoComplete="off"
                />
              </label>
            </>
          )}

          <label className="field">
            <span className="label">Заметка менеджеру — чем этот счёт отличается</span>
            <input
              className="input"
              value={draft.note}
              onChange={(event) => setDraft({ ...draft, note: event.target.value })}
            />
          </label>

          <div className="row__actions">
            {/*
              Кнопка гаснет на том, что операция всё равно отвергнет, и
              рядом сказано, чего не хватает: отказ после нажатия
              читается как поломка, а не как «поправьте поле».
            */}
            <button
              type="button"
              disabled={busy || wrong !== undefined}
              className="btn btn--gold"
              onClick={() => void save()}
            >
              {editing ? 'Сохранить счёт' : 'Завести счёт'}
            </button>
            {editing ? (
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => {
                  setEditing(undefined);
                  setDraft(emptyDraft(firstSuitable(currencies, 'phone'), networks[0] ?? ''));
                }}
              >
                Отменить правку
              </button>
            ) : undefined}
            {wrong ? <span className="row__meta">{wrong}</span> : undefined}
          </div>
        </section>
      ) : undefined}

      <section className="section">
        <div className="section__head">
          <h2 className="section__title">Счета</h2>
          <span className="section__count">{accounts.length}</span>
          <span className="section__rule" />
        </div>

        {accounts.length === 0 ? (
          <p className="empty">
            Счетов ещё нет. Пока их нет, менеджеру нечего выдать клиенту по заявке —
            заведите хотя бы один на каждую валюту, которой у вас платят.
          </p>
        ) : (
          <ul className="rows">
            {accounts.map((account) => (
              <li key={account.id} className="row row--stack">
                <div className="row__side" style={{ justifyContent: 'space-between' }}>
                  <div className="row__main">
                    <span className="row__title">
                      {account.currencyCode} · {REQUISITE_KIND_LABELS[account.kind]}
                    </span>
                    <span className="row__meta mono">{describeServiceAccount(account)}</span>
                    {account.note ? (
                      <span className="row__meta">{account.note}</span>
                    ) : undefined}
                  </div>
                  <div className="row__side">
                    {account.isActive ? undefined : (
                      <span className={pillClass('off')}>Погашен</span>
                    )}
                    {canEdit ? (
                      <>
                        <button
                          type="button"
                          className="btn btn--ghost"
                          disabled={busy}
                          onClick={() => edit(account)}
                        >
                          Править
                        </button>
                        <button
                          type="button"
                          className="btn btn--ghost"
                          disabled={busy}
                          onClick={() =>
                            void send({
                              action: 'set-active',
                              accountId: account.id,
                              isActive: !account.isActive,
                            })
                          }
                        >
                          {account.isActive ? 'Погасить' : 'Включить'}
                        </button>
                      </>
                    ) : undefined}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
