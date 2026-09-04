import {
  TOBEE_HONEY_GRADIENT,
  TOBEE_MARK_BOX,
  TOBEE_MARK_BRACE,
  TOBEE_MARK_CELL,
} from '@nemo/brand';

/**
 * Знак и имя сервиса — те же, которыми он подписан снаружи и в Mini App.
 *
 * Контур знака берётся из `@nemo/brand`, а не рисуется здесь: рисуют
 * его трое, и правок о том, как он выглядит, должна быть одна. Имя
 * набрано, как на полотне: «TO» светлым, «BEE» мёдом.
 */
export function Brand({ eyebrow }: { readonly eyebrow?: string | undefined }) {
  return (
    <span className="brand">
      <span className="brand__mark" aria-hidden>
        <TobeeMark height={20} />
      </span>
      <span className="brand__name">
        to<span>bee</span>
      </span>
      {eyebrow ? <span className="brand__eyebrow">{eyebrow}</span> : undefined}
    </span>
  );
}

/**
 * Знак сервиса: залит медовым переходом, сквозная середина — `evenodd`,
 * чтобы на любой подложке не выдавать квадрат.
 *
 * Окно — по габариту знака с полем, а не по его сетке 24×24: в сетке
 * знак стоит с полями в две трети, и в плитке 34 пикселя от него
 * оставалось бы восемь. Ширина выводится из высоты — знак выше, чем
 * шире. Идентификатор градиента свой на панель, чтобы не столкнуться с
 * тем же знаком в Mini App, если разметка окажется на одной странице.
 * Фавикон `app/icon.svg` — тот же знак теми же числами, но статикой:
 * Next отдаёт файл как есть, и импортировать пакет ему нечем.
 */
const PAD = 1;
const VIEW = {
  x: TOBEE_MARK_BOX.x - PAD,
  y: TOBEE_MARK_BOX.y - PAD,
  width: TOBEE_MARK_BOX.width + PAD * 2,
  height: TOBEE_MARK_BOX.height + PAD * 2,
};

export function TobeeMark({ height = 20 }: { readonly height?: number }) {
  const width = (height * VIEW.width) / VIEW.height;
  return (
    <svg
      width={width}
      height={height}
      viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.width} ${VIEW.height}`}
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          id="tobee-honey-panel"
          x1={TOBEE_HONEY_GRADIENT.x1}
          y1={TOBEE_HONEY_GRADIENT.y1}
          x2={TOBEE_HONEY_GRADIENT.x2}
          y2={TOBEE_HONEY_GRADIENT.y2}
          gradientUnits="userSpaceOnUse"
        >
          {TOBEE_HONEY_GRADIENT.stops.map((stop) => (
            <stop key={stop.offset} offset={stop.offset} stopColor={stop.color} />
          ))}
        </linearGradient>
      </defs>
      <g fill="url(#tobee-honey-panel)" fillRule="evenodd">
        <path d={TOBEE_MARK_BRACE} />
        <path d={TOBEE_MARK_CELL} />
      </g>
    </svg>
  );
}
