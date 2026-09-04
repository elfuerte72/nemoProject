'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import type {
  ColleagueView,
  ExchangeRequestEventView,
  ManagerExchangeRequestView,
  RevealedRequisites,
  ServiceAccountView,
} from '@nemo/core';
import {
  canTransition,
  inProgressExchangeStatuses,
  type ExchangeRequestStatus,
  type StaffRole,
} from '@nemo/types';
import { ClientCard, type ClientCardData } from '@/app/ui/client-card';
import { HowToRunRequest } from '@/app/ui/how-to';
import { Moment } from '@/app/ui/moment';
import { KIND_LABELS, STATUS_LABELS, STATUS_TONES } from '@/lib/exchange-request-labels';
import { formatAmount, formatMoney, formatRate } from '@/lib/format';
import { suggestServiceIncome } from '@/lib/income';
import { describeServiceAccount, pillClass, REQUISITE_KIND_LABELS } from '@/lib/labels';
import { PROMPTPAY_ID_LABELS } from '@nemo/types';

/**
 * Действия менеджера над заявкой.
 *
 * Показывается ровно то, что разрешает текущее состояние: кнопка
 * «исполнить» на невзятой заявке всё равно получила бы отказ от
 * операции, но менеджер узнал бы об этом уже после нажатия.
 *
 * Одно действие — одна карточка, и порядок карточек повторяет порядок
 * шагов: следующий шаг всегда ниже предыдущего, и искать его не надо.
 */

type ExchangeRequestForDisplay = Omit<ManagerExchangeRequestView, 'clientId'> & {
  clientId: string;
};

export function ExchangeRequestCard({
  request,
  events,
  client,
  accounts,
  markupBps,
  pricedBySchedule,
  viewerStaffId,
  viewerRole,
  colleagues,
}: {
  request: ExchangeRequestForDisplay;
  events: readonly ExchangeRequestEventView[];
  /** С кем сделка. Пусто, если клиента ещё не завели. */
  client: ClientCardData | null;
  /** Счета сервиса в валюте, которой платит клиент, — из чего выбирать. */
  accounts: readonly ServiceAccountView[];
  /** Наценка сервиса: по ней считается подсказка дохода. */
  markupBps: number;
  /**
   * Цена заявки назначена сеткой ступеней, а не наценкой. Тогда наценки
   * в курсе нет вовсе, и подсказка дохода молчит.
   */
  pricedBySchedule: boolean;
  viewerStaffId: string;
  viewerRole: StaffRole;
  /** Кому можно передать заявку: активные сотрудники. */
  colleagues: readonly ColleagueView[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const [finalRate, setFinalRate] = useState('');
  /*
   * Сумма к выдаче набирается только у наличной заявки: у безналичной
   * она посчитана при подаче и не меняется — там её показывают, а не
   * спрашивают.
   */
  const [toAmount, setToAmount] = useState('');
  /*
   * Счёт сервиса, который уйдёт клиенту. Номер по нему собирает ядро —
   * менеджер его не набирает (docs/adr/0008). Первый в списке выбран
   * заранее: обычно он там и единственный.
   */
  const [serviceAccountId, setServiceAccountId] = useState(accounts[0]?.id ?? '');
  const [paymentInstructions, setPaymentInstructions] = useState('');
  const [serviceIncome, setServiceIncome] = useState('');
  const [serviceIncomeCode, setServiceIncomeCode] = useState(request.toCode);
  const [reason, setReason] = useState('');
  /** Раскрытое — без самой строки QR: маршрут её не отдаёт, рисует картинку. */
  const [requisites, setRequisites] = useState<Omit<RevealedRequisites, 'qr'>>();
  /** QR, нарисованный сервером из расшифрованной строки, — картинкой для альбома. */
  const [qrImage, setQrImage] = useState<string | null>(null);

  /*
   * Подсказка дохода — из того, что уже на экране: сумма сделки в
   * выбранной валюте и наценка сервиса. Считается для той стороны, в
   * которой доход называют: доход в рублях — от рублёвой стороны, в
   * монетах — от монетной.
   *
   * Только там, где курс пришёл из котировки по наценке: она сидит в
   * нём, и оттуда её и вынимают. Курс, названный менеджером, и курс,
   * посчитанный по сетке ступеней, наценки не содержат — и то же число,
   * поданное как расчёт, было бы выдумкой. Доход при этом уходит в
   * реферальные начисления и потом не правится, поэтому подсказка
   * молчит, а не угадывает.
   */
  const givenSide = serviceIncomeCode === request.fromCode;
  const incomeHint =
    request.requestRate && !pricedBySchedule
      ? suggestServiceIncome({
          amount: givenSide ? request.fromAmount : request.toAmount,
          markupBps,
          side: givenSide ? 'given' : 'received',
        })
      : null;

  /**
   * Что можно сделать с заявкой на обмен прямо сейчас.
   *
   * Берётся из той же таблицы переходов, по которой отказывает
   * операция, и из закрепления за менеджером. Своя копия правил
   * разошлась бы с ядром молча: экран показывал бы кнопку, а операция
   * отвечала бы отказом уже после нажатия.
   */
  const mine = request.assignedManagerId === null || request.assignedManagerId === viewerStaffId;
  const allowed = (to: ExchangeRequestStatus) => mine && canTransition(request.status, to);

  /*
   * Передать может ведущий или администратор, и только незакрытую
   * заявку, у которой ведущий есть. То же правило, что в операции.
   */
  const inProgress = (inProgressExchangeStatuses as readonly string[]).includes(request.status);
  const canReassign =
    request.assignedManagerId !== null &&
    inProgress &&
    (request.assignedManagerId === viewerStaffId || viewerRole === 'admin');
  const [toStaffId, setToStaffId] = useState('');
  const candidates = colleagues.filter((one) => one.id !== request.assignedManagerId);

  const can = {
    claim: request.assignedManagerId === null && canTransition(request.status, 'in_progress'),
    confirmRate: allowed('rate_confirmed'),
    markPaymentReceived: allowed('payment_received'),
    complete: allowed('completed'),
    cancel: allowed('cancelled'),
  };

  const decided =
    request.finalRate ||
    request.serviceIncome ||
    request.paymentInstructions ||
    request.cancelReason;

  async function act(body: Record<string, string>) {
    setError(undefined);
    setBusy(true);
    try {
      const response = await fetch(`/api/exchange-requests/${request.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        setError(payload.error ?? 'Действие не выполнено');
        return;
      }
      router.refresh();
    } catch {
      // Оборвавшаяся сеть без этой ветки выглядела бы как «нажал, и
      // ничего не произошло» — менеджер нажал бы ещё раз.
      setError('Не удалось связаться с сервером. Повторите попытку.');
    } finally {
      setBusy(false);
    }
  }

  /**
   * Реквизиты открываются по отдельному нажатию, а не показываются
   * сразу: каждое такое обращение попадает в журнал, и открывать чужой
   * номер карты «просто потому что заявка открыта» незачем.
   */
  async function reveal() {
    setError(undefined);
    setBusy(true);
    try {
      const response = await fetch(`/api/exchange-requests/${request.id}/requisites`, {
        method: 'POST',
      });
      const payload = (await response.json()) as {
        requisites?: Omit<RevealedRequisites, 'qr'>;
        qrImage?: string | null;
        error?: string;
      };
      if (!response.ok || !payload.requisites) {
        setError(payload.error ?? 'Реквизиты не открылись');
        return;
      }
      setRequisites(payload.requisites);
      setQrImage(payload.qrImage ?? null);
    } catch {
      setError('Не удалось связаться с сервером. Повторите попытку.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page page--wide">
      <Link href="/" className="page__back">
        ← К очереди
      </Link>

      <header className="page__head">
        <div>
          {/*
            Обе стороны сделки в заголовке: сумма к выдаче посчитана при
            подаче по курсу заявки — это ровно то число, которое увидел
            клиент. Без него менеджер считает его сам и расходится с
            обещанным.
          */}
          <h1 className="page__title">
            {formatAmount(request.fromAmount)} {request.fromCode} →{' '}
            {request.toAmount ? `${formatAmount(request.toAmount)} ` : ''}
            {request.toCode}
          </h1>
          <p className="page__sub">
            {KIND_LABELS[request.kind]}
            {request.toAmount && request.requestRate
              ? ` · клиент видел эту сумму при подаче, по курсу ${formatRate(
                  request.requestRate,
                  request.fromCode,
                  request.toCode,
                )}`
              : ''}
          </p>
        </div>
        <span className={pillClass(STATUS_TONES[request.status])}>
          {STATUS_LABELS[request.status]}
        </span>
      </header>

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : undefined}

      <div className="split split--work">
        <div className="split__main">
          {!mine && request.assignedManagerId ? (
            <p className="empty">
              Заявку ведёт {request.assignedManagerName ?? 'другой менеджер'} — действия по ней
              закрыты. Читать её можно: если клиент написал вам, ответьте в переписке, а вести
              сделку останется тому, кто её взял.
            </p>
          ) : undefined}

          {canReassign ? (
            <section className="card">
              <h2 className="card__title">Кто ведёт</h2>
              <p className="card__note">
                Сейчас — {request.assignedManagerName ?? 'вы'}. Передача меняет ведущего целиком и
                остаётся в истории; клиенту сообщение не уходит — его процесс не меняется.
              </p>
              {candidates.length ? (
                <div className="form-row">
                  <label className="field field--wide">
                    <span className="label">Передать</span>
                    <select
                      className="input"
                      value={toStaffId}
                      onChange={(event) => setToStaffId(event.target.value)}
                    >
                      <option value="">Выберите сотрудника</option>
                      {candidates.map((one) => (
                        <option key={one.id} value={one.id}>
                          {one.displayName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="btn btn--soft"
                    disabled={busy || !toStaffId}
                    onClick={() => act({ action: 'reassign', toStaffId })}
                  >
                    Передать заявку
                  </button>
                </div>
              ) : (
                <p className="muted">Передать некому: других активных сотрудников нет.</p>
              )}
            </section>
          ) : undefined}

          {/* Только то, что решено. Пустых строк «курс: —» на экране нет. */}
          {decided ? (
            <section className="card">
              <h2 className="card__title">Что уже решено</h2>
              <ul className="rows">
                {request.finalRate ? (
                  <Fact label="Курс сделки">
                    {formatRate(request.finalRate, request.fromCode, request.toCode)}
                    {request.toAmount
                      ? ` · к выдаче ${formatMoney(request.toAmount, request.toCode)}`
                      : ''}
                  </Fact>
                ) : undefined}
                {request.serviceIncome ? (
                  <Fact label="Сколько заработал сервис">
                    {formatMoney(request.serviceIncome, request.serviceIncomeCode ?? '')}
                  </Fact>
                ) : undefined}
                {request.paymentInstructions ? (
                  <Fact label="Клиенту выданы реквизиты" quiet lines>
                    {request.paymentInstructions}
                  </Fact>
                ) : undefined}
                {request.cancelReason ? (
                  <Fact label="Причина отмены" quiet>
                    {request.cancelReason}
                  </Fact>
                ) : undefined}
              </ul>
            </section>
          ) : undefined}

          {/*
        Наличную заявку клиент получает на руки: реквизитов у неё нет, и
        предлагать их раскрыть — обещать менеджеру данные, которых не
        существует.
      */}
          {request.kind === 'electronic' ? (
            <section className="card">
              <h2 className="card__title">Реквизиты клиента</h2>
              {requisites ? (
                <ul className="rows">
                  <Fact label="Способ получения">{REQUISITE_KIND_LABELS[requisites.kind]}</Fact>
                  {requisites.bankName ? (
                    <Fact label="Банк">{requisites.bankName}</Fact>
                  ) : undefined}
                  {requisites.phone ? (
                    <Fact label="Телефон" mono>
                      {requisites.phone}
                    </Fact>
                  ) : undefined}
                  {requisites.cardNumber ? (
                    <Fact label="Карта" mono>
                      {requisites.cardNumber}
                    </Fact>
                  ) : undefined}
                  {/*
                Сеть — не подпись к адресу, а условие перевода: адрес в
                разных сетях выглядит одинаково, и отправленное не в ту
                не возвращается. Поэтому она стоит выше адреса и набрана
                заметно.
              */}
                  {requisites.network ? (
                    <li className="row">
                      <div className="row__main">
                        <span className="row__meta">Сеть — проверьте перед отправкой</span>
                        <span className={pillClass('wait')}>{requisites.network}</span>
                      </div>
                    </li>
                  ) : undefined}
                  {requisites.address ? (
                    <Fact label="Адрес кошелька" mono>
                      {requisites.address}
                    </Fact>
                  ) : undefined}
                  {requisites.accountNumber ? (
                    <Fact label="Номер счёта" mono>
                      {requisites.accountNumber}
                    </Fact>
                  ) : undefined}
                  {requisites.alipayAccount ? (
                    <Fact label="Аккаунт Alipay" mono>
                      {requisites.alipayAccount}
                    </Fact>
                  ) : undefined}
                  {/*
                Идентификатор из QR — текстом и с типом: менеджер может
                набрать его руками, а телефон и ID-карта в тайском банке
                вводятся в разные поля.
              */}
                  {requisites.promptpayId && requisites.promptpayIdType ? (
                    <Fact
                      label={`PromptPay · ${PROMPTPAY_ID_LABELS[requisites.promptpayIdType]}`}
                      mono
                    >
                      {requisites.promptpayId}
                    </Fact>
                  ) : undefined}
                  {/*
                Имя получателя — рядом с идентификатором: перед отправкой
                приложение получателя показывает имя, и менеджер сверяет
                его с этим.
              */}
                  {requisites.holderName ? (
                    <Fact label="Получатель">{requisites.holderName}</Fact>
                  ) : undefined}
                  {qrImage ? (
                    <li className="row">
                      <div className="row__main">
                        <span className="row__meta">
                          QR — отсканировать вторым устройством или сохранить в альбом. На iPhone:
                          удерживайте QR и выберите «Сохранить в Фото»
                        </span>
                        <img
                          src={qrImage}
                          alt={`QR: ${REQUISITE_KIND_LABELS[requisites.kind]}`}
                          className="qr"
                        />
                        <div className="row__actions">
                          {/*
                        Со своего же экрана QR не отсканировать: тайские
                        банки и Alipay читают QR из галереи, и картинка
                        сохраняется туда. Где есть общий доступ к файлам —
                        системный лист с «Сохранить изображение»; иначе
                        обычная загрузка.
                      */}
                          <button
                            type="button"
                            onClick={() =>
                              void saveQrImage(
                                qrImage,
                                `${requisites.kind}-${request.id.slice(0, 6)}.png`,
                              )
                            }
                            className="btn btn--soft"
                          >
                            Сохранить QR
                          </button>
                        </div>
                      </div>
                    </li>
                  ) : undefined}
                </ul>
              ) : (
                <>
                  <p className="card__note">
                    Открытие номера карты, счёта, адреса кошелька и QR записывается в журнал:
                    администратор увидит, кто и когда их смотрел.
                  </p>
                  <div className="row__actions">
                    <button
                      type="button"
                      onClick={reveal}
                      disabled={busy || !mine}
                      className="btn btn--soft"
                    >
                      Показать реквизиты
                    </button>
                  </div>
                </>
              )}
            </section>
          ) : undefined}

          {can.claim ? (
            <button
              type="button"
              onClick={() => act({ action: 'claim' })}
              disabled={busy}
              className="btn btn--gold btn--wide"
            >
              Взять в работу
            </button>
          ) : undefined}

          {can.confirmRate ? (
            <section className="card">
              <h2 className="card__title">Курс и реквизиты для оплаты</h2>
              <p className="card__note">
                {request.requestRate
                  ? 'Курс клиент получил при подаче, и он не меняется: сервис работает по нему. ' +
                    'Отсюда уходят только реквизиты — с этого момента пойдёт срок оплаты.'
                  : 'У этой заявки курса подачи нет — назовите свой. Курс и реквизиты уйдут ' +
                    'клиенту в бот сообщением, и с этого момента пойдёт срок оплаты.'}
              </p>
              {/*
                Счетов нет — говорится до формы, а не припиской под ней, и
                со ссылкой туда, где счёт заводят: до 4 сентября 2026
                администратор читал серую строку под курсом и спрашивал,
                почему кнопка не работает. Правило само — docs/adr/0008:
                реквизиты руками не набираются, опечатка в одной цифре
                означает перевод, который не возвращается.
              */}
              {accounts.length === 0 && request.kind === 'electronic' ? (
                <div className="callout" role="status">
                  <div className="callout__body">
                    <span className="callout__title">
                      Выдавать нечего: счетов сервиса в {request.fromCode} нет
                    </span>
                    <p className="callout__text">
                      Клиент переводит {request.fromCode} на счёт сервиса, а его выбирают из
                      справочника, не набирают руками.{' '}
                      {viewerRole === 'admin'
                        ? `Заведите счёт в ${request.fromCode} — он появится здесь списком, и кнопка оживёт.`
                        : `Счета заводит администратор — попросите его завести счёт в ${request.fromCode}, и кнопка оживёт.`}
                    </p>
                  </div>
                  {/* Менеджеру ссылки нет: раздел у него только для чтения, и
                      кнопка вела бы в тупик. */}
                  {viewerRole === 'admin' ? (
                    <Link href="/service-accounts" className="btn btn--soft">
                      Завести счёт
                    </Link>
                  ) : undefined}
                </div>
              ) : undefined}
              <div className="form-row">
                {/*
              Поле курса — только там, где курс называет менеджер. У
              безналичной заявки он назван при подаче, и поле ввода
              обещало бы возможность его поменять.
            */}
                {request.requestRate ? (
                  <div className="field">
                    <span className="label">Курс заявки</span>
                    <span className="row__title mono">
                      {formatRate(request.requestRate, request.fromCode, request.toCode)}
                    </span>
                  </div>
                ) : (
                  <label className="field">
                    <span className="label">Курс</span>
                    <input
                      className="input"
                      value={finalRate}
                      onChange={(event) => setFinalRate(event.target.value)}
                      inputMode="decimal"
                    />
                  </label>
                )}
                {/*
              У заявки с курсом подачи сумма посчитана при подаче — её
              видел клиент, и меняться она не может: операция отвергает
              присланную поверх. Поле ввода обещало бы менеджеру
              возможность, которой нет, а набранное в нём вернулось бы
              отказом. Поле остаётся только там, где сумму называет сам
              менеджер, — у наличной заявки.
            */}
                {request.requestRate ? (
                  <div className="field">
                    <span className="label">К выдаче в {request.toCode}</span>
                    <span className="row__title mono">
                      {request.toAmount ? formatAmount(request.toAmount) : '—'}
                    </span>
                  </div>
                ) : (
                  <label className="field">
                    <span className="label">К выдаче в {request.toCode}</span>
                    <input
                      className="input"
                      value={toAmount}
                      onChange={(event) => setToAmount(event.target.value)}
                      inputMode="decimal"
                    />
                  </label>
                )}
              </div>
              {/*
            Счёт выбирается, а не набирается: опечатка в одной цифре —
            это перевод, который не возвращается (docs/adr/0008). В
            списке только счета в валюте, которой платит клиент, и
            только действующие.
          */}
              {accounts.length > 0 ? (
                <label className="field">
                  <span className="label">
                    Счёт сервиса — на него клиент отправит {request.fromCode}
                  </span>
                  <select
                    className="input"
                    value={serviceAccountId}
                    onChange={(event) => setServiceAccountId(event.target.value)}
                  >
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {describeServiceAccount(account)}
                        {account.note ? ` · ${account.note}` : ''}
                      </option>
                    ))}
                  </select>
                </label>
              ) : undefined}

              <label className="field">
                <span className="label">
                  {request.kind === 'electronic'
                    ? 'Приписка к сообщению — срок, сумма, условие'
                    : 'Где и когда встречаетесь'}
                </span>
                <textarea
                  className="input"
                  value={paymentInstructions}
                  onChange={(event) => setPaymentInstructions(event.target.value)}
                  rows={3}
                  placeholder={
                    request.kind === 'electronic'
                      ? 'Например: оплатите одной суммой'
                      : 'Например: офис на Тверской, до 19:00'
                  }
                />
              </label>
              <div className="row__actions">
                {/*
              Курс и реквизиты обязательны — операция без них откажет.
              Погашенная кнопка говорит об этом до нажатия, а не отказом
              после: сообщение об ошибке на пустой форме читается как
              поломка, а не как «заполните поля».
            */}
                <button
                  type="button"
                  disabled={
                    busy ||
                    /*
                     * То же правило, по которому отказывает операция:
                     * безналичной нужен счёт, наличной — слова. Погашенная
                     * кнопка говорит об этом до нажатия.
                     */
                    (request.kind === 'electronic'
                      ? !serviceAccountId
                      : !paymentInstructions.trim()) ||
                    // Курс обязателен только там, где его называет менеджер.
                    (!request.requestRate && !finalRate.trim())
                  }
                  className="btn btn--gold"
                  onClick={() =>
                    act({
                      action: 'confirm-rate',
                      // Ни курс, ни сумма не уходят по заявке с курсом
                      // подачи: и то и другое там обязательство сервиса, и
                      // присланное поверх операция отвергает.
                      ...(request.requestRate
                        ? {}
                        : { finalRate, ...(toAmount ? { toAmount } : {}) }),
                      ...(serviceAccountId ? { serviceAccountId } : {}),
                      ...(paymentInstructions.trim() ? { paymentInstructions } : {}),
                    })
                  }
                >
                  {request.requestRate
                    ? 'Выдать реквизиты для оплаты'
                    : 'Назвать курс и выдать реквизиты'}
                </button>
              </div>
            </section>
          ) : undefined}

          {can.markPaymentReceived ? (
            <button
              type="button"
              onClick={() => act({ action: 'payment-received' })}
              disabled={busy}
              className="btn btn--gold btn--wide"
            >
              Оплата поступила
            </button>
          ) : undefined}

          {can.complete ? (
            <section className="card">
              <h2 className="card__title">Исполнение заявки</h2>
              <p className="card__note">
                Сколько сервис заработал на этой заявке. От этого числа начисляются баллы рефереру
                клиента, и поправить его потом нельзя — заявку закрывают один раз.
              </p>
              <div className="form-row">
                <label className="field">
                  <span className="label">Сколько заработал сервис</span>
                  <input
                    className="input"
                    value={serviceIncome}
                    onChange={(event) => setServiceIncome(event.target.value)}
                    inputMode="decimal"
                  />
                </label>
                {/*
              Валюта выбирается из двух сторон сделки, а не набирается:
              «руб» вместо «RUB» получало бы отказ операции на последнем
              шаге, а «USD» вместо «USDT» — тихо уходило бы в отчётность
              второй валютой, ни с чем не сходящейся.
            */}
                <label className="field field--narrow">
                  <span className="label">Валюта дохода</span>
                  <select
                    className="input"
                    value={serviceIncomeCode}
                    onChange={(event) => setServiceIncomeCode(event.target.value)}
                  >
                    {[request.toCode, request.fromCode]
                      .filter((code, at, all) => all.indexOf(code) === at)
                      .map((code) => (
                        <option key={code} value={code}>
                          {code}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
              {/*
            Подсказка, а не подстановка: наличные и ручной курс расчёт
            не покрывает — там сервис покупает не по котировке, — и
            последнее слово остаётся за менеджером.
          */}
              {incomeHint ? (
                <div className="row__actions">
                  <span className="row__meta">
                    По наценке {(markupBps / 100).toString().replace('.', ',')}% выходит{' '}
                    {formatMoney(incomeHint, serviceIncomeCode)}
                  </span>
                  <button
                    type="button"
                    className="btn btn--soft"
                    disabled={busy}
                    onClick={() => setServiceIncome(incomeHint)}
                  >
                    Подставить
                  </button>
                </div>
              ) : undefined}
              <div className="row__actions">
                <button
                  type="button"
                  disabled={busy || !serviceIncome.trim() || !serviceIncomeCode.trim()}
                  className="btn btn--gold"
                  onClick={() => act({ action: 'complete', serviceIncome, serviceIncomeCode })}
                >
                  Заявка исполнена
                </button>
              </div>
            </section>
          ) : undefined}

          {can.cancel ? (
            <section className="card">
              <h2 className="card__title">Отмена</h2>
              <div className="form-row">
                <label className="field">
                  <span className="label">Причина — её увидит клиент</span>
                  <input
                    className="input"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </label>
                <button
                  type="button"
                  disabled={busy || !reason.trim()}
                  className="btn btn--danger"
                  onClick={() => act({ action: 'cancel', reason })}
                >
                  Отменить заявку
                </button>
              </div>
            </section>
          ) : undefined}
        </div>

        <ClientCard
          clientId={request.clientId}
          client={client}
          conversationHref={`/conversations/${request.clientId}?request=${request.id}`}
        />
      </div>

      {/*
        Памятка — в конце работы, а не в начале: сверху то, что делают
        сейчас, а справка нужна тому, кто на шаге запнулся.
      */}
      <HowToRunRequest />

      <section className="section">
        <div className="section__head">
          <h2 className="section__title">История</h2>
          <span className="section__rule" />
        </div>
        <ul className="rows">
          {events.map((event, index) => (
            <li key={index} className="row">
              <div className="row__main">
                <span className="row__title">
                  {STATUS_LABELS[event.toStatus]}
                  {event.actorType === 'client' ? ' — клиент' : ''}
                </span>
                {event.comment ? <span className="row__meta">{event.comment}</span> : undefined}
              </div>
              {/*
                Время печатает браузер, а не сервер: панель рисуется на
                сервере, а он живёт в UTC. Тот же компонент, что и в
                очереди, — два формата одного и того же в одной панели
                читаются как две разные величины.
              */}
              <span className="row__meta">
                <Moment at={new Date(event.createdAt).toISOString()} />
              </span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

/**
 * Картинку QR — в альбом менеджера.
 *
 * На iPhone `download` кладёт файл в «Файлы», а не в «Фото», откуда
 * тайский банк и Alipay читают QR. Системный лист с «Сохранить
 * изображение» открывает `navigator.share` с файлом; там, где его нет,
 * остаётся обычная загрузка.
 */
async function saveQrImage(dataUrl: string, name: string): Promise<void> {
  const blob = await (await fetch(dataUrl)).blob();
  const file = new File([blob], name, { type: 'image/png' });
  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch {
      // Лист закрыли — или платформа передумала; остаётся загрузка.
    }
  }
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

/**
 * Строка «подпись — значение». Длинные тексты — реквизиты для оплаты,
 * причина отмены — идут мелким: это цитата, а не число, и набранная
 * крупным она перетягивает на себя весь блок.
 */
function Fact({
  label,
  children,
  mono,
  quiet,
  lines,
}: {
  label: string;
  children: ReactNode;
  mono?: boolean;
  quiet?: boolean;
  /** Переносы внутри значения оставить: так набраны выданные реквизиты. */
  lines?: boolean;
}) {
  const value = quiet ? 'row__meta' : mono ? 'row__title mono' : 'row__title';
  return (
    <li className="row">
      <div className="row__main">
        <span className="row__meta">{label}</span>
        <span className={lines ? `${value} row__meta--lines` : value}>{children}</span>
      </div>
    </li>
  );
}
