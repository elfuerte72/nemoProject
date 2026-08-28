'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { RequisitesView } from '@nemo/core';
import {
  alipayQrHint,
  looksLikeAlipayAccount,
  looksLikeAlipayQr,
  looksLikeCardNumber,
  looksLikeHolderName,
  looksLikePhone,
  looksLikeThaiAccountNumber,
  looksLikeWalletAddress,
  parsePromptPay,
  promptPayHint,
  REQUISITE_COMPLAINTS,
  requisiteCurrencyCodes,
  requisiteKindsFor,
  type PromptPayIdType,
  type RequisiteKind,
} from '@nemo/types';
import { ApiError, del, post } from '@/lib/client-api';
import { currencyName, currencyPlace, sortCurrencies } from '@/lib/currencies';
import { describeRequisites, PROMPTPAY_ID_LABELS } from '@/lib/format';
import { REQUISITE_KIND_LABELS } from '@/lib/labels';
import { CurrencyFlag } from './ui/flags';
import { TrashIcon } from './ui/icons';
import { addressLabel, NetworkPicker } from './ui/network-picker';
import { ConfirmSheet } from './ui/sheet';
import { SwipeRow } from './ui/swipe-row';

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
  currency,
  networks,
  onPick,
  onSaved,
  onRemoved,
}: {
  /** Записи, подходящие валюте, которую клиент получает. */
  readonly requisites: readonly RequisitesView[];
  readonly selectedId?: string | undefined;
  /**
   * Валюта получения, если она уже известна — при подаче заявки. В
   * профиле её нет, и форма спрашивает валюту первой: способов стало
   * семь, и выбирать среди них без подсказки, какой к чему, нельзя.
   */
  readonly currency?: string | undefined;
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
   * Запись, о которой спрашивают перед удалением. Спрашивают и с кнопки
   * в строке, и с плашки, выехавшей на свайп: удаление необратимо, а
   * знак удаления стоит рядом с самим выбором — палец на телефоне
   * попадает в него вместо записи.
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
        currency={currency}
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
          ? 'Деньги уйдут на выбранную запись. Номера, адреса и QR хранятся зашифрованными — их видно только по краям.'
          : 'Записи, на которые сервис отправляет вам деньги: по ним приходит и обмен, и выплата баллов. Номера, адреса и QR хранятся зашифрованными — их видно только по краям.'}
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
            <SwipeRow
              key={one.id}
              action="Удалить"
              onAction={() => setRemoving(one)}
              disabled={busy}
            >
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
                aria-label={`Удалить: ${describeRequisites(one)}`}
                className="row__remove"
              >
                <TrashIcon />
              </button>
            </SwipeRow>
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

/** Что распозналось из картинки — клиент подтверждает это перед сохранением. */
type QrReading =
  | {
      readonly kind: 'promptpay';
      readonly payload: string;
      readonly idType: PromptPayIdType;
      /** Хвост — тот же, под которым запись встанет в список. */
      readonly hint: string;
    }
  | { readonly kind: 'alipay_qr'; readonly payload: string; readonly hint: string };

/**
 * Ввод новой записи: валюта, способ, ровно его поля.
 *
 * Валюта спрашивается первой, когда она не известна заранее: под неё
 * показываются только её способы. Какие — говорит таблица в доменных
 * типах, та же, по которой отказывает операция.
 *
 * QR читается здесь, на телефоне: клиент выбирает скриншот из галереи,
 * браузер вынимает из картинки строку, и на сервер уходит только она.
 * Библиотека чтения грузится в момент показа поля, чтобы первый экран
 * её не вёз. Что распозналось — тип идентификатора и его хвост —
 * показывается на подтверждение: картинка не та, и клиент увидит это
 * до сохранения, а не в переписке с менеджером.
 */
function RequisitesForm({
  currency,
  networks,
  onSaved,
  onCancel,
}: {
  readonly currency: string | undefined;
  readonly networks: readonly string[];
  readonly onSaved: (requisites: RequisitesView) => void;
  readonly onCancel: (() => void) | undefined;
}) {
  const currencies = useMemo(() => sortCurrencies(requisiteCurrencyCodes()), []);
  const [code, setCode] = useState(currency ?? '');
  const kinds = useMemo(() => requisiteKindsFor(code), [code]);
  const [kind, setKind] = useState<RequisiteKind | undefined>(kinds[0]);
  const [bankName, setBankName] = useState('');
  const [phone, setPhone] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [network, setNetwork] = useState(networks[0] ?? '');
  const [address, setAddress] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [holderName, setHolderName] = useState('');
  const [alipayAccount, setAlipayAccount] = useState('');
  const [qr, setQr] = useState<QrReading>();
  /** Чем картинка не подошла — словами, тут же под кнопкой выбора. */
  const [qrComplaint, setQrComplaint] = useState<string>();
  const [reading, setReading] = useState(false);
  /**
   * Номер попытки чтения. Смена рода или валюты, пока картинка
   * читается, обесценивает результат: иначе «Распознано: PromptPay…»
   * встало бы под полем Alipay.
   */
  const attempt = useRef(0);
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
    // Способ следует за валютой: у батов свои роды, у рублей свои, и
    // выбранный под одну валюту под другой не существует.
    setKind((current) => (current && kinds.includes(current) ? current : kinds[0]));
  }, [kinds]);

  useEffect(() => {
    // Библиотека чтения QR подгружается при показе поля, а не при
    // выборе картинки: между выбором файла и ответом не должно быть
    // сетевого круга. Первый экран её всё равно не везёт.
    if (kind === 'promptpay' || kind === 'alipay_qr') void import('@/lib/qr');
  }, [kind]);

  useEffect(() => {
    // Справочник сетей приходит отдельным запросом и может опоздать к
    // открытию формы. Без этого кнопки сетей появились бы, но ни одна не
    // была бы выбрана, и сохранение оставалось бы погашенным до нажатия
    // на ту сеть, которая и так подставилась бы сама.
    setNetwork((current) => current || (networks[0] ?? ''));
  }, [networks]);

  /** Что отправлять — решает выбранный способ, а не то, что осталось в полях. */
  function body(): Record<string, string> | undefined {
    switch (kind) {
      case 'phone':
        return { kind, bankName: bankName.trim(), phone: phone.trim() };
      case 'card':
        return { kind, bankName: bankName.trim(), cardNumber: cardNumber.trim() };
      case 'wallet':
        return { kind, network, address: address.trim() };
      case 'account':
        return {
          kind,
          bankName: bankName.trim(),
          accountNumber: accountNumber.trim(),
          holderName: holderName.trim(),
        };
      case 'promptpay':
        return { kind, qr: qr?.kind === 'promptpay' ? qr.payload : '', holderName: holderName.trim() };
      case 'alipay':
        return { kind, account: alipayAccount.trim(), holderName: holderName.trim() };
      case 'alipay_qr':
        return { kind, qr: qr?.kind === 'alipay_qr' ? qr.payload : '', holderName: holderName.trim() };
      case undefined:
        return undefined;
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
  const needsHolder = kind === 'account' || kind === 'promptpay' || kind === 'alipay' || kind === 'alipay_qr';
  /**
   * Что не так в каждом поле — по нему и подсветка, и `aria-invalid`:
   * замечание к номеру счёта не должно красить поле имени. Пустое поле
   * не считается неверным: незаполненное — ещё не ошибка.
   */
  const typed = (value: string) => value.trim().length > 0;
  const invalid = {
    phone: kind === 'phone' && typed(phone) && !looksLikePhone(phone),
    card: kind === 'card' && typed(cardNumber) && !looksLikeCardNumber(cardNumber),
    address: kind === 'wallet' && typed(address) && !looksLikeWalletAddress(network, address),
    account: kind === 'account' && typed(accountNumber) && !looksLikeThaiAccountNumber(accountNumber),
    alipay: kind === 'alipay' && typed(alipayAccount) && !looksLikeAlipayAccount(alipayAccount),
    holder: needsHolder && typed(holderName) && !looksLikeHolderName(holderName),
  };
  const complaint = invalid.phone
    ? REQUISITE_COMPLAINTS.phone
    : invalid.card
      ? REQUISITE_COMPLAINTS.card
      : invalid.address
        ? REQUISITE_COMPLAINTS.walletAddress(network)
        : invalid.account
          ? REQUISITE_COMPLAINTS.thaiAccount
          : invalid.alipay
            ? REQUISITE_COMPLAINTS.alipayAccount
            : invalid.holder
              ? REQUISITE_COMPLAINTS.holderName
              : undefined;

  /**
   * Кнопка гаснет, пока не заполнено всё, что нужно этому способу, и
   * пока набранное не похоже на правду: отказ операции на такой записи
   * читался бы как поломка, а не как «проверьте номер».
   */
  const fields = body();
  const ready =
    !complaint && fields !== undefined && Object.values(fields).every((value) => value.length > 0);

  /**
   * Картинка из галереи → строка из QR. Модуль чтения грузится здесь, а
   * не при сборке экрана: он нужен только тем, кто выбрал QR.
   */
  async function readPicture(file: File | undefined) {
    if (!file || !kind) return;
    const token = (attempt.current += 1);
    setQr(undefined);
    setQrComplaint(undefined);
    setReading(true);
    try {
      const { readQrFromImage } = await import('@/lib/qr');
      const payload = await readQrFromImage(file);
      if (token !== attempt.current) return;
      if (!payload) {
        setQrComplaint(REQUISITE_COMPLAINTS.noQr);
        return;
      }
      if (kind === 'promptpay') {
        const parsed = parsePromptPay(payload);
        if (!parsed.ok) {
          setQrComplaint(parsed.complaint);
          return;
        }
        setQr({ kind, payload, idType: parsed.idType, hint: promptPayHint(parsed.id) });
      } else if (kind === 'alipay_qr') {
        if (!looksLikeAlipayQr(payload)) {
          setQrComplaint(REQUISITE_COMPLAINTS.alipayQr);
          return;
        }
        setQr({ kind, payload, hint: alipayQrHint(payload) });
      }
    } catch {
      if (token === attempt.current) {
        setQrComplaint('Картинку не удалось открыть. Попробуйте другой файл.');
      }
    } finally {
      if (token === attempt.current) setReading(false);
    }
  }

  /** Сброс распознанного — при смене валюты или рода: QR другого рода здесь не к месту. */
  function forgetQr() {
    attempt.current += 1;
    setQr(undefined);
    setQrComplaint(undefined);
    setReading(false);
  }

  async function save() {
    if (!fields) return;
    setError(undefined);
    setBusy(true);
    try {
      const saved = await post<{ requisites: RequisitesView }>('/api/requisites', fields);
      onSaved(saved.requisites);
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Не удалось сохранить реквизиты');
    } finally {
      setBusy(false);
    }
  }

  /** Класс и `aria-invalid` поля — по его собственной ошибке и только после досмотра. */
  const field = (bad: boolean) => ({
    'aria-invalid': checked && bad,
    className: checked && bad ? 'input input--wrong' : 'input',
  });

  return (
    <>
      <p className="sheet__body">
        {currency
          ? 'Выберите способ получения — дальше приложение спросит ровно то, что нужно для него. Номера, адреса и QR сохранятся зашифрованными: дальше вы будете видеть только их края.'
          : 'Выберите валюту и способ получения — дальше приложение спросит ровно то, что нужно для него. Номера, адреса и QR сохранятся зашифрованными: дальше вы будете видеть только их края.'}
      </p>

      {/*
        Валюта — первой, и только когда она не известна: при подаче
        заявки она уже выбрана на экране обмена. В списке лишь валюты, у
        которых есть роды записи: заводить запись, которую нельзя будет
        приложить ни к одной заявке, незачем.
      */}
      {currency === undefined ? (
        <div className="field">
          <span className="field__label">Валюта получения</span>
          {/*
            Чипсами, как сеть у кошелька, а не строками: четыре валюты
            строками плюс роды плюс поля не помещаются на экран телефона,
            а выбор валюты — шаг, а не список для чтения.
          */}
          <div className="chips">
            {currencies.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setCode(value);
                  setChecked(false);
                  forgetQr();
                }}
                aria-pressed={code === value}
                // Флага диктор не видит: ему — название и страна.
                aria-label={`${value} — ${currencyName(value)}, ${currencyPlace(value)}`}
                className="chips__item chips__item--flag"
              >
                <CurrencyFlag code={value} size={16} />
                {value}
              </button>
            ))}
          </div>
        </div>
      ) : undefined}

      {/*
        Выбор способа не показывается, когда способ один: валюту выдают
        либо на кошелёк, либо двумя способами, и переключатель без
        альтернативы обещал бы выбор, которого нет.
      */}
      {kinds.length > 1 ? (
        <div className="options">
          {kinds.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setKind(value);
                // Досмотр относится к полю, а не к форме: не сбросив
                // его, новое поле встречало бы клиента замечанием ещё до
                // того, как он набрал в нём первый знак.
                setChecked(false);
                forgetQr();
              }}
              aria-pressed={kind === value}
              className="option"
            >
              {REQUISITE_KIND_LABELS[value]}
            </button>
          ))}
        </div>
      ) : undefined}

      {kind ? (
        <div className="form">
          {kind === 'phone' || kind === 'card' || kind === 'account' ? (
            <label className="field">
              <span className="field__label">Банк</span>
              <input
                value={bankName}
                onChange={(event) => setBankName(event.target.value)}
                placeholder={kind === 'account' ? 'Например, Kasikornbank' : 'Например, Сбербанк'}
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
                {...field(invalid.phone)}
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
                {...field(invalid.card)}
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
                  {...field(invalid.address)}
                />
              </label>
            </>
          ) : undefined}

          {kind === 'account' ? (
            <label className="field">
              <span className="field__label">Номер счёта</span>
              <input
                value={accountNumber}
                onChange={(event) => setAccountNumber(event.target.value)}
                onBlur={() => setChecked(true)}
                // С дефисами, как номер напечатан в приложении банка.
                placeholder="000-0-000000"
                inputMode="numeric"
                {...field(invalid.account)}
              />
            </label>
          ) : undefined}

          {kind === 'alipay' ? (
            <label className="field">
              <span className="field__label">Телефон или e-mail аккаунта Alipay</span>
              <input
                value={alipayAccount}
                onChange={(event) => setAlipayAccount(event.target.value)}
                onBlur={() => setChecked(true)}
                placeholder="+86 или e-mail"
                {...field(invalid.alipay)}
              />
            </label>
          ) : undefined}

          {kind === 'promptpay' || kind === 'alipay_qr' ? (
            <div className="field">
              <span className="field__label">
                {kind === 'promptpay' ? 'PromptPay-QR из банка или кошелька' : 'QR приёма Alipay'}
              </span>
              {/*
                Скриншот из галереи, а не камера: свой QR клиент показывает
                с того же телефона, и снимать его нечем. Картинка читается
                на телефоне и на сервер не уходит.
              */}
              <label className="btn btn--soft">
                {reading ? 'Читаем картинку…' : qr ? 'Выбрать другую картинку' : 'Выбрать картинку из галереи'}
                <input
                  type="file"
                  accept="image/*"
                  disabled={reading || busy}
                  onChange={(event) => {
                    void readPicture(event.target.files?.[0]);
                    // Тот же файл, выбранный снова, иначе не вызвал бы
                    // событие: поле помнит прошлый выбор.
                    event.target.value = '';
                  }}
                  className="sr-only"
                />
              </label>
              {/*
                Распознанное — на подтверждение, той же подписью, под
                которой запись встанет в список. Подтверждение — это и
                есть «Сохранить»: отдельная галочка перед той же кнопкой
                была бы вторым нажатием о том же.
              */}
              {qr ? (
                <div className="tile" aria-live="polite">
                  <span className="tile__body">
                    <span className="tile__label">Распознано</span>
                    <span className="tile__value">
                      {qr.kind === 'promptpay'
                        ? `PromptPay · ${PROMPTPAY_ID_LABELS[qr.idType]} ${qr.hint}`
                        : `Alipay · QR ${qr.hint}`}
                    </span>
                  </span>
                </div>
              ) : undefined}
              {qr ? (
                <p className="hint">Если это не ваш QR, выберите другую картинку.</p>
              ) : undefined}
              {qrComplaint ? <p className="error">{qrComplaint}</p> : undefined}
            </div>
          ) : undefined}

          {needsHolder ? (
            <label className="field">
              <span className="field__label">Имя получателя</span>
              <input
                value={holderName}
                onChange={(event) => setHolderName(event.target.value)}
                onBlur={() => setChecked(true)}
                // Как в приложении получателя: менеджер сверит его перед
                // отправкой.
                placeholder="IVAN PETROV"
                autoCapitalize="characters"
                {...field(invalid.holder)}
              />
            </label>
          ) : undefined}
        </div>
      ) : undefined}

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
