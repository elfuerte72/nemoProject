'use client';

import { useState } from 'react';
import type { DirectionView, FeeScheduleView, NetworkView } from '@nemo/core';
import type { PayoutMethod } from '@nemo/types';
import { KIND_LABELS } from '@/lib/exchange-request-labels';
import { FEE_PAYOUT_LABELS, pillClass } from '@/lib/labels';
import { bpsToPercent, percentToBps } from '@/lib/percent';

/**
 * Чем сервис торгует и почём: направления, сетки комиссии, сети.
 *
 * Состав справочников здесь не меняется — его задаёт скрипт
 * развёртывания; здесь их гасят и включают, а сеткам правят ступени.
 * Подраздел свой, потому что открывают его ради одного действия —
 * закрыть направление, на котором цена разошлась с рынком, — и искать
 * его среди ставок и сотрудников значило терять на этом минуты.
 */

/**
 * Направления обмена: флажок на каждое.
 *
 * Состав справочника здесь не меняется — его задаёт скрипт
 * развёртывания: под каждым направлением стоит канал выплаты, и кнопка
 * «добавить» обещала бы, что канал заведётся сам.
 *
 * Гасить, наоборот, приходится срочно. Курс безналичной заявки сервис
 * фиксирует при подаче и потом не переназывает, а наценка одна на все
 * направления: там, где сервис отдаёт валюту дороже, чем покупает,
 * каждая новая заявка — это убыток, и закрыть направление нужно за
 * секунды, а не за выкатку.
 */
export function ExchangeDirections({
  directions,
  busy,
  onToggle,
}: {
  directions: readonly DirectionView[];
  busy: boolean;
  onToggle: (path: string, body: unknown) => Promise<unknown>;
}) {
  return (
    <section className="card">
      <h2 className="card__title">Направления обмена</h2>
      <p className="card__note">
        Выключенное направление сразу исчезает с экрана клиента, а поданные по нему
        заявки остаются в работе — их доводит менеджер. Выключайте то, на котором цена
        разошлась с рынком: курс заявки сервис фиксирует при подаче и потом не меняет.
      </p>
      {directions.length === 0 ? (
        <p className="empty">
          Направления ещё не заведены: их создаёт скрипт развёртывания.
        </p>
      ) : (
        <ul className="rows">
          {directions.map((direction) => (
            <li key={direction.id} className="row">
              <div className="row__main">
                <span className="row__title">
                  {direction.fromCode} → {direction.toCode}
                </span>
                <span className="row__meta">
                  {KIND_LABELS[direction.kind]} ·{' '}
                  {direction.isActive ? 'предлагается клиентам' : 'выключено'}
                </span>
              </div>
              <div className="row__actions">
                <button
                  type="button"
                  disabled={busy}
                  className={direction.isActive ? 'btn btn--danger' : 'btn btn--ghost'}
                  onClick={() =>
                    onToggle('/api/directions', {
                      directionId: direction.id,
                      isActive: !direction.isActive,
                    })
                  }
                >
                  {direction.isActive ? 'Выключить' : 'Включить'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Ставка ступени: доля в процентах и фикс, порознь или вместе, — так
 * владелец задаёт евро («3,3 % и 10 EUR сверху»). Фикс один, и валюту
 * ему называет администратор: доллары вычитаются до перевода по курсу,
 * валюта выдачи — после. Двух фиксов разом не бывает — это означало бы,
 * что никто не знает, сколько стоит обмен, и такую строку отвергнет
 * ядро.
 */
type FixedCurrency = 'usd' | 'payout';

interface TierDraft {
  /** Пусто у последней ступени: она действует на всё, что выше. */
  readonly upToUsd: string;
  /** Доля в процентах; пустая строка — доли нет. */
  readonly rate: string;
  /** Фикс; пустая строка — фикса нет. */
  readonly fixed: string;
  /** В чём задан фикс: доллары или валюта выдачи. */
  readonly fixedIn: FixedCurrency;
}

/**
 * С чего начинается новая сетка — ступени бата на банк, те самые, что
 * заводит скрипт развёртывания.
 *
 * Не «пустая форма»: администратор правит цифры, а не изобретает
 * устройство сетки, и четыре ступени с фиксом на нижней — это форма, о
 * которой уже договорились с владельцем. Числа он поправит под свою
 * валюту, а порядок «фикс, потом убывающие проценты» останется.
 */
const DEFAULT_TIERS: readonly TierDraft[] = [
  { upToUsd: '500', rate: '', fixed: '5', fixedIn: 'usd' },
  { upToUsd: '2000', rate: '4.5', fixed: '', fixedIn: 'usd' },
  { upToUsd: '5000', rate: '3.5', fixed: '', fixedIn: 'usd' },
  { upToUsd: '', rate: '2.5', fixed: '', fixedIn: 'usd' },
];

function toDrafts(tiers: FeeScheduleView['tiers']): TierDraft[] {
  return tiers.map((tier) => ({
    upToUsd: tier.upToUsd ?? '',
    rate: tier.rateBps === undefined ? '' : bpsToPercent(tier.rateBps),
    fixed: tier.fixedUsd ?? tier.fixedPayout ?? '',
    fixedIn: tier.fixedPayout === undefined ? 'usd' : 'payout',
  }));
}

/**
 * Число в поле ступени — хоть с запятой, хоть с точкой, но не больше
 * двух знаков после разделителя.
 *
 * Предел здесь не про точность, а про разделитель тысяч: «5,000»
 * набирают, имея в виду пять тысяч, а запятая читается как десятичная —
 * и порог молча становится пятью долларами. Три знака после запятой не
 * нужны ни доллару, ни ставке (её шаг — сотая процента), поэтому такая
 * строка не принимается вовсе, и кнопка сохранения гаснет.
 */
function isAmount(value: string): boolean {
  return /^\d+([.,]\d{1,2})?$/.test(value.trim());
}

/**
 * Кнопка гаснет на недобранной сетке: отправленная, она вернулась бы
 * отказом ядра, а администратор видит перед собой поле, в котором
 * опечатка. Возрастание порогов здесь не проверяется — это правило
 * домена, и отвечает за него операция: два места, где оно записано,
 * однажды разойдутся.
 */
function draftsReady(drafts: readonly TierDraft[]): boolean {
  // Пустая сетка — не «всё в порядке»: у `every` пустой набор истинен, и
  // без этой проверки кнопка горела бы на сетке без единой ступени.
  if (drafts.length === 0) return false;

  return drafts.every((draft, index) => {
    const last = index === drafts.length - 1;
    const threshold = last || isAmount(draft.upToUsd);
    // Хотя бы одна ставка на ступень, и каждая заполненная — число.
    const hasAny = draft.rate.trim() !== '' || draft.fixed.trim() !== '';
    const rateOk = draft.rate.trim() === '' || isAmount(draft.rate);
    const fixedOk = draft.fixed.trim() === '' || isAmount(draft.fixed);
    return threshold && hasAny && rateOk && fixedOk;
  });
}

function toTiers(drafts: readonly TierDraft[]) {
  return drafts.map((draft, index) => ({
    upToUsd:
      index === drafts.length - 1 ? null : draft.upToUsd.replace(',', '.').trim(),
    ...(draft.rate.trim() === '' ? {} : { rateBps: percentToBps(draft.rate) ?? 0 }),
    ...(draft.fixed.trim() === ''
      ? {}
      : draft.fixedIn === 'payout'
        ? { fixedPayout: draft.fixed.replace(',', '.').trim() }
        : { fixedUsd: draft.fixed.replace(',', '.').trim() }),
  }));
}

/**
 * Комиссия по ступеням: сетка на валюту и способ выдачи.
 *
 * Ставки — решение о деньгах, и меняет их администратор, а не выкатка:
 * владелец присылает таблицу письмом, и между письмом и ценой на экране
 * не должно стоять ни релиза, ни разработчика.
 *
 * Направление, у которого сетки нет, считается наценкой — той единой
 * ставкой, что задана выше. Это не «обмен закрыт», а другая цена: у
 * обмена USDT на рубли своя экономика, и ступени бата туда не
 * переносятся.
 */
export function FeeSchedules({
  schedules,
  directions,
  busy,
  onSend,
}: {
  schedules: readonly FeeScheduleView[];
  directions: readonly DirectionView[];
  busy: boolean;
  onSend: (path: string, body: unknown) => Promise<unknown>;
}) {
  // Валюты, которые сервис выдаёт: сетка назначает цену выдачи, и
  // предлагать в ней валюту, которой сервис не отдаёт, незачем.
  const codes = [...new Set(directions.map((direction) => direction.toCode))].sort();
  const [newCode, setNewCode] = useState(codes[0] ?? '');
  const [newMethod, setNewMethod] = useState<PayoutMethod>('bank');

  const taken = schedules.some(
    (schedule) => schedule.toCode === newCode && schedule.payoutMethod === newMethod,
  );

  return (
    <section className="card">
      <h2 className="card__title">Комиссия по ступеням</h2>
      <p className="card__note">
        Ставка берётся от всей суммы, а не от превышения над порогом: отдавший 500,01 $
        платит по следующей ступени целиком. Пороги заданы в долларах — клиент их не
        видит, они нужны, чтобы у всех валют ступени считались одной линейкой. Порог «До»
        читается так, как написано в ТЗ на эту валюту: у бата и юаня «до 2 000
        включительно», у доллара «меньше 2 000» — ровно две тысячи там уже верхняя
        ступень; знак выбирается у сетки целиком. Последняя
        ступень действует на всё, что выше. У ступени доля и фикс заполняются порознь или
        вместе — «3,3 % и 10 EUR сверху» задаётся одной строкой. Фикс в долларах
        вычитается до перевода по курсу, фикс в валюте выдачи — после: десять евро
        остаются десятью при любом курсе. Там, где сетки нет, цену назначает наценка;
        выключенная сетка к ней и возвращает, а не закрывает направление. Новая сетка
        заводится выключенной со ступенями бата — поправьте числа под свою валюту и
        включите: включённая сразу меняет цену тем, кто в эту минуту считает обмен.
      </p>
      <p className="card__note">
        У наличных ставка своя и работает иначе: пока её нет, курс наличной сделки не
        называется вовсе — клиент подаёт заявку, а цену говорит менеджер, как было
        всегда. С первой включённой ступенью курс появляется у клиента на экране и
        записывается в заявку так же, как безналичный: сервис его держит, и менеджер
        поверх не назначает.
      </p>

      {schedules.length === 0 ? (
        <p className="empty">
          Сеток пока нет — обмен считается по наценке. Заведите сетку той валюте, на
          которую владелец прислал таблицу ставок.
        </p>
      ) : (
        <div className="rows">
          {schedules.map((schedule) => (
            // Ключ с отметкой правки: после сохранения страница
            // перечитывается, и карточка должна показать сохранённое, а
            // не то, что осталось в полях от прошлого набора.
            <FeeScheduleCard
              key={`${schedule.id}:${String(schedule.updatedAt)}`}
              schedule={schedule}
              busy={busy}
              onSend={onSend}
            />
          ))}
        </div>
      )}

      <div className="form-row">
        <label className="field field--narrow">
          <span className="label">Валюта выдачи</span>
          <select
            className="input"
            value={newCode}
            onChange={(event) => setNewCode(event.target.value)}
          >
            {codes.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>
        {/* Способ назван словами, и в узкое поле подпись не помещается. */}
        <label className="field field--wide">
          <span className="label">Способ выдачи</span>
          <select
            className="input"
            value={newMethod}
            onChange={(event) => setNewMethod(event.target.value as PayoutMethod)}
          >
            {Object.entries(FEE_PAYOUT_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={busy || !newCode || taken}
          className="btn btn--ghost"
          onClick={() =>
            onSend('/api/fee-schedules', {
              action: 'save',
              toCode: newCode,
              payoutMethod: newMethod,
              tiers: toTiers(DEFAULT_TIERS),
            })
          }
        >
          Завести сетку
        </button>
      </div>
      {taken ? (
        <p className="card__note">
          Такая сетка уже заведена — правьте её выше. Заведение поверх переписало бы
          ставки значениями по умолчанию.
        </p>
      ) : undefined}
    </section>
  );
}

/** Одна сетка: ступени правятся здесь же, целиком и одним сохранением. */
function FeeScheduleCard({
  schedule,
  busy,
  onSend,
}: {
  schedule: FeeScheduleView;
  busy: boolean;
  onSend: (path: string, body: unknown) => Promise<unknown>;
}) {
  const [drafts, setDrafts] = useState<TierDraft[]>(() => toDrafts(schedule.tiers));
  const [minUsd, setMinUsd] = useState(schedule.minUsd ?? '');
  const [inclusive, setInclusive] = useState(schedule.thresholdInclusive);

  function change(index: number, patch: Partial<TierDraft>) {
    setDrafts((current) =>
      current.map((draft, at) => (at === index ? { ...draft, ...patch } : draft)),
    );
  }

  // Пустое поле — «порога нет», а не ноль: набранный ноль гасит
  // кнопку, иначе о нём рассказал бы отказ ядра после нажатия.
  const minReady =
    minUsd.trim() === '' ||
    (isAmount(minUsd) && Number(minUsd.replace(',', '.')) > 0);

  return (
    <div className="row row--stack">
      <div className="row__side" style={{ justifyContent: 'space-between' }}>
        <div className="row__main">
          <span className="row__title">
            {schedule.toCode} · {FEE_PAYOUT_LABELS[schedule.payoutMethod]}
          </span>
          <span className="row__meta">
            {schedule.isActive ? 'Действует' : 'Выключена — считается по наценке'}
          </span>
        </div>
        {schedule.isActive ? undefined : <span className={pillClass('off')}>Выключена</span>}
      </div>

      {/*
        Минимум относится к направлению целиком, а не к ступени, потому
        и стоит над лестницей. Клиент видит его до подачи, подача ниже
        порога отвергается; общий минимум сервиса действует поверх.
      */}
      <div className="form-row">
        <label className="field field--narrow">
          <span className="label">Минимум, $</span>
          <input
            className="input"
            value={minUsd}
            onChange={(event) => setMinUsd(event.target.value)}
            placeholder="порога нет"
            inputMode="decimal"
          />
        </label>
        {/*
          Знак границы — свойство сетки, а не ступени: владелец пишет
          одним знаком всю лестницу. У бата и юаня «до 2 000
          включительно», у доллара «меньше 2 000» — ровно две тысячи там
          уже верхняя ступень.
        */}
        <label className="field field--wide">
          <span className="label">Порог «До, $»</span>
          <select
            className="input"
            value={inclusive ? 'inclusive' : 'strict'}
            onChange={(event) => setInclusive(event.target.value === 'inclusive')}
          >
            <option value="inclusive">включительно (≤)</option>
            <option value="strict">не включая (&lt;)</option>
          </select>
        </label>
      </div>

      {drafts.map((draft, index) => {
        const last = index === drafts.length - 1;
        return (
          <div className="form-row" key={index}>
            <label className="field field--narrow">
              <span className="label">До, $</span>
              {/*
                У последней ступени порога нет, и вместо подписи сбоку
                тут стоит погашенное поле: колонка полей остаётся
                колонкой, а короткая строка вместо ввода уводила бы
                подпись выше соседних.
              */}
              <input
                className="input"
                value={last ? 'и всё, что выше' : draft.upToUsd}
                onChange={(event) => change(index, { upToUsd: event.target.value })}
                inputMode="decimal"
                disabled={last}
              /></label>
            {/*
              Доля и фикс — два поля, а не переключатель: владелец задаёт
              евро как «3,3 % и 10 EUR сверху», и ступень несёт обе части
              разом. Пустое поле значит «этой части нет».
            */}
            <label className="field field--narrow">
              <span className="label">Доля, %</span>
              <input
                className="input"
                value={draft.rate}
                onChange={(event) => change(index, { rate: event.target.value })}
                inputMode="decimal"
              />
            </label>
            <label className="field field--narrow">
              <span className="label">Фикс</span>
              <input
                className="input"
                value={draft.fixed}
                onChange={(event) => change(index, { fixed: event.target.value })}
                inputMode="decimal"
              />
            </label>
            <label className="field field--narrow">
              <span className="label">Валюта фикса</span>
              {/*
                Доллары вычитаются до перевода по курсу, валюта выдачи —
                после: десять евро остаются десятью при любом курсе, а
                десять долларов — переменным числом евро.

                Со сменой валюты поле фикса очищается: десять долларов,
                оставшиеся в поле после переключения на баты, становятся
                десятью батами — и уезжают в ядро, потому что число само
                по себе годное.
              */}
              <select
                className="input"
                value={draft.fixedIn}
                onChange={(event) =>
                  change(index, {
                    fixedIn: event.target.value as FixedCurrency,
                    fixed: '',
                  })
                }
              >
                <option value="usd">$</option>
                <option value="payout">{schedule.toCode}</option>
              </select>
            </label>
            <button
              type="button"
              // Последнюю ступень убрать нельзя: без неё у сетки нет
              // цены для сумм выше верхнего порога.
              disabled={busy || last}
              className="btn btn--ghost"
              onClick={() => setDrafts((current) => current.filter((_, at) => at !== index))}
            >
              Убрать
            </button>
          </div>
        );
      })}

      <div className="row__actions">
        <button
          type="button"
          disabled={busy}
          className="btn btn--ghost"
          onClick={() =>
            // Новая ступень встаёт перед последней: та действует на всё,
            // что выше, и остаётся последней всегда.
            setDrafts((current) => [
              ...current.slice(0, -1),
              { upToUsd: '', rate: '', fixed: '', fixedIn: 'usd' },
              ...current.slice(-1),
            ])
          }
        >
          Добавить ступень
        </button>
        <button
          type="button"
          disabled={busy || !draftsReady(drafts) || !minReady}
          className="btn btn--gold"
          onClick={() =>
            onSend('/api/fee-schedules', {
              action: 'save',
              toCode: schedule.toCode,
              payoutMethod: schedule.payoutMethod,
              // Пустой минимум не отправляется вовсе: не присланный,
              // он снимается — сетка сохраняется целиком.
              ...(minUsd.trim() === ''
                ? {}
                : { minUsd: minUsd.replace(',', '.').trim() }),
              thresholdInclusive: inclusive,
              tiers: toTiers(drafts),
            })
          }
        >
          Сохранить ставки
        </button>
        <button
          type="button"
          disabled={busy}
          className={schedule.isActive ? 'btn btn--danger' : 'btn btn--ghost'}
          onClick={() =>
            onSend('/api/fee-schedules', {
              action: 'active',
              scheduleId: schedule.id,
              isActive: !schedule.isActive,
            })
          }
        >
          {schedule.isActive ? 'Выключить' : 'Включить'}
        </button>
      </div>
    </div>
  );
}

/**
 * Сети перевода: флажок на каждую.
 *
 * Состав справочника здесь не меняется — его наполняет скрипт
 * развёртывания. Отсюда администратор гасит сеть на время, пока кошелёк
 * в ней недоступен.
 */
export function TransferNetworks({
  networks,
  busy,
  onToggle,
}: {
  networks: readonly NetworkView[];
  busy: boolean;
  onToggle: (path: string, body: unknown) => Promise<unknown>;
}) {
  return (
    <section className="card">
      <h2 className="card__title">Сети перевода</h2>
      <p className="card__note">
        Один справочник на реквизиты обмена и на выплаты: выключенная сеть перестаёт
        предлагаться и там и там. Выключайте её, пока кошелёк недоступен, — сохранённые
        клиентами адреса в ней при этом не пропадают.
      </p>
      {networks.length === 0 ? (
        <p className="empty">Сети ещё не заведены: их создаёт скрипт развёртывания.</p>
      ) : (
        <ul className="rows">
          {networks.map((network) => (
            <li key={network.code} className="row">
              <div className="row__main">
                <span className="row__title">{network.code}</span>
                <span className="row__meta">
                  {network.isActive ? 'Предлагается клиентам' : 'Выключена'}
                </span>
              </div>
              <div className="row__actions">
                <button
                  type="button"
                  disabled={busy}
                  className={network.isActive ? 'btn btn--danger' : 'btn btn--ghost'}
                  onClick={() =>
                    onToggle('/api/networks', {
                      code: network.code,
                      isActive: !network.isActive,
                    })
                  }
                >
                  {network.isActive ? 'Выключить' : 'Включить'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>

  );
}
