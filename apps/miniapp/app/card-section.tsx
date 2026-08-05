'use client';

import { useEffect, useState } from 'react';
import type { ClientCardApplicationView } from '@nemo/core';
import type { CardApplicationStatus } from '@nemo/types';
import { ApiError, get, post } from '@/lib/client-api';
import { formatDate } from '@/lib/format';
import { CARD_STATUS_LABELS } from '@/lib/labels';
import { TobeeMark } from './ui/icons';
import { Loading } from './ui/loading';
import { NoticeSheet } from './ui/sheet';

/**
 * Заявка на виртуальную карту.
 *
 * Экран честно говорит, чего сервис не делает: карту он не выпускает,
 * её данных не хранит и операций по ней не проводит. Поэтому на плашке
 * нет ни номера, ни имени держателя — там нечего показать, и
 * нарисованные «•••• 4821» обещали бы карту, которой в приложении нет.
 */

/** Путь заявки к выпущенной карте. Отказ — выход из него, а не шаг. */
const CARD_STEPS = ['submitted', 'processing', 'active'] as const satisfies readonly CardApplicationStatus[];

const ABOUT = {
  title: 'Как это работает',
  body: 'Заявку ведёт менеджер: оформляет её у провайдера и сообщает о каждом шаге. Карту выпускает провайдер — её номер и баланс живут у него, а приложение показывает только состояние заявки.',
};

export function CardSection({ revisit }: { readonly revisit: number }) {
  const [applications, setApplications] = useState<ClientCardApplicationView[]>([]);
  const [about, setAbout] = useState(false);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const mine = await get<{ applications: ClientCardApplicationView[] }>('/api/card-applications');
        setApplications(mine.applications);
      } catch (failure) {
        setError(failure instanceof ApiError ? failure.message : 'Не удалось загрузить заявки');
      } finally {
        setLoading(false);
      }
    })();
    // Раздел остаётся в ряду и заново не собирается: состояние заявки
    // ведёт менеджер, и узнать о его шаге можно только спросив. Признак
    // занятости при этом не поднимается — читается уже показанное, и
    // подменять его на «Загружаем…» значило бы моргать в ответ на
    // возвращение.
  }, [revisit]);

  async function cancel(applicationId: string) {
    setError(undefined);
    setBusy(true);
    try {
      const cancelled = await post<{ application: ClientCardApplicationView }>(
        `/api/card-applications/${applicationId}/cancel`,
      );
      setApplications((current) =>
        current.map((one) => (one.id === applicationId ? cancelled.application : one)),
      );
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Не удалось отозвать заявку');
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    setError(undefined);
    setBusy(true);
    try {
      const created = await post<{ application: ClientCardApplicationView }>('/api/card-applications');
      setApplications((current) => [created.application, ...current]);
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Не удалось подать заявку на карту');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <Loading />;
  }

  const current = applications[0];
  // Пока заявка не закрыта отказом, вторую подавать нечего: провайдер
  // ведёт одну.
  const canApply =
    current === undefined || current.status === 'rejected' || current.status === 'cancelled';
  // Отозвать можно, пока провайдер за заявку не взялся: дальше оформление
  // идёт на его стороне, и «отменено» в приложении его не остановит.
  const canCancel = current?.status === 'submitted';
  const reached = current ? CARD_STEPS.indexOf(current.status as (typeof CARD_STEPS)[number]) : -1;

  return (
    <>
      <div className="plastic">
        <div className="plastic__glow" />
        <div className="plastic__head">
          <span className="plastic__brand">
            <TobeeMark />
            TOBEE
          </span>
          <span className="plastic__status">
            {current ? CARD_STATUS_LABELS[current.status] : 'Не оформлена'}
          </span>
        </div>
        <div className="plastic__body">
          <div className="plastic__number">•••• •••• •••• ••••</div>
          <div className="plastic__foot">
            {/*
              Номер заявки у провайдера сюда не подставляется: он
              служебный — по нему сверяется менеджер, — а на месте имени
              держателя читался бы как данные карты, которых у сервиса
              нет.
            */}
            <span className="plastic__holder">Выпускает провайдер</span>
            <span className="plastic__marks">
              <span className="plastic__mark" />
              <span className="plastic__mark" />
            </span>
          </div>
        </div>
      </div>

      <div className="card panel">
        <div className="panel__title">Виртуальная карта</div>
        <p className="panel__text">
          Оставьте заявку — менеджер оформит её у провайдера и будет вести статус. Данные карты в
          приложении не хранятся, операций по ней здесь нет.
        </p>

        {current ? (
          <div className="steps">
            {CARD_STEPS.map((step, index) => (
              <div key={step} className="steps__row">
                <span
                  className={
                    index <= reached ? 'steps__title steps__title--reached' : 'steps__title'
                  }
                >
                  {CARD_STATUS_LABELS[step]}
                </span>
                <span
                  className={index === reached ? 'steps__mark steps__mark--now' : 'steps__mark'}
                >
                  {index < reached ? 'Готово' : index === reached ? 'Сейчас' : '—'}
                </span>
              </div>
            ))}
            {current.status === 'rejected' || current.status === 'cancelled' ? (
              <div className="steps__row">
                <span className="steps__title steps__title--reached">
                  {CARD_STATUS_LABELS[current.status]}
                </span>
                <span className="steps__mark">{formatDate(current.updatedAt)}</span>
              </div>
            ) : undefined}
          </div>
        ) : undefined}

        {error ? <p className="error">{error}</p> : undefined}

        <div className="panel__actions">
          {canApply ? (
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy}
              className="btn btn--gold"
            >
              Подать заявку на карту
            </button>
          ) : (
            <>
              <button type="button" onClick={() => setAbout(true)} className="btn btn--soft">
                Что дальше
              </button>
              {canCancel && current ? (
                <button
                  type="button"
                  onClick={() => void cancel(current.id)}
                  disabled={busy}
                  className="btn btn--soft"
                >
                  Отменить
                </button>
              ) : undefined}
            </>
          )}
        </div>
      </div>

      {applications.length > 1 ? (
        <>
          <div className="section-title">Прошлые заявки</div>
          <ul className="rows">
            {applications.slice(1).map((application) => (
              <li key={application.id} className="row">
                <span className="row__body">
                  <span className="row__title">{CARD_STATUS_LABELS[application.status]}</span>
                  <span className="row__sub">Подана {formatDate(application.createdAt)}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : undefined}

      {about ? (
        <NoticeSheet title={ABOUT.title} body={ABOUT.body} onClose={() => setAbout(false)} />
      ) : undefined}
    </>
  );
}
