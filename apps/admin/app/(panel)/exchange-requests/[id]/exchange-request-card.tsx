'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import type {
  ExchangeRequestEventView,
  ManagerExchangeRequestView,
  RevealedRequisites,
} from '@nemo/core';
import { canTransition, type ExchangeRequestStatus } from '@nemo/types';
import { KIND_LABELS, STATUS_LABELS, STATUS_TONES } from '@/lib/exchange-request-labels';
import { formatAmount, formatMoney } from '@/lib/format';
import { pillClass } from '@/lib/labels';

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

type ExchangeRequestForDisplay = Omit<ManagerExchangeRequestView, 'clientId'> & { clientId: string };

export function ExchangeRequestCard({
  request,
  events,
  viewerStaffId,
}: {
  request: ExchangeRequestForDisplay;
  events: readonly ExchangeRequestEventView[];
  viewerStaffId: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const [finalRate, setFinalRate] = useState('');
  const [toAmount, setToAmount] = useState('');
  const [paymentInstructions, setPaymentInstructions] = useState('');
  const [serviceIncome, setServiceIncome] = useState('');
  const [serviceIncomeCode, setServiceIncomeCode] = useState(request.toCode);
  const [reason, setReason] = useState('');
  const [requisites, setRequisites] = useState<RevealedRequisites>();

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
        requisites?: RevealedRequisites;
        error?: string;
      };
      if (!response.ok || !payload.requisites) {
        setError(payload.error ?? 'Реквизиты не открылись');
        return;
      }
      setRequisites(payload.requisites);
    } catch {
      setError('Не удалось связаться с сервером. Повторите попытку.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page page--narrow">
      <Link href="/" className="page__back">
        ← К очереди
      </Link>

      <header className="page__head">
        <div>
          <h1 className="page__title">
            {formatAmount(request.fromAmount)} {request.fromCode} → {request.toCode}
          </h1>
          <p className="page__sub">
            {KIND_LABELS[request.kind]} · клиент {request.clientId}
          </p>
        </div>
        <span className={pillClass(STATUS_TONES[request.status])}>
          {STATUS_LABELS[request.status]}
        </span>
      </header>

      {error ? <p className="error">{error}</p> : undefined}

      {!mine && request.assignedManagerId ? (
        <p className="empty">Заявку ведёт другой менеджер — действия закрыты.</p>
      ) : undefined}

      {/* Только то, что решено. Пустых строк «курс: —» на экране нет. */}
      {decided ? (
        <section className="card">
          <h2 className="card__title">Что уже решено</h2>
          <ul className="rows">
            {request.finalRate ? (
              <Fact label="Финальный курс">
                {formatAmount(request.finalRate)}
                {request.toAmount
                  ? ` · к выдаче ${formatMoney(request.toAmount, request.toCode)}`
                  : ''}
              </Fact>
            ) : undefined}
            {request.serviceIncome ? (
              <Fact label="Доход по заявке">
                {formatMoney(request.serviceIncome, request.serviceIncomeCode ?? '')}
              </Fact>
            ) : undefined}
            {request.paymentInstructions ? (
              <Fact label="Клиенту выданы реквизиты" quiet>
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

      <section className="card">
        <h2 className="card__title">Реквизиты клиента</h2>
        {requisites ? (
          <ul className="rows">
            <Fact label="Банк">{requisites.bankName ?? '—'}</Fact>
            <Fact label="Телефон" mono>
              {requisites.phone ?? '—'}
            </Fact>
            <Fact label="Карта" mono>
              {requisites.cardNumber ?? '—'}
            </Fact>
          </ul>
        ) : (
          <>
            <p className="card__note">
              Открытие номера карты записывается в журнал: администратор увидит, кто и
              когда его смотрел.
            </p>
            <div className="row__actions">
              <button type="button" onClick={reveal} disabled={busy || !mine} className="btn btn--soft">
                Показать реквизиты
              </button>
            </div>
          </>
        )}
      </section>

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
          <h2 className="card__title">Финальный курс</h2>
          <p className="card__note">Курс и реквизиты уйдут клиенту в бот сообщением.</p>
          <div className="form-row">
            <label className="field">
              <span className="label">Курс</span>
              <input
                className="input"
                value={finalRate}
                onChange={(event) => setFinalRate(event.target.value)}
                inputMode="decimal"
              />
            </label>
            <label className="field">
              <span className="label">К выдаче в {request.toCode}</span>
              <input
                className="input"
                value={toAmount}
                onChange={(event) => setToAmount(event.target.value)}
                inputMode="decimal"
              />
            </label>
          </div>
          <label className="field">
            <span className="label">Реквизиты для оплаты</span>
            <textarea
              className="input"
              value={paymentInstructions}
              onChange={(event) => setPaymentInstructions(event.target.value)}
              rows={3}
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
              disabled={busy || !finalRate.trim() || !paymentInstructions.trim()}
              className="btn btn--gold"
              onClick={() =>
                act({
                  action: 'confirm-rate',
                  finalRate,
                  ...(toAmount ? { toAmount } : {}),
                  paymentInstructions,
                })
              }
            >
              Подтвердить курс и выдать реквизиты
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
            Доход по заявке — база реферальных начислений. Без него заявку закрыть
            нельзя, а поправить его потом означало бы пересчитывать уже начисленное.
          </p>
          <div className="form-row">
            <label className="field">
              <span className="label">Доход по заявке</span>
              <input
                className="input"
                value={serviceIncome}
                onChange={(event) => setServiceIncome(event.target.value)}
                inputMode="decimal"
              />
            </label>
            <label className="field field--narrow">
              <span className="label">Валюта дохода</span>
              <input
                className="input"
                value={serviceIncomeCode}
                onChange={(event) => setServiceIncomeCode(event.target.value)}
              />
            </label>
          </div>
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
              <span className="row__meta">{new Date(event.createdAt).toLocaleString('ru-RU')}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
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
}: {
  label: string;
  children: ReactNode;
  mono?: boolean;
  quiet?: boolean;
}) {
  return (
    <li className="row">
      <div className="row__main">
        <span className="row__meta">{label}</span>
        <span className={quiet ? 'row__meta' : mono ? 'row__title mono' : 'row__title'}>
          {children}
        </span>
      </div>
    </li>
  );
}
