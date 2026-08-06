'use client';

import { useEffect, useState } from 'react';
import type { RequisitesView } from '@nemo/core';
import {
  looksLikeCardNumber,
  looksLikePhone,
  looksLikeWalletAddress,
  type RequisiteKind,
} from '@nemo/types';
import { ApiError, del, post } from '@/lib/client-api';
import { describeRequisites } from '@/lib/format';
import { REQUISITE_KIND_LABELS } from '@/lib/labels';
import { addressLabel, NetworkPicker } from './ui/network-picker';
import { ConfirmSheet } from './ui/sheet';

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
 *
 * Тот же лист служит двум делам: выбрать запись при подаче заявки и
 * вести их в профиле. Отличает их `onPick` — без него строки не
 * нажимаются, потому что выбирать в профиле нечего. Двух списков
 * реквизитов не бывает, и заводить второй ради отсутствующей кнопки
 * значило бы однажды поправить один и забыть другой.
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
  readonly selectedId?: string | undefined;
  /** Способы получения, которыми выдают эту валюту. */
  readonly kinds: readonly RequisiteKind[];
  readonly networks: readonly string[];
  /** Есть — лист выбирает запись; нет — просто ведёт список. */
  readonly onPick?: ((requisites: RequisitesView) => void) | undefined;
  readonly onSaved: (requisites: RequisitesView) => void;
  readonly onRemoved: (requisitesId: string) => void;
}) {
  // Форма открывается сразу, когда выбирать не из чего: лист с одной
  // кнопкой «добавить» — лишнее нажатие на пустом месте.
  const [adding, setAdding] = useState(requisites.length === 0);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  /**
   * Запись, о которой спрашивают перед удалением. Кнопка «Удалить»
   * стоит в строке рядом с самим выбором, и палец на телефоне попадает
   * в неё вместо записи.
   */
  const [removing, setRemoving] = useState<RequisitesView>();

  async function remove(requisitesId: string) {
    setError(undefined);
    setBusy(true);
    try {
      await del(`/api/requisites/${requisitesId}`);
      setRemoving(undefined);
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
        {onPick
          ? 'Деньги уйдут на выбранную запись. Номер карты и адрес кошелька хранятся зашифрованными — их видно только по краям.'
          : 'Записи, на которые сервис отправляет вам деньги: по ним приходит и обмен, и выплата баллов. Номер карты и адрес кошелька хранятся зашифрованными — их видно только по краям.'}
      </p>

      <ul className="rows">
        {requisites.map((one) => {
          const body = (
            <span className="row__body">
              <span className={one.isAvailable ? 'row__title' : 'row__title row__title--dim'}>
                {describeRequisites(one)}
              </span>
              <span className="row__sub">
                {one.isAvailable
                  ? REQUISITE_KIND_LABELS[one.kind]
                  : `${REQUISITE_KIND_LABELS[one.kind]} · сеть временно недоступна`}
              </span>
            </span>
          );

          return (
            <li key={one.id} className="row">
              {onPick ? (
                <button
                  type="button"
                  onClick={() => onPick(one)}
                  aria-pressed={one.id === selectedId}
                  // Кошелёк в погашенной сети выбрать нельзя, но он остаётся
                  // на месте: пропавшая сама запись выглядела бы потерей, а
                  // сеть могут включить обратно.
                  disabled={!one.isAvailable}
                  className="option option--flush"
                >
                  {body}
                </button>
              ) : (
                body
              )}
              <button
                type="button"
                onClick={() => setRemoving(one)}
                disabled={busy}
                className="link link--muted"
              >
                Удалить
              </button>
            </li>
          );
        })}
      </ul>

      {error ? <p className="error">{error}</p> : undefined}

      <div className="sheet__actions">
        <button type="button" onClick={() => setAdding(true)} className="btn btn--soft">
          Добавить реквизиты
        </button>
      </div>

      {removing ? (
        <ConfirmSheet
          title="Удалить реквизиты?"
          body={`${describeRequisites(removing)} — запись уйдёт из списка, и подать на неё новую заявку будет нельзя. Уже поданные останутся как есть: деньги по ним придут туда же.`}
          confirm={busy ? 'Удаляем…' : 'Удалить'}
          busy={busy}
          error={error}
          onConfirm={() => void remove(removing.id)}
          onClose={() => setRemoving(undefined)}
        />
      ) : undefined}
    </>
  );
}

/**
 * Номер карты группами по четыре — так он напечатан на пластике, с
 * которым его и сверяют. Лишние цифры отбрасываются на девятнадцатой:
 * длиннее карт не бывает, а набранное сверх — это уже не номер.
 */
function groupCardDigits(value: string): string {
  return value
    .replace(/\D/g, '')
    .slice(0, 19)
    .replace(/(\d{4})(?=\d)/g, '$1 ');
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
  /**
   * Досмотрел ли клиент поле до конца. Замечание показывается только
   * после этого: номер карты на четвёртой цифре не сходится по
   * контрольной сумме ни у кого, и красная строка под ним всё время
   * набора — это придирка, а не помощь.
   */
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    // Справочник сетей приходит отдельным запросом и может опоздать к
    // открытию формы. Без этого кнопки сетей появились бы, но ни одна не
    // была бы выбрана, и сохранение оставалось бы погашенным до нажатия
    // на ту сеть, которая и так подставилась бы сама.
    setNetwork((current) => current || (networks[0] ?? ''));
  }, [networks]);

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
   * Что не так с набранным — по тем же правилам, по которым откажет
   * операция. Своей копии правил здесь нет: они живут в доменных типах,
   * и разойтись с отказом ядра эта строка не может.
   *
   * Пустое поле замечания не получает: незаполненное — ещё не ошибка, и
   * кнопка о нём говорит тем, что не горит.
   */
  const complaint =
    kind === 'phone' && phone.trim() && !looksLikePhone(phone)
      ? 'В номере телефона от 10 до 15 цифр'
      : kind === 'card' && cardNumber.trim() && !looksLikeCardNumber(cardNumber)
        ? 'Номер не сходится по контрольной цифре — проверьте, не переставлены ли цифры'
        : kind === 'wallet' && address.trim() && !looksLikeWalletAddress(network, address)
          ? `Не похоже на адрес в сети ${network}: проверьте, целиком ли он скопирован`
          : undefined;

  /**
   * Кнопка гаснет, пока не заполнено всё, что нужно этому способу, и
   * пока набранное не похоже на правду: отказ операции на такой записи
   * читался бы как поломка, а не как «проверьте номер».
   */
  const ready = !complaint && Object.values(body()).every((value) => value.length > 0);

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
              onBlur={() => setChecked(true)}
              placeholder="+7"
              inputMode="tel"
              aria-invalid={checked && Boolean(complaint)}
              className={checked && complaint ? 'input input--wrong' : 'input'}
            />
          </label>
        ) : undefined}

        {kind === 'card' ? (
          <label className="field">
            <span className="field__label">Номер карты</span>
            <input
              value={cardNumber}
              // Цифры разбиваются по четыре прямо под пальцем: номер
              // сверяют с пластиком, а он напечатан группами. Сплошные
              // шестнадцать цифр приходится читать по одной.
              onChange={(event) => setCardNumber(groupCardDigits(event.target.value))}
              onBlur={() => setChecked(true)}
              placeholder="0000 0000 0000 0000"
              inputMode="numeric"
              autoComplete="cc-number"
              aria-invalid={checked && Boolean(complaint)}
              className={checked && complaint ? 'input input--wrong' : 'input'}
            />
          </label>
        ) : undefined}

        {kind === 'wallet' ? (
          <>
            <NetworkPicker
              networks={networks}
              selected={network}
              empty="Сети временно недоступны — напишите менеджеру, он отправит перевод вручную."
              onPick={setNetwork}
            />
            <label className="field">
              <span className="field__label">{addressLabel(network)}</span>
              <input
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                onBlur={() => setChecked(true)}
                placeholder="Адрес кошелька"
                aria-invalid={checked && Boolean(complaint)}
                className={checked && complaint ? 'input input--wrong' : 'input'}
              />
            </label>
          </>
        ) : undefined}
      </div>

      {/*
        Замечание к набранному — раньше сохранения, а не отказом после
        него. Отправленный по такому реквизиту перевод не возвращается, и
        поймать опечатку нужно здесь.
      */}
      {checked && complaint ? <p className="error">{complaint}</p> : undefined}

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
