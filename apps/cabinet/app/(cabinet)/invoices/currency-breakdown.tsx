'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { CurrencyFlag } from '@nemo/flags';
import { currencyName, currencyPlace } from '@nemo/types';
import { Icon } from '@nemo/ui';

/** Строка разбора: валюта и оплаченное в ней текстом, собранным сервером. */
export interface BreakdownLine {
  readonly code: string;
  /** «850 CNY». Пусто — оплат в этой валюте не было. */
  readonly amount: string | null;
  readonly count: number;
  /** Адрес страницы с этой валютой в «Оборот в». */
  readonly href: string;
}

/** Сколько строк плитка показывает свёрнутой: дальше она вытягивалась бы выше соседей. */
const FOLDED = 3;

/**
 * Плитка «По валютам» с раскрытием: свёрнутой — до трёх валют, в которых
 * были оплаты, нажатием — все валюты сервиса, и пустые тоже, потому что
 * «юаней не продавали» — такой же ответ, как «продали на 850».
 *
 * Строка раскрытого списка переключает «Оборот в» на эту валюту: список
 * отвечает «где были деньги», и следующий вопрос — «сколько из них
 * осталось после возвратов» — задают той же валюте.
 *
 * Закрывается повтором, клавишей выхода и нажатием мимо — тем же
 * набором, что выбор валюты оборота и «Вид таблицы».
 */
export function CurrencyBreakdown({
  lines,
  selected,
}: {
  readonly lines: readonly BreakdownLine[];
  readonly selected: string;
}) {
  /*
   * Где стоит список: фиксированным слоем от нижнего правого угла
   * кнопки. Ряд плиток обрезает всё, что выходит за его скруглённые
   * края, и список внутри него был бы виден на одну строку. При
   * прокрутке и смене размера окна список закрывается: пересчитывать
   * место на каждый кадр прокрутки — работа, которой никто не ждёт.
   */
  const [place, setPlace] = useState<{
    /** Вниз от кнопки — `top`, вверх — `bottom`; второе пусто. */
    top?: number;
    bottom?: number;
    left: number;
    width: number;
    maxHeight: number;
    host: Element;
  } | null>(null);
  const open = place !== null;
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const face = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);

  function toggle(): void {
    if (open || !face.current) {
      setPlace(null);
      return;
    }
    // Правым краем к кнопке, но в пределах экрана: на телефоне плитка
    // стоит у левого края, и список шире неё уехал бы за границу.
    const rect = face.current.getBoundingClientRect();
    const width = Math.min(320, window.innerWidth - 16);
    const left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8);
    // Хозяин слоя — обёртка с темой кабинета (`data-theme`): в `body`
    // список получил бы токены тёмной витрины.
    const host = face.current.closest('[data-theme]') ?? document.body;
    // Вниз, если там хватает места на список, иначе вверх — на телефоне
    // плитка стоит низко, и список вниз уходил за край экрана. Высота —
    // не больше видимой части: остальное прокручивается внутри.
    const below = window.innerHeight - rect.bottom - 16;
    const above = rect.top - 16;
    const up = below < 320 && above > below;
    setPlace(
      up
        ? { bottom: window.innerHeight - rect.top + 8, left, width, maxHeight: Math.min(420, above), host }
        : { top: rect.bottom + 8, left, width, maxHeight: Math.min(420, below), host },
    );
  }

  useEffect(() => {
    if (!open) return;
    const close = (): void => setPlace(null);
    const away = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (!root.current?.contains(target) && !list.current?.contains(target)) close();
    };
    // Клавиша выхода возвращает фокус на кнопку: работающий с клавиатуры
    // остаётся там, откуда открыл, а не в начале страницы.
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      close();
      face.current?.focus();
    };
    // Прокрутка самого списка его не закрывает — иначе до последних
    // валют на невысоком экране было бы не долистать.
    const scrolled = (event: Event): void => {
      if (!list.current?.contains(event.target as Node)) close();
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', escape);
    window.addEventListener('scroll', scrolled, { capture: true, passive: true });
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('scroll', scrolled, { capture: true });
      window.removeEventListener('resize', close);
    };
  }, [open]);

  /*
   * С клавиатуры: при раскрытии фокус встаёт на выбранную валюту — список
   * порталом в конце обёртки, и Tab с кнопки ушёл бы по всей странице.
   * Уход фокуса из списка его закрывает. Фокус без прокрутки: прокрутка
   * к нему закрыла бы список раньше, чем его увидят.
   */
  useEffect(() => {
    if (!open || !list.current) return;
    const target =
      list.current.querySelector<HTMLElement>('.breakdown__item--on') ??
      list.current.querySelector<HTMLElement>('.breakdown__item');
    target?.focus({ preventScroll: true });
  }, [open]);

  const paid = lines.filter((line) => line.amount !== null);
  const shown = paid.slice(0, FOLDED);
  const more = paid.length - shown.length;

  return (
    <div ref={root} className="breakdown">
      <button
        ref={face}
        type="button"
        className="breakdown__face"
        aria-expanded={open}
        aria-controls={id}
        onClick={toggle}
      >
        {shown.length === 0 ? (
          <span className="breakdown__empty">оплат пока нет</span>
        ) : (
          <ul className="money-flags">
            {shown.map((line) => (
              <li key={line.code} className="money-flags__row">
                <CurrencyFlag code={line.code} size={18} />
                <span className="money-flags__amount">{line.amount}</span>
              </li>
            ))}
          </ul>
        )}
        <span className="breakdown__more">
          {more > 0 ? `ещё ${more} · ` : ''}все валюты
          <Icon name="chevron" size={14} />
        </span>
      </button>

      {/*
        Порталом в обёртку кабинета: на `main.page` после анимации
        появления остаётся `transform`, и `position: fixed` внутри неё
        отсчитывался от страницы, а не от окна, — список уезжал на сотни
        пикселей. Нажатие «мимо» проверяет и кнопку, и сам список: в
        DOM он теперь не внутри `root`.
      */}
      {place
        ? createPortal(
        <div
          ref={list}
          id={id}
          className="breakdown__list"
          role="dialog"
          aria-label="Оплаченное по всем валютам"
          onBlur={(event) => {
            const next = event.relatedTarget as Node | null;
            if (next && !list.current?.contains(next) && !root.current?.contains(next)) {
              setPlace(null);
            }
          }}
          style={{
            top: place.top,
            bottom: place.bottom,
            left: place.left,
            width: place.width,
            maxHeight: place.maxHeight,
          }}
        >
          {lines.map((line) => (
            <Link
              key={line.code}
              href={line.href}
              scroll={false}
              className={line.code === selected ? 'breakdown__item breakdown__item--on' : 'breakdown__item'}
              aria-label={`${currencyName(line.code)}: ${line.amount ?? 'покупателям не выдавали'}. Считать оборот в ${line.code}`}
              onClick={() => setPlace(null)}
            >
              <CurrencyFlag code={line.code} size={18} />
              <span className="breakdown__code">{line.code}</span>
              <span className="breakdown__place">{currencyPlace(line.code) || currencyName(line.code)}</span>
              <span className={line.amount ? 'breakdown__sum' : 'breakdown__sum breakdown__sum--none'}>
                {line.amount ?? '—'}
                {line.count > 0 ? <span className="breakdown__count"> · {line.count}</span> : undefined}
              </span>
            </Link>
          ))}
        </div>,
            place.host,
          )
        : undefined}
    </div>
  );
}
