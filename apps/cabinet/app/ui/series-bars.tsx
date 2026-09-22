'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { MerchantSeriesBar, SeriesStep } from '@nemo/core';
import { SERIES_STEP_KEYS, STEP_LABELS } from '@/lib/analytics-texts';
import { barLabel, barLabelled, barTitle } from '@/lib/series-labels';

/**
 * Подано и исполнено по шагу — столбиками, с наведением и выбором шага.
 *
 * Столбики, а не линия: это счётчики за отрезок, и между вторником и
 * средой ничего не происходит — линия обещала бы непрерывную величину.
 * У мерчанта их к тому же единицы в день, и ломаная по таким числам
 * читается как зубцы, а не как движение.
 *
 * Цель наведения — вся колонка вместе с пустым местом над столбиками:
 * попасть в двухпиксельную марку нельзя ни мышью, ни пальцем.
 * Подсвеченная колонка заодно играет роль курсора, за которым человек
 * следит на биржевом графике, — только курсор здесь прилипает к
 * корзине, а не гуляет между ними.
 *
 * Подсказка показывает **оба** ряда сразу: наводят на день, а не на
 * ряд, и вопрос у читателя один — «что было в этот день». Число в ней
 * крупное, название ряда тихое: ряд человек уже выбрал глазами, ему
 * нужна величина.
 *
 * Цвета взяты не на глаз: пара проверена на различимость при
 * дальтонизме и на контраст с поверхностью (скилл `dataviz`,
 * `validate_palette.js`). Прежний «подано» был серым и проваливал
 * проверку насыщенности — серый читается как отсутствие данных, а не
 * как ряд.
 *
 * Шаг переключается самим заголовком, а не четырьмя кнопками рядом:
 * ряд один, и четыре равноправные кнопки над ним обещали бы четыре
 * разных показателя. Живёт шаг в адресе, а не в состоянии: ряд считает
 * ядро — за неделями стоят двенадцать недель, а не те же две, — и
 * ссылку на свой разрез мерчант может отправить бухгалтеру.
 */

export function SeriesBars({
  bars,
  step,
  hrefs,
  note,
}: {
  readonly bars: readonly MerchantSeriesBar[];
  readonly step: SeriesStep;
  /** Пояснение под заголовком: что за числа и за какой отрезок. */
  readonly note: string;
  /**
   * Адрес этого же экрана с каждым шагом. Готовыми строками, а не
   * функцией: между сервером и клиентом ездят данные, и собрать их
   * здесь нечем — период живёт в адресе, а его знает страница.
   */
  readonly hrefs: Readonly<Record<SeriesStep, string>>;
}) {
  const [active, setActive] = useState<number | null>(null);
  /*
   * У шкалы мягкий потолок: без него отрезок с единственной заявкой
   * упирается в верх кадра — максимум-то равен единице, — и ряд
   * выглядит частоколом одинаковых столбиков, по которому нечего
   * сравнивать. Потолок не врёт: столбик по-прежнему пропорционален
   * числу, просто кадр перестаёт схлопываться на малых величинах.
   */
  const top = Math.max(3, ...bars.map((one) => Math.max(one.submitted, one.completed)));
  const shown = active === null ? undefined : bars[active];
  const labelled = barLabelled(bars.length, step);

  return (
    <div className="bars-figure">
      <StepMenu step={step} hrefs={hrefs} />
      <p className="card__note">{note}</p>

      <div
        className="bars"
        style={{ '--bars': bars.length } as React.CSSProperties}
        onPointerLeave={() => setActive(null)}
      >
        {bars.map((one, index) => (
          <button
            key={one.at}
            type="button"
            className={index === active ? 'bars__day bars__day--active' : 'bars__day'}
            onPointerEnter={() => setActive(index)}
            onFocus={() => setActive(index)}
            onBlur={() => setActive(null)}
            /*
             * Читающему с экрана колонка называет всё сразу: он не водит
             * указателем и подсказки не увидит. Называет целиком, а не
             * сокращением с подписи: «III·26» вслух — не квартал.
             */
            aria-label={`${barTitle(one.at, step)}: подано ${one.submitted}, исполнено ${one.completed}`}
          >
            <span className="bars__pair">
              <span
                className={one.submitted ? 'bars__bar bars__bar--sent' : 'bars__bar bars__bar--none'}
                style={{ height: `${Math.round((one.submitted / top) * 100)}%` }}
              />
              <span
                className={one.completed ? 'bars__bar bars__bar--done' : 'bars__bar bars__bar--none'}
                style={{ height: `${Math.round((one.completed / top) * 100)}%` }}
              />
            </span>
            <span className="bars__label" aria-hidden="true">
              {labelled[index] ? barLabel(one.at, step) : ''}
            </span>
          </button>
        ))}
      </div>

      {/*
        Легенда обязательна: рядов два, и различать их одним цветом
        нельзя — читатель с дальтонизмом останется без ключа. Ключ
        повторяет форму марки: у столбиков это прямоугольник.
      */}
      <p className="bars__legend">
        <span className="bars__key bars__key--sent" /> подано
        <span className="bars__key bars__key--done" /> исполнено
      </p>

      {/*
        Строка под графиком, а не плавающий пузырь: он закрывал бы
        соседние столбики — те самые, с которыми читатель и сравнивает.
        Место у строки занято всегда, поэтому при наведении ничего не
        прыгает.
      */}
      <p className="bars__readout" aria-hidden="true">
        {shown ? (
          <>
            <span className="bars__readout-day">{barTitle(shown.at, step)}</span>
            <span className="bars__readout-pair">
              <span className="bars__key bars__key--sent" />
              <b>{shown.submitted}</b> подано
            </span>
            <span className="bars__readout-pair">
              <span className="bars__key bars__key--done" />
              <b>{shown.completed}</b> исполнено
            </span>
          </>
        ) : (
          <span className="bars__readout-hint">Наведите на столбик — покажем числа</span>
        )}
      </p>
    </div>
  );
}

/**
 * Выбор шага — заголовком карточки.
 *
 * Меню на `<details>`, как в шапке: открывается и закрывается само, без
 * состояния, и работает с клавиатуры без единой строки о фокусе. Своё
 * тут — закрытие: пункт ведёт на этот же экран, страница не
 * перерисовывается целиком, и раскрытый список остался бы висеть над
 * обновившимся рядом. Закрывает его и клавиша выхода, и нажатие мимо, —
 * без них меню ведёт себя не как меню.
 */
function StepMenu({
  step,
  hrefs,
}: {
  readonly step: SeriesStep;
  readonly hrefs: Readonly<Record<SeriesStep, string>>;
}) {
  const box = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return;
      if (event.type === 'pointerdown' && box.current?.contains(event.target as Node)) return;
      if (box.current) box.current.open = false;
      setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  return (
    <details
      className="steps"
      ref={box}
      onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="steps__summary">
        <h2 className="card__title">{STEP_LABELS[step]}</h2>
        <svg className="steps__chevron" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </summary>
      <ul className="steps__list">
        {SERIES_STEP_KEYS.map((key) => (
          <li key={key}>
            <Link
              href={hrefs[key]}
              className={key === step ? 'steps__item steps__item--on' : 'steps__item'}
              scroll={false}
              onClick={() => {
                if (box.current) box.current.open = false;
                setOpen(false);
              }}
            >
              {STEP_LABELS[key]}
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}
