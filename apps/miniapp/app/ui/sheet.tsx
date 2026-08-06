'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CloseIcon } from './icons';
import { useCopied } from './use-copied';

/**
 * Нижний лист.
 *
 * Всё, что не помещается в основной поток экрана — выбор валюты, ввод
 * реквизитов, подтверждение заявки, — показывается здесь, а не отдельной
 * страницей. Приложение живёт внутри Telegram, и своя навигация в нём
 * спорит с системной кнопкой «назад».
 *
 * Разметка уходит в конец `body`, а не остаётся на месте вызова:
 * экраны въезжают анимацией `transform`, а такой предок становится
 * системой отсчёта для `position: fixed` — лист внутри него перестаёт
 * закрывать нижнюю панель.
 *
 * Закрывается тремя способами, и это не роскошь: крестик у заголовка,
 * промах мимо панели, потяг вниз за полоску сверху. Панель поднимается
 * почти во весь экран, и один только промах оставлял бы целью полоску в
 * пару сантиметров под системной кнопкой Telegram, которая закрывает всё
 * приложение целиком.
 */

/** Сколько надо утянуть лист вниз, чтобы отпускание его закрыло. */
const DRAG_CLOSE_PX = 96;

/**
 * С какой скоростью бросок закрывает лист, не дотянув до порога. Пиксели
 * на миллисекунду: короткий резкий жест — это тоже «закрой», и требовать
 * от него полного хода значит не понимать его вовсе.
 */
const FLICK_PX_PER_MS = 0.5;

/** Сколько лист уезжает вниз, прежде чем его снимут. */
const DRAG_SETTLE_MS = 180;

/** По чему ходит клавиша обхода внутри листа. */
const FOCUSABLE =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function Sheet({
  title,
  onClose,
  children,
}: {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const grip = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = panel.current;
    // Кто открыл лист: туда же вернётся фокус, когда лист уйдёт. Без
    // этого работающий с клавиатуры оказывается в начале страницы и
    // ищет заново ту кнопку, которую только что нажал.
    const opener = document.activeElement;
    node?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      /*
       * Обход по клавише не уходит из листа.
       *
       * Лист объявлен модальным, и для экранного диктора этого хватает —
       * но клавиша обхода про объявление не знает: фокус уезжал за
       * панель, в кнопки под ней, и следующее нажатие приходилось в
       * экран, которого клиент не видит.
       */
      if (event.key !== 'Tab' || !node) return;

      const stops = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (one) => !one.hasAttribute('disabled') && one.offsetParent !== null,
      );
      const first = stops[0];
      const last = stops.at(-1);
      if (!first || !last) return;

      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === node)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);

    // Фон под листом не прокручивается: иначе палец, промахнувшийся
    // мимо панели, уводит экран под ней.
    document.body.classList.add('sheet-open');

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.classList.remove('sheet-open');
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [onClose]);

  /*
   * Потяг вниз за полоску.
   *
   * Указателем, а не касанием: один и тот же код ведёт и палец на
   * телефоне, и мышь на десктопе — а Mini App открывают и там. Отдельная
   * ветка под мышь означала бы две правды об одном жесте.
   *
   * Ручкой служит только полоска сверху, а не вся панель: внутри листа
   * лежат прокручиваемые списки, и жест, начатый на них, принадлежит им.
   */
  useEffect(() => {
    const handle = grip.current;
    const node = panel.current;
    if (!handle || !node) return;

    let startY = 0;
    let startedAt = 0;
    let offset = 0;
    let dragging = false;
    let frame = 0;
    /** Отложенный уход листа: его надо снять, если лист закрыли иначе. */
    let settling: ReturnType<typeof setTimeout> | undefined;

    const paint = () => {
      frame = 0;
      node.style.transform = `translate3d(0, ${offset}px, 0)`;
    };

    const down = (event: PointerEvent) => {
      // Правая кнопка мыши лист не тянет.
      if (event.button !== 0) return;
      dragging = true;
      startY = event.clientY;
      startedAt = event.timeStamp;
      offset = 0;
      handle.setPointerCapture(event.pointerId);
      // Появление листа объявлено анимацией, а её конечный кадр сильнее
      // любого значения в самом узле: не сняв её, панель не сдвинуть.
      node.style.animation = 'none';
      node.dataset.dragging = '';
    };

    const move = (event: PointerEvent) => {
      if (!dragging) return;
      // Вверх лист не идёт: выше его края ничего нет, и тянуть туда
      // значит обещать содержимое, которого не будет.
      offset = Math.max(0, event.clientY - startY);
      if (!frame) frame = requestAnimationFrame(paint);
    };

    const up = (event: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      handle.releasePointerCapture(event.pointerId);
      delete node.dataset.dragging;

      const speed = offset / Math.max(1, event.timeStamp - startedAt);
      if (offset > DRAG_CLOSE_PX || (offset > 20 && speed > FLICK_PX_PER_MS)) {
        // Лист уходит за нижний край и только потом снимается: исчезнуть
        // на полпути — значит мигнуть там, где ждут движения.
        node.style.transform = `translate3d(0, ${node.offsetHeight}px, 0)`;
        settling = setTimeout(onClose, DRAG_SETTLE_MS);
        return;
      }
      // Не дотянули — лист возвращается на место сам.
      node.style.transform = '';
    };

    /*
     * Жест отняли — лист возвращается, а не закрывается.
     *
     * Отмена приходит не от клиента: её шлёт система, забрав указатель
     * себе, — жестом от края, звонком, сменой приложения. Считать это
     * за «закрой» значит закрывать лист тогда, когда клиент ничего для
     * этого не сделал, а решение принималось бы по тому, сколько лист
     * успел проехать до перехвата.
     */
    const cancel = () => {
      if (!dragging) return;
      dragging = false;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      delete node.dataset.dragging;
      node.style.transform = '';
    };

    handle.addEventListener('pointerdown', down);
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', cancel);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      // Уход листа отложен на время доводки, и за неё лист успевают
      // закрыть иначе — крестиком, промахом, ответом сервера. Сработав
      // после этого, отложенный вызов закрыл бы уже следующий лист.
      clearTimeout(settling);
      handle.removeEventListener('pointerdown', down);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', cancel);
    };
  }, [onClose]);

  const markup = (
    <div
      className="sheet"
      // Закрытие по промаху мимо панели — нажатие на саму подложку, а не
      // всплывшее из панели событие.
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        className="sheet__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        {/*
          Полоска сама по себе — цель в четыре пикселя высотой. Тянут за
          поле вокруг неё: видно полоску, а работает вся полоса.
        */}
        <div ref={grip} className="sheet__grip">
          <div className="sheet__grabber" />
        </div>
        {/*
          Крестик, а не одна лишь подложка вокруг. Панель поднимается до
          88% высоты окна, и мимо неё остаётся полоска в пару
          сантиметров — а в Telegram поверх неё ещё и системная шапка с
          «Закрыть», которая закрывает не лист, а всё приложение. Выход
          из листа не должен быть попаданием по узкой цели рядом с
          кнопкой, стоящей дороже.
        */}
        <div className="sheet__head">
          <h2 id={titleId} className="sheet__title">
            {title}
          </h2>
          <button type="button" onClick={onClose} className="sheet__close" aria-label="Закрыть">
            <CloseIcon />
          </button>
        </div>
        {children}
      </div>
    </div>
  );

  // Лист открывается только по действию клиента, то есть уже в
  // браузере: разметки для страницы, отданной сервером, у него нет.
  return typeof document === 'undefined' ? null : createPortal(markup, document.body);
}

/**
 * Лист с одним сообщением и кнопкой «Понятно» — подтверждение подачи,
 * пояснение к шагу, реквизиты для оплаты.
 *
 * Реквизиты отличаются от остальных сообщений тем, что их не читают, а
 * переносят: номер карты набирают в банковском приложении. Поэтому у
 * листа есть необязательная кнопка копирования — и набор строк в теле
 * сохраняется как есть. Без этого «Сбербанк / 1234 5678 9012 3456 /
 * Иван И.», набранный менеджером в три строки, слипался в одну, а
 * скопировать номер можно было только выделив его пальцем внутри Mini
 * App.
 */
export function NoticeSheet({
  title,
  body,
  copyable,
  onClose,
}: {
  readonly title: string;
  readonly body: string;
  /** Есть — тело листа считается данными: переносы целы, копирование доступно. */
  readonly copyable?: boolean | undefined;
  readonly onClose: () => void;
}) {
  const { copied, copy } = useCopied();

  return (
    <Sheet title={title} onClose={onClose}>
      <p className={copyable ? 'sheet__body sheet__body--data' : 'sheet__body'}>{body}</p>
      <div className="sheet__actions">
        {copyable ? (
          <button type="button" onClick={() => copy(body)} className="btn btn--gold">
            {copied ? 'Скопировано' : 'Скопировать'}
          </button>
        ) : undefined}
        <button
          type="button"
          onClick={onClose}
          className={copyable ? 'btn btn--soft' : 'btn btn--gold'}
        >
          Понятно
        </button>
      </div>
    </Sheet>
  );
}
