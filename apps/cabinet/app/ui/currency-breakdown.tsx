'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as KeyPress } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { CurrencyFlag } from '@nemo/flags';
import { currencyName, currencyPlace } from '@nemo/types';
import { Icon } from '@nemo/ui';

/** Строка разбора: валюта и сумма в ней текстом, собранным сервером. */
export interface BreakdownLine {
  readonly code: string;
  /** «850 CNY». Пусто — денег в этой валюте не было. */
  readonly amount: string | null;
  readonly count: number;
  /**
   * Куда ведёт строка раскрытого списка. Без адреса строка только
   * называет сумму: у «К возврату» переключать нечего.
   */
  readonly href?: string;
}

/** Сколько строк плитка показывает свёрнутой: дальше она вытягивалась бы выше соседей. */
const FOLDED = 3;

/** Зазор между плиткой и списком. */
const GAP = 8;

/**
 * Под чем встаёт список: под плиткой, а не под самой кнопкой. Кнопка —
 * только суммы, под ними у плитки пояснение, и список под кнопкой резал
 * его пополам. Без плитки вокруг — под кнопкой.
 */
function anchorOf(button: HTMLElement): Element {
  return button.closest('.stat') ?? button;
}

/**
 * Поставить слой под плиткой, правым краем к ней, но в пределах экрана:
 * на телефоне плитка стоит у левого края, и список шире неё уехал бы за
 * границу. Ширина экрана — без полосы прокрутки.
 *
 * Слой стоит `absolute`, и от чего он отсчитывается, решает ближайший
 * позиционированный предок, а не хозяин портала. Поэтому начало отсчёта
 * не угадывается, а меряется: слой ставится в ноль, и там, где он
 * оказался, и есть начало. Сам слой не движется и не анимируется —
 * появляется список внутри него, — поэтому замер не сбивает сдвиг
 * появления, а перемер не начинает появление заново.
 */
function placeUnder(layer: HTMLElement, box: Element): void {
  const screen = document.documentElement.clientWidth;
  const width = Math.min(320, screen - 16);
  const rect = box.getBoundingClientRect();
  const left = Math.min(Math.max(8, rect.right - width), screen - width - 8);
  layer.style.width = `${width}px`;
  layer.style.top = '0px';
  layer.style.left = '0px';
  const origin = layer.getBoundingClientRect();
  layer.style.top = `${rect.bottom + GAP - origin.top}px`;
  layer.style.left = `${left - origin.left}px`;
}

/** Что встаёт в фокус по Tab после этого элемента — видимое и доступное с клавиатуры. */
const TABBABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), ' +
  'select:not([disabled]), textarea:not([disabled]), summary, [tabindex]';

function tabbableAfter(from: HTMLElement): HTMLElement {
  const all = [...document.querySelectorAll<HTMLElement>(TABBABLE)].filter(
    (one) => one.tabIndex >= 0 && one.getClientRects().length > 0,
  );
  return all[all.indexOf(from) + 1] ?? from;
}

/**
 * Суммы плитки по валютам с раскрытием: свёрнутой — до трёх валют, в
 * которых были деньги, нажатием — все валюты сервиса, и пустые тоже,
 * потому что «юаней не продавали» — такой же ответ, как «продали на 850».
 * Ею собраны «По валютам» у счетов и «К возврату» у возвратов.
 *
 * Список открывается всегда вниз, под плиткой: так раскрываются списки
 * везде, и глаз ищет продолжение ниже того, что нажал. До 23 сентября
 * 2026 он переворачивался вверх, когда внизу окна не хватало места, и на
 * ноутбуке, где плитки стоят в середине экрана, открывался над ними —
 * владелец прочёл это как ошибку. Места внизу теперь добывает страница:
 * список стоит в её координатах, едет вместе с ней и при нехватке места
 * сам докручивается в поле зрения.
 *
 * Закрывается повтором, клавишей выхода и нажатием мимо — тем же
 * набором, что выбор валюты оборота и «Вид таблицы». Прокрутка его не
 * закрывает: список прокручивается вместе со страницей.
 */
export function CurrencyBreakdown({
  lines,
  selected,
  title,
  empty,
  none,
  action,
}: {
  readonly lines: readonly BreakdownLine[];
  /** Валюта, отмеченная в списке. У разбора без выбора — пусто. */
  readonly selected?: string;
  /** Имя списка для экранного диктора: «Оплаченное по всем валютам». */
  readonly title: string;
  /** Что стоит на плитке, пока сумм нет: «оплат пока нет». */
  readonly empty: string;
  /** Как назвать диктору пустую валюту: «покупателям не выдавали». */
  readonly none: string;
  /** Что делает строка-ссылка, для диктора: «Считать оборот в». К нему дописывается код. */
  readonly action?: string;
}) {
  /*
   * Слой уходит порталом в обёртку кабинета: ряд плиток обрезает всё,
   * что выходит за его скруглённые края, а на `main.page` после
   * анимации появления остаётся `transform`, и отсчёт внутри неё шёл бы
   * от страницы. Хозяин слоя — обёртка с темой (`data-theme`): в `body`
   * список получил бы токены тёмной витрины.
   */
  const [host, setHost] = useState<Element | null>(null);
  const open = host !== null;
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const face = useRef<HTMLButtonElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);

  function toggle(): void {
    if (open || !face.current) {
      setHost(null);
      return;
    }
    setHost(face.current.closest('[data-theme]') ?? document.body);
  }

  /*
   * Место — до первой отрисовки, и дальше оно следует за плиткой: живое
   * обновление меняет пояснения соседних плиток, и ряд становится выше,
   * а на короткой странице открытый список добавляет полосу прокрутки и
   * сужает плитки. Слой перемеряется по размеру плитки и окна, а не
   * закрывается: на телефоне окно меняет высоту, когда при прокрутке
   * сворачивается адресная строка. Докручивается список один раз, при
   * раскрытии: плитка на телефоне стоит низко, и без этого список уходил
   * бы за нижний край; зазор до края окна задаёт `scroll-margin`.
   */
  useLayoutEffect(() => {
    const node = layer.current;
    const button = face.current;
    if (!open || !node || !button) return;
    const box = anchorOf(button);
    const follow = (): void => placeUnder(node, box);
    follow();
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    list.current?.scrollIntoView({ block: 'nearest', behavior: calm ? 'auto' : 'smooth' });
    const watch = new ResizeObserver(follow);
    watch.observe(box);
    window.addEventListener('resize', follow);
    return () => {
      watch.disconnect();
      window.removeEventListener('resize', follow);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (): void => setHost(null);
    // Нажатие мимо — по `click`, а не по касанию: касание начинается и
    // у свайпа, и список закрывался бы от прокрутки пальцем.
    const away = (event: MouseEvent): void => {
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
    document.addEventListener('click', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('click', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  /*
   * С клавиатуры: при раскрытии фокус встаёт на выбранную валюту, а у
   * списка без ссылок — на сам список, чтобы диктор назвал его. Фокус
   * без прокрутки: докручивает список эффект выше, плавно.
   */
  useEffect(() => {
    if (!open || !list.current) return;
    const target =
      list.current.querySelector<HTMLElement>('.breakdown__item--on') ??
      list.current.querySelector<HTMLElement>('a.breakdown__item') ??
      list.current;
    target.focus({ preventScroll: true });
  }, [open]);

  /*
   * Tab с края списка. Список стоит порталом в конце обёртки, и по
   * порядку документа за ним ничего нет: Tab уводил фокус из страницы в
   * браузер, а Shift+Tab — к последней кнопке таблицы, в самый низ.
   * Поэтому край списка закрывает его и ведёт туда, где список стоит на
   * экране: назад — на кнопку плитки, вперёд — к тому, что за ней.
   */
  function tabOut(event: KeyPress<HTMLDivElement>): void {
    if (event.key !== 'Tab' || !list.current || !face.current) return;
    const links = [...list.current.querySelectorAll<HTMLElement>('a.breakdown__item')];
    const at = links.indexOf(document.activeElement as HTMLElement);
    const leaving = event.shiftKey ? at <= 0 : at === links.length - 1;
    if (!leaving) return;
    event.preventDefault();
    setHost(null);
    (event.shiftKey ? face.current : tabbableAfter(face.current)).focus();
  }

  const filled = lines.filter((line) => line.amount !== null);
  const shown = filled.slice(0, FOLDED);
  const more = filled.length - shown.length;

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
          <span className="breakdown__empty">{empty}</span>
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

      {host
        ? createPortal(
            <div ref={layer} className="breakdown__layer">
              <div
                ref={list}
                id={id}
                className="breakdown__list"
                role="dialog"
                aria-label={title}
                tabIndex={-1}
                onKeyDown={tabOut}
                onBlur={(event) => {
                  const next = event.relatedTarget as Node | null;
                  if (next && !list.current?.contains(next) && !root.current?.contains(next)) {
                    setHost(null);
                  }
                }}
              >
                {lines.map((line) => {
                  const said = `${currencyName(line.code)}: ${line.amount ?? none}`;
                  const body = (
                    <>
                      <CurrencyFlag code={line.code} size={18} />
                      <span className="breakdown__code">{line.code}</span>
                      <span className="breakdown__place">{currencyPlace(line.code) || currencyName(line.code)}</span>
                      <span className={line.amount ? 'breakdown__sum' : 'breakdown__sum breakdown__sum--none'}>
                        {line.amount ?? '—'}
                        {line.count > 0 ? <span className="breakdown__count"> · {line.count}</span> : undefined}
                      </span>
                    </>
                  );
                  return line.href ? (
                    <Link
                      key={line.code}
                      href={line.href}
                      scroll={false}
                      className={line.code === selected ? 'breakdown__item breakdown__item--on' : 'breakdown__item'}
                      aria-label={action ? `${said}. ${action} ${line.code}` : said}
                      onClick={() => setHost(null)}
                    >
                      {body}
                    </Link>
                  ) : (
                    <div key={line.code} className="breakdown__item breakdown__item--still" role="group" aria-label={said}>
                      {body}
                    </div>
                  );
                })}
              </div>
            </div>,
            host,
          )
        : undefined}
    </div>
  );
}
