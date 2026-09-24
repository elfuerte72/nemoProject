'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { PERIOD_LABELS, type PeriodKey } from './period.js';

/** Что показывает панель по умолчанию: смена, неделя, месяц, квартал. */
const PANEL_QUICK: readonly PeriodKey[] = ['today', '7d', '30d', '90d'];

/**
 * Чипы периода и свой отрезок датами — в аналитике панели, в карточке
 * мерчанта и в обзоре кабинета.
 *
 * Выбор живёт в адресе: сводку считает сервер, а ссылку на «прошлые
 * тридцать дней» можно переслать и открыть кнопкой браузера.
 */
export function PeriodChips({
  current,
  from,
  to,
  basePath,
  quick = PANEL_QUICK,
  keep,
  allTime,
  customChip = false,
}: {
  /** Выбранный период. Пусто — периода нет: так бывает только с `allTime`. */
  current: PeriodKey | null;
  /** Раздел, в адрес которого уходит период: у каждого экрана свой. */
  basePath: string;
  /** Границы своего периода днями «2026-09-02» — для полей. */
  from: string;
  to: string;
  /**
   * Набор чипов. У панели дни смены и месяцы, у кабинета амбассадора —
   * те пять, что назвал владелец: спрашивают там не «что сегодня», а
   * «сколько принесло за полгода».
   */
  quick?: readonly PeriodKey[];
  /**
   * Параметры адреса, которые период не должен затирать. У списка заявок
   * рядом с периодом живут таб и поиск, и чип, собравший адрес из одного
   * периода, сбрасывал бы найденное.
   */
  keep?: Readonly<Record<string, string>> | undefined;
  /**
   * Подпись чипа «без периода». Сводку без периода не посчитать, и у
   * обзора его нет; а список без периода — это все записи, и там он
   * стоит первым и выбран по умолчанию.
   */
  allTime?: string | undefined;
  /**
   * Свой период чипом в ряду, а поля дат — только после нажатия на
   * него. Так устроен выбор в аналитике кабинета (по образцу Love&Pay):
   * фильтров там три ряда, и поля, стоящие всегда, отодвигали бы шаг и
   * отбор на вторую строку ради того, чем пользуются реже всего.
   */
  customChip?: boolean;
}) {
  const router = useRouter();
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);
  const [customOpen, setCustomOpen] = useState(current === 'custom');
  const showCustom = !customChip || customOpen || current === 'custom';

  /*
   * Поля идут за периодом. Чип меняет адрес, а не страницу: компонент
   * остаётся тем же, и начальное значение состояния второй раз не
   * читается — после «7 дней» в полях стояли бы даты прежнего периода.
   * Набранное человеком при этом не теряется: границы приходят новыми
   * только тогда, когда период и правда сменился.
   */
  useEffect(() => {
    setDraftFrom(from);
    setDraftTo(to);
  }, [from, to]);

  /*
   * Раскрытые поля своего периода закрываются, когда выбран другой
   * период: компонент переживает смену адреса, и поля от прошлого выбора
   * висели бы под «7 днями».
   */
  useEffect(() => {
    setCustomOpen(current === 'custom');
  }, [current]);

  /** Адрес раздела с периодом — поверх сохраняемых параметров. */
  const hrefWith = (period: Readonly<Record<string, string>>): string => {
    const params = new URLSearchParams({ ...keep, ...period });
    const query = params.toString();
    return query ? `${basePath}?${query}` : basePath;
  };

  return (
    <div className="period">
      <div className="chips">
        {allTime ? (
          <Link
            href={hrefWith({})}
            className={current === null ? 'chip chip--on' : 'chip'}
            scroll={false}
          >
            {allTime}
          </Link>
        ) : undefined}
        {quick.map((key) => (
          <Link
            key={key}
            href={hrefWith({ period: key })}
            className={current === key ? 'chip chip--on' : 'chip'}
            scroll={false}
          >
            {PERIOD_LABELS[key]}
          </Link>
        ))}
        {customChip ? (
          <button
            type="button"
            // Отмечен только применённый период: раскрытые, но не
            // показанные поля — ещё не выбор, и два отмеченных чипа
            // спорили бы, какой период на экране.
            className={current === 'custom' ? 'chip chip--on' : 'chip'}
            aria-expanded={showCustom}
            onClick={() => setCustomOpen((open) => !open || current === 'custom')}
          >
            {PERIOD_LABELS.custom}
          </button>
        ) : undefined}
      </div>
      {showCustom ? (
      <form
        className="period__custom"
        onSubmit={(event) => {
          event.preventDefault();
          router.push(hrefWith({ period: 'custom', from: draftFrom, to: draftTo }));
        }}
      >
        <label className="field field--narrow">
          <span className="label">С</span>
          <input
            className="input"
            type="date"
            value={draftFrom}
            onChange={(event) => setDraftFrom(event.target.value)}
          />
        </label>
        <label className="field field--narrow">
          <span className="label">По</span>
          <input
            className="input"
            type="date"
            value={draftTo}
            onChange={(event) => setDraftTo(event.target.value)}
          />
        </label>
        <button
          type="submit"
          className={current === 'custom' ? 'btn btn--soft' : 'btn btn--ghost'}
          disabled={!draftFrom || !draftTo}
        >
          Показать
        </button>
      </form>
      ) : undefined}
    </div>
  );
}
