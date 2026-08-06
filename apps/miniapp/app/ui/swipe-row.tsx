'use client';

import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { TrashIcon } from './icons';

/**
 * Ряд списка, из-под которого выезжает одно действие.
 *
 * Жест — второй путь к тому же, к чему ведёт кнопка внутри ряда, а не
 * единственный: свайпа нет ни у мыши, ни у клавиатуры, и спрятать
 * удаление за него значило бы отнять его у половины способов работы.
 * Поэтому плашка объявлена скрытой для экранного диктора — иначе он
 * называл бы одно и то же действие дважды.
 *
 * Касаниями, а не указателем: пока направление жеста не решено, ряд
 * лежит в прокручиваемом листе, и отобрать вертикальное движение у
 * прокрутки можно только отказом от события `touchmove`. Тем же путём
 * идёт перенос разделов в оболочке приложения — двух правд об этом
 * жесте быть не должно.
 *
 * Ряд под пальцем двигается записью в узел, а не свойством разметки:
 * положение меняется десятки раз в секунду, и через состояние React
 * каждое касание стоило бы пересборки строки вместе со всем списком.
 */

/** Пока палец не прошёл этого, жест ничей — ни ряда, ни прокрутки. */
const AXIS_LOCK_PX = 6;

/**
 * Полоса у левого края, где жест не начинается. Telegram на iOS забирает
 * свайп от края себе: закрывая плашку, клиент закрыл бы всё приложение —
 * и это выглядело бы поломкой, а не системным жестом.
 */
const EDGE_GUARD_PX = 22;

/** Какую часть плашки надо открыть, чтобы она осталась открытой. */
const COMMIT_RATIO = 0.4;

/** Сопротивление за краями хода: дальше ряду двигаться некуда. */
const OVERSCROLL_DAMPING = 4;

export function SwipeRow({
  action,
  onAction,
  disabled = false,
  children,
}: {
  /** Что написано на плашке — тем же словом, что и на кнопке в ряду. */
  readonly action: string;
  readonly onAction: () => void;
  /** Действие идёт: плашка не нажимается, пока операция не кончилась. */
  readonly disabled?: boolean;
  readonly children: ReactNode;
}) {
  const row = useRef<HTMLLIElement>(null);
  const slide = useRef<HTMLDivElement>(null);
  const plate = useRef<HTMLButtonElement>(null);
  /** Открыта ли плашка. В узле, а не в состоянии: см. шапку файла. */
  const opened = useRef(false);
  /**
   * Жест увёл ряд в сторону. Нажатие, которым он кончился, ряду не
   * принадлежит: без этого свайп по строке выбора заодно выбирал бы
   * запись, которую собирались удалить.
   */
  const swiped = useRef(false);
  /**
   * Обработчик приходит новым при каждом рендере списка, а жест живёт
   * между ними: за ссылкой он остаётся тем же, и подписку на касания
   * пересобирать не нужно.
   */
  const latest = useRef(onAction);
  latest.current = onAction;

  /** Поставить ряд на место — открытое или закрытое. */
  const place = useCallback((open: boolean) => {
    const node = slide.current;
    if (!node) return;
    opened.current = open;
    // Разметку спрашиваем уже после жеста: под пальцем ширина взята
    // один раз, в начале касания.
    const width = plate.current?.offsetWidth ?? 0;
    node.style.transform = open ? `translate3d(${-width}px, 0, 0)` : '';
    // Отметка нужна оформлению: знак удаления в самом ряду гаснет, пока
    // открыта плашка, — иначе они встают рядом.
    if (open) node.dataset.open = '';
    else delete node.dataset.open;
  }, []);

  useEffect(() => {
    const frame = row.current;
    const node = slide.current;
    if (!frame || !node) return;

    let startX = 0;
    let startY = 0;
    /** Куда ведут палец. Пока не решено — жест ничей. */
    let axis: 'x' | 'y' | undefined;
    /** Где ряд стоял к началу жеста. */
    let base = 0;
    let width = 1;
    let offset = 0;
    let tracking = false;
    /** Заказанный кадр. Пальцу отвечаем раз в кадр, а не раз в событие. */
    let frameRequest = 0;

    const paint = () => {
      frameRequest = 0;
      node.style.transform = `translate3d(${offset}px, 0, 0)`;
    };

    const start = (event: TouchEvent) => {
      const touch = event.touches[0];
      // Двумя пальцами ряд не двигают: это либо масштабирование, либо
      // случайное касание второй рукой.
      if (event.touches.length !== 1 || !touch) return;
      if (touch.clientX < EDGE_GUARD_PX) return;
      startX = touch.clientX;
      startY = touch.clientY;
      axis = undefined;
      // Единственный раз за жест, когда спрашивают разметку: касание
      // пришло на свободный поток, до всякой отрисовки.
      width = plate.current?.offsetWidth ?? 1;
      base = opened.current ? -width : 0;
      offset = base;
      tracking = true;
      swiped.current = false;
      // Пока ведут палец, ряд не догоняет доводкой — он под пальцем.
      node.dataset.dragging = '';
    };

    const move = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!tracking || !touch) return;

      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;

      if (!axis) {
        if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return;
        axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      }

      // Вертикальный жест принадлежит листу: он прокручивается, и
      // отнимать у него движение ряд не вправе.
      if (axis !== 'x') return;
      // Иначе вместе с рядом поедет и прокрутка листа.
      if (event.cancelable) event.preventDefault();
      swiped.current = true;

      const wanted = base + dx;
      offset =
        wanted > 0
          ? // Вправо от места ряду ходу нет: справа от него ничего не
            // спрятано, и уехавший туда ряд открыл бы пустоту.
            wanted / OVERSCROLL_DAMPING
          : wanted < -width
            ? -width + (wanted + width) / OVERSCROLL_DAMPING
            : wanted;
      if (!frameRequest) frameRequest = requestAnimationFrame(paint);
    };

    const end = () => {
      if (!tracking) return;
      tracking = false;
      if (frameRequest) cancelAnimationFrame(frameRequest);
      frameRequest = 0;
      // Доводку включаем до того, как назначить ряду место: снятое
      // следом свойство не успело бы её застать, и ряд прыгнул бы к
      // плашке без движения.
      delete node.dataset.dragging;
      if (axis === 'x') place(offset < -width * COMMIT_RATIO);
      axis = undefined;
    };

    /*
     * Жест отняли — ряд возвращается туда, где стоял.
     *
     * Отмена приходит не от клиента: её шлёт система, забрав касание
     * себе, — жестом от края, звонком, сменой приложения. Считать это
     * за раскрытие значило бы открывать удаление тогда, когда клиент
     * ничего для этого не сделал.
     */
    const cancel = () => {
      if (!tracking) return;
      tracking = false;
      if (frameRequest) cancelAnimationFrame(frameRequest);
      frameRequest = 0;
      axis = undefined;
      delete node.dataset.dragging;
      place(opened.current);
    };

    frame.addEventListener('touchstart', start, { passive: true });
    frame.addEventListener('touchmove', move, { passive: false });
    frame.addEventListener('touchend', end);
    frame.addEventListener('touchcancel', cancel);
    return () => {
      if (frameRequest) cancelAnimationFrame(frameRequest);
      frame.removeEventListener('touchstart', start);
      frame.removeEventListener('touchmove', move);
      frame.removeEventListener('touchend', end);
      frame.removeEventListener('touchcancel', cancel);
    };
  }, [place]);

  return (
    <li ref={row} className="row row--swipe">
      <button
        ref={plate}
        type="button"
        className="row__plate"
        // Для диктора плашки нет: то же действие он находит кнопкой в
        // самом ряду, а жестом всё равно не пользуется.
        aria-hidden="true"
        tabIndex={-1}
        disabled={disabled}
        onClick={() => {
          place(false);
          latest.current();
        }}
      >
        <TrashIcon />
        {action}
      </button>
      <div
        ref={slide}
        className="row__slide"
        // Нажатие, которым кончился свайп, ряду не принадлежит; нажатие
        // по открытому ряду закрывает его, а не идёт внутрь — иначе
        // клиент, убирая плашку, выбирал бы запись под ней.
        onClickCapture={(event) => {
          if (!swiped.current && !opened.current) return;
          event.preventDefault();
          event.stopPropagation();
          swiped.current = false;
          place(false);
        }}
      >
        {children}
      </div>
    </li>
  );
}
