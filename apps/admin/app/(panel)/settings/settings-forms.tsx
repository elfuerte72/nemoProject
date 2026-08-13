'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type {
  DirectionView,
  FeeScheduleView,
  NetworkView,
  ServiceSettingsView,
  StaffView,
} from '@nemo/core';
import type { StaffRole } from '@nemo/types';
import { KIND_LABELS } from '@/lib/exchange-request-labels';
import { FEE_PAYOUT_LABELS, pillClass, ROLE_LABELS } from '@/lib/labels';
import { bpsToPercent, isWholeNumber, percentToBps } from '@/lib/percent';

/**
 * Раздел администратора: экономика сервиса и сотрудники.
 *
 * Смена ставок действует вперёд: уже сделанные начисления не
 * пересчитываются, потому что ставка, по которой начислено, хранится в
 * самом движении баллов. Экран говорит об этом прямо — иначе
 * администратор ждал бы пересчёта и не понимал, почему его нет.
 *
 * Экономика собрана в одну карточку: наценка, минимум обмена и срок
 * жизни заявки складываются в доход сервиса, и разнесённые по разным
 * местам они не читались бы вместе.
 */

type StaffForDisplay = Omit<StaffView, 'telegramUserId'> & { telegramUserId: string };

export function SettingsForms({
  settings,
  networks,
  directions,
  feeSchedules,
  staff,
}: {
  settings: ServiceSettingsView;
  networks: readonly NetworkView[];
  directions: readonly DirectionView[];
  feeSchedules: readonly FeeScheduleView[];
  staff: readonly StaffForDisplay[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<{
    name: string;
    value: string;
    qr?: string | undefined;
  }>();

  const [line1, setLine1] = useState(bpsToPercent(settings.referralLine1Bps));
  const [line2, setLine2] = useState(bpsToPercent(settings.referralLine2Bps));
  const [minWithdrawal, setMinWithdrawal] = useState<string>(settings.minWithdrawalAmount);
  const [markup, setMarkup] = useState(bpsToPercent(settings.markupBps));
  const [minExchange, setMinExchange] = useState<string>(settings.minExchangeAmount);
  const [ttlMinutes, setTtlMinutes] = useState(String(settings.unpaidExchangeRequestTtlMinutes));
  const [perClientDaily, setPerClientDaily] = useState(
    String(settings.conciergeRepliesPerClientDaily),
  );
  const [totalDaily, setTotalDaily] = useState(String(settings.conciergeRepliesDaily));

  const [newTelegram, setNewTelegram] = useState('');
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<StaffRole>('manager');

  async function send(
    path: string,
    body: unknown,
  ): Promise<{ enrollmentSecret?: string; qr?: string; staff?: StaffView } | undefined> {
    setError(undefined);
    setBusy(true);
    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as {
        error?: string;
        enrollmentSecret?: string;
        qr?: string;
        staff?: StaffView;
      };
      if (!response.ok) {
        setError(payload.error ?? 'Настройка не сохранена');
        return undefined;
      }
      router.refresh();
      return payload;
    } catch {
      setError('Не удалось связаться с сервером. Повторите попытку.');
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function enroll(body: unknown, name: string) {
    const result = await send('/api/staff', body);
    if (result?.enrollmentSecret) {
      setSecret({ name, value: result.enrollmentSecret, qr: result.qr });
    }
  }

  return (
    <>
      {error ? <p className="error">{error}</p> : undefined}

      {secret ? (
        <section className="card secret">
          <h2 className="card__title">Второй фактор для «{secret.name}»</h2>
          <p className="card__note">
            Наведите камеру приложения-аутентификатора — Google Authenticator, Яндекс
            Ключ, 1Password. Здесь ключ показывается один раз, но передавать его из рук
            в руки не обязательно: пока этим ключом ни разу не входили, сотрудник
            увидит тот же код на своём первом входе. Запись в приложении подписана
            Telegram сотрудника и его ролью.
          </p>
          {secret.qr ? (
            // Разметка кода приходит с сервера и содержит только фигуры,
            // собранные из ключа, — ни ввода пользователя, ни ссылок.
            <div className="secret__qr" dangerouslySetInnerHTML={{ __html: secret.qr }} />
          ) : undefined}
          <div className="field">
            <span className="label">Если камеры нет — ключ вручную</span>
            <code className="secret__key mono">{secret.value}</code>
          </div>
          <div className="row__actions">
            <button type="button" onClick={() => setSecret(undefined)} className="btn btn--soft">
              Готово, скрыть
            </button>
          </div>
        </section>
      ) : undefined}

      <section className="card">
        <h2 className="card__title">Ставки линий и вывод</h2>
        <p className="card__note">
          Ставка задаётся в процентах от дохода сервиса по заявке; шаг — сотая процента.
          Уже сделанные начисления от смены ставки не меняются — заявка исполнена на тех
          условиях, что действовали в момент её исполнения.
        </p>
        <div className="form-row">
          <label className="field">
            <span className="label">Первая линия, %</span>
            <input
              className="input"
              value={line1}
              onChange={(event) => setLine1(event.target.value)}
              inputMode="decimal"
            />
          </label>
          <label className="field">
            <span className="label">Вторая линия, %</span>
            <input
              className="input"
              value={line2}
              onChange={(event) => setLine2(event.target.value)}
              inputMode="decimal"
            />
          </label>
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
          {/*
            Кнопка гаснет на нечисловой ставке: отправленная, она
            вернулась бы отказом ядра про неверное значение — а
            администратор видит перед собой поле, в котором опечатка.
          */}
          <button
            type="button"
            disabled={busy || percentToBps(line1) === null || percentToBps(line2) === null}
            className="btn btn--gold"
            onClick={() =>
              send('/api/settings', {
                referralLine1Bps: percentToBps(line1),
                referralLine2Bps: percentToBps(line2),
                minWithdrawalAmount: minWithdrawal.replace(',', '.').trim(),
              })
            }
          >
            Сохранить
          </button>
        </div>
      </section>

      <section className="card">
        <h2 className="card__title">Экономика обмена</h2>
        <p className="card__note">
          Наценка одна на весь сервис, задаётся в процентах и действует во все стороны:
          она вычитается из курса, и клиент видит сумму уже с ней. Минимальная сумма
          задана в USDT — эту валюту клиент отдаёт или получает в каждом направлении,
          поэтому порог действует на весь список сразу. При наценке в пару процентов
          мелкий обмен не покрывает комиссию сети, которую сервис платит за клиента.
          Срок отсчитывается с момента, когда менеджер выдал реквизиты для оплаты.
        </p>
        <div className="form-row">
          <label className="field">
            <span className="label">Наценка, %</span>
            <input
              className="input"
              value={markup}
              onChange={(event) => setMarkup(event.target.value)}
              inputMode="decimal"
            />
          </label>
          <label className="field">
            <span className="label">Минимум обмена, USDT</span>
            <input
              className="input"
              value={minExchange}
              onChange={(event) => setMinExchange(event.target.value)}
              inputMode="decimal"
            />
          </label>
          <label className="field">
            <span className="label">Срок оплаты, минут</span>
            <input
              className="input"
              value={ttlMinutes}
              onChange={(event) => setTtlMinutes(event.target.value)}
              inputMode="numeric"
            />
          </label>
        </div>
        <div className="row__actions">
          <button
            type="button"
            disabled={busy || percentToBps(markup) === null}
            className="btn btn--gold"
            onClick={() =>
              send('/api/settings', {
                markupBps: percentToBps(markup),
                minExchangeAmount: minExchange.replace(',', '.').trim(),
                unpaidExchangeRequestTtlMinutes: Number(ttlMinutes),
              })
            }
          >
            Сохранить
          </button>
        </div>
      </section>

      <section className="card">
        <h2 className="card__title">Помощник</h2>
        <p className="card__note">
          Сколько ответов помощник даёт за сутки. Предел исчерпан — на вопросы
          отвечает менеджер, как было до помощника. Ноль выключает его совсем.
        </p>
        <div className="form-row">
          <label className="field">
            <span className="label">Одному клиенту</span>
            <input
              className="input"
              value={perClientDaily}
              onChange={(event) => setPerClientDaily(event.target.value)}
              inputMode="numeric"
            />
          </label>
          <label className="field">
            <span className="label">Всему сервису</span>
            <input
              className="input"
              value={totalDaily}
              onChange={(event) => setTotalDaily(event.target.value)}
              inputMode="numeric"
            />
          </label>
        </div>
        <div className="row__actions">
          <button
            type="button"
            disabled={busy || !isWholeNumber(perClientDaily) || !isWholeNumber(totalDaily)}
            className="btn btn--gold"
            onClick={() =>
              send('/api/settings', {
                conciergeRepliesPerClientDaily: Number(perClientDaily),
                conciergeRepliesDaily: Number(totalDaily),
              })
            }
          >
            Сохранить
          </button>
        </div>
      </section>

      <FeeSchedules
        schedules={feeSchedules}
        directions={directions}
        busy={busy}
        onSend={send}
      />

      <ExchangeDirections directions={directions} busy={busy} onToggle={send} />

      <TransferNetworks networks={networks} busy={busy} onToggle={send} />


      <section className="card">
        <h2 className="card__title">Сотрудники</h2>
        <div className="form-row">
          <label className="field field--narrow">
            <span className="label">Telegram ID</span>
            <input
              className="input"
              value={newTelegram}
              onChange={(event) => setNewTelegram(event.target.value)}
              inputMode="numeric"
            />
          </label>
          <label className="field">
            <span className="label">Имя</span>
            <input
              className="input"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
            />
          </label>
          <label className="field field--narrow">
            <span className="label">Роль</span>
            <select
              className="input"
              value={newRole}
              onChange={(event) => setNewRole(event.target.value as StaffRole)}
            >
              {Object.entries(ROLE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={busy}
            className="btn btn--gold"
            onClick={() =>
              void enroll(
                {
                  action: 'add',
                  telegramUserId: newTelegram.trim(),
                  displayName: newName.trim(),
                  role: newRole,
                },
                newName.trim(),
              )
            }
          >
            Завести
          </button>
        </div>

        <ul className="rows">
          {staff.map((one) => (
            <li key={one.id} className="row row--stack">
              <div className="row__side" style={{ justifyContent: 'space-between' }}>
                <div className="row__main">
                  <span className="row__title">{one.displayName}</span>
                  <span className="row__meta">
                    {ROLE_LABELS[one.role]} · {one.telegramUserId}
                  </span>
                </div>
                <div className="row__side">
                  {one.isActive ? undefined : <span className={pillClass('off')}>Доступ закрыт</span>}
                  {one.hasSecondFactor ? undefined : (
                    <span className={pillClass('wait')}>Без второго фактора</span>
                  )}
                  {/*
                    Ключ выдан, но сотрудник им ещё не входил — значит,
                    вход покажет ему этот ключ сам. Администратору это
                    видно здесь: иначе он не поймёт, отчего один
                    сотрудник видит на входе код для камеры, а другой нет.
                  */}
                  {one.hasSecondFactor && !one.secondFactorConfirmed ? (
                    <span className={pillClass('wait')}>Ключ не занесён</span>
                  ) : undefined}
                </div>
              </div>
              <div className="row__actions">
                <button
                  type="button"
                  disabled={busy}
                  className="btn btn--ghost"
                  onClick={() =>
                    send('/api/staff', {
                      action: 'role',
                      staffId: one.id,
                      role: one.role === 'admin' ? 'manager' : 'admin',
                    })
                  }
                >
                  {one.role === 'admin' ? 'Сделать менеджером' : 'Сделать администратором'}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className={one.isActive ? 'btn btn--danger' : 'btn btn--ghost'}
                  onClick={() =>
                    send('/api/staff', {
                      action: 'access',
                      staffId: one.id,
                      isActive: !one.isActive,
                    })
                  }
                >
                  {one.isActive ? 'Отключить' : 'Вернуть доступ'}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className="btn btn--ghost"
                  onClick={() =>
                    void enroll({ action: 'reset-second-factor', staffId: one.id }, one.displayName)
                  }
                >
                  Выдать второй фактор заново
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

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
function ExchangeDirections({
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
 * Ставка ступени: либо сумма в долларах, либо доля. Двух сразу не
 * бывает — сумма и процент в одной строке означали бы, что никто не
 * знает, сколько стоит обмен.
 */
type TierKind = 'fixed' | 'rate';

interface TierDraft {
  /** Пусто у последней ступени: она действует на всё, что выше. */
  readonly upToUsd: string;
  readonly kind: TierKind;
  /** Доллары у фиксированной ставки, проценты у доли. */
  readonly value: string;
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
  { upToUsd: '500', kind: 'fixed', value: '5' },
  { upToUsd: '2000', kind: 'rate', value: '4.5' },
  { upToUsd: '5000', kind: 'rate', value: '3.5' },
  { upToUsd: '', kind: 'rate', value: '2.5' },
];

function payoutLabel(method: FeeScheduleView['payoutMethod']): string {
  return method === 'bank' || method === 'wallet' ? FEE_PAYOUT_LABELS[method] : 'наличными';
}

function toDrafts(tiers: FeeScheduleView['tiers']): TierDraft[] {
  return tiers.map((tier) => ({
    upToUsd: tier.upToUsd ?? '',
    kind: tier.fixedUsd === undefined ? 'rate' : 'fixed',
    value: tier.fixedUsd ?? bpsToPercent(tier.rateBps ?? 0),
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
    return threshold && isAmount(draft.value);
  });
}

function toTiers(drafts: readonly TierDraft[]) {
  return drafts.map((draft, index) => ({
    upToUsd:
      index === drafts.length - 1 ? null : draft.upToUsd.replace(',', '.').trim(),
    ...(draft.kind === 'fixed'
      ? { fixedUsd: draft.value.replace(',', '.').trim() }
      : { rateBps: percentToBps(draft.value) ?? 0 }),
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
function FeeSchedules({
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
  const [newMethod, setNewMethod] = useState<'bank' | 'wallet'>('bank');

  const taken = schedules.some(
    (schedule) => schedule.toCode === newCode && schedule.payoutMethod === newMethod,
  );

  return (
    <section className="card">
      <h2 className="card__title">Комиссия по ступеням</h2>
      <p className="card__note">
        Ставка берётся от всей суммы, а не от превышения над порогом: отдавший 500,01 $
        платит по следующей ступени целиком. Пороги заданы в долларах — клиент их не
        видит, они нужны, чтобы у всех валют ступени считались одной линейкой. Последняя
        ступень действует на всё, что выше. Там, где сетки нет, цену назначает наценка;
        выключенная сетка к ней и возвращает, а не закрывает направление. Новая сетка
        заводится выключенной со ступенями бата — поправьте числа под свою валюту и
        включите: включённая сразу меняет цену тем, кто в эту минуту считает обмен.
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
            onChange={(event) => setNewMethod(event.target.value as 'bank' | 'wallet')}
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

  function change(index: number, patch: Partial<TierDraft>) {
    setDrafts((current) =>
      current.map((draft, at) => (at === index ? { ...draft, ...patch } : draft)),
    );
  }

  return (
    <div className="row row--stack">
      <div className="row__side" style={{ justifyContent: 'space-between' }}>
        <div className="row__main">
          <span className="row__title">
            {schedule.toCode} · {payoutLabel(schedule.payoutMethod)}
          </span>
          <span className="row__meta">
            {schedule.isActive ? 'Действует' : 'Выключена — считается по наценке'}
          </span>
        </div>
        {schedule.isActive ? undefined : <span className={pillClass('off')}>Выключена</span>}
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
            <label className="field field--narrow">
              <span className="label">Вид ставки</span>
              <select
                className="input"
                value={draft.kind}
                onChange={(event) =>
                  /*
                   * Со сменой вида ставки поле очищается: пять долларов,
                   * оставшиеся в поле после переключения на проценты,
                   * становятся пятью процентами — и уезжают в ядро,
                   * потому что число само по себе годное.
                   */
                  change(index, { kind: event.target.value as TierKind, value: '' })
                }
              >
                <option value="fixed">Сумма, $</option>
                <option value="rate">Доля, %</option>
              </select>
            </label>
            <label className="field field--narrow">
              <span className="label">{draft.kind === 'fixed' ? 'Сумма, $' : 'Доля, %'}</span>
              <input
                className="input"
                value={draft.value}
                onChange={(event) => change(index, { value: event.target.value })}
                inputMode="decimal"
              />
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
              { upToUsd: '', kind: 'rate', value: '' },
              ...current.slice(-1),
            ])
          }
        >
          Добавить ступень
        </button>
        <button
          type="button"
          disabled={busy || !draftsReady(drafts)}
          className="btn btn--gold"
          onClick={() =>
            onSend('/api/fee-schedules', {
              action: 'save',
              toCode: schedule.toCode,
              payoutMethod: schedule.payoutMethod,
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
function TransferNetworks({
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
