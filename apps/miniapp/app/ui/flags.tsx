import type { ReactNode } from 'react';

/**
 * Валюты в лицо: флаг, название и порядок.
 *
 * Одно место на всё, что человек знает о валюте помимо её кода. Добавить
 * валюту в справочник — значит дописать сюда строку; забыть про это
 * можно безнаказанно, но тогда клиент увидит трёхбуквенный код и серый
 * кружок вместо флага.
 *
 * Флаги нарисованы, а не подключены картинками и не набраны эмодзи. Не
 * картинками — потому что в приложении их вообще нет, кроме талисмана. И
 * не эмодзи: в системных шрифтах Windows нет флаговых глифов, и внутри
 * Mini App вместо флага показались бы две буквы — «TH» вместо
 * Таиланда. Свой SVG выглядит одинаково везде.
 *
 * Флаги упрощены до того, что читается на двадцати пикселях: полосы,
 * крупные фигуры, никаких гербов. Круглые, потому что стоят в ряд с
 * кодом валюты, а прямоугольник рядом с текстом спорил бы с ним за
 * геометрию.
 */

interface FlagProps {
  readonly size?: number;
}

/**
 * Круг, по которому обрезаны все флаги.
 *
 * Один идентификатор на весь набор, а не свой у каждого флага: круг у
 * них одинаковый, и разметка, встретившись с одним и тем же именем
 * дважды, найдёт одну и ту же фигуру. Уникальные имена пришлось бы
 * выдавать на каждый показ, а флаг одной валюты стоит на экране и в
 * пилюле, и в списке.
 */
const ROUND = 'nm-flag-round';

/** Тонкий тёмный кант: без него белые полосы флага сливаются с фоном. */
const EDGE = 'rgba(8, 5, 20, 0.28)';

function Flag({ size = 20, children }: FlagProps & { readonly children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="flag"
      focusable="false"
    >
      <defs>
        <clipPath id={ROUND}>
          <circle cx="12" cy="12" r="12" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${ROUND})`}>{children}</g>
      <circle cx="12" cy="12" r="11.5" fill="none" stroke={EDGE} strokeWidth="1" />
    </svg>
  );
}

/**
 * Пятиконечная звезда. Считается один раз при загрузке модуля: звёзд на
 * трёх флагах два десятка, и выписывать их координаты руками — значит
 * ошибиться в одной из них незаметно.
 */
function star(cx: number, cy: number, radius: number): string {
  const points: string[] = [];
  for (let corner = 0; corner < 10; corner += 1) {
    // Внутренние вершины впятеро ближе к центру — так звезда выходит
    // острой, а не похожей на цветок.
    const length = corner % 2 === 0 ? radius : radius * 0.382;
    const angle = (Math.PI / 5) * corner - Math.PI / 2;
    points.push(
      `${(cx + length * Math.cos(angle)).toFixed(2)},${(cy + length * Math.sin(angle)).toFixed(2)}`,
    );
  }
  return `M${points.join('L')}Z`;
}

/** Двенадцать звёзд Евросоюза — по кругу, как часовые деления. */
const EU_STARS = Array.from({ length: 12 }, (_, hour) => {
  const angle = (Math.PI / 6) * hour - Math.PI / 2;
  return star(12 + 6.7 * Math.cos(angle), 12 + 6.7 * Math.sin(angle), 1.35);
});

/** Полосы флага США: тринадцать, красные через белую. */
const US_STRIPES = Array.from({ length: 7 }, (_, index) => (24 / 13) * index * 2);

function RussianFlag(props: FlagProps) {
  return (
    <Flag {...props}>
      <rect width="24" height="8" fill="#ffffff" />
      <rect y="8" width="24" height="8" fill="#0039a6" />
      <rect y="16" width="24" height="8" fill="#d52b1e" />
    </Flag>
  );
}

function ThaiFlag(props: FlagProps) {
  return (
    <Flag {...props}>
      <rect width="24" height="24" fill="#f4f5f8" />
      <rect width="24" height="4" fill="#a51931" />
      <rect y="8" width="24" height="8" fill="#2d2a4a" />
      <rect y="20" width="24" height="4" fill="#a51931" />
    </Flag>
  );
}

function TurkishFlag(props: FlagProps) {
  return (
    <Flag {...props}>
      <rect width="24" height="24" fill="#e30a17" />
      {/* Полумесяц — белый круг, из которого красный круг выедает бок. */}
      <circle cx="10.2" cy="12" r="4.4" fill="#ffffff" />
      <circle cx="11.7" cy="12" r="3.5" fill="#e30a17" />
      <path d={star(16.2, 12, 2)} fill="#ffffff" />
    </Flag>
  );
}

function IndianFlag(props: FlagProps) {
  return (
    <Flag {...props}>
      <rect width="24" height="8" fill="#ff9933" />
      <rect y="8" width="24" height="8" fill="#ffffff" />
      <rect y="16" width="24" height="8" fill="#138808" />
      {/*
        Чакра о двадцати четырёх спицах на двадцати пикселях слипается в
        пятно, поэтому спиц восемь: колесо остаётся колесом, а не
        превращается в синюю кляксу.
      */}
      <circle cx="12" cy="12" r="2.9" fill="none" stroke="#000080" strokeWidth="0.7" />
      <circle cx="12" cy="12" r="0.7" fill="#000080" />
      <g stroke="#000080" strokeWidth="0.5">
        <path d="M12 9.4v5.2M9.4 12h5.2M10.2 10.2l3.6 3.6M13.8 10.2l-3.6 3.6" />
      </g>
    </Flag>
  );
}

function ChineseFlag(props: FlagProps) {
  return (
    <Flag {...props}>
      <rect width="24" height="24" fill="#ee1c25" />
      <g fill="#ffde00">
        <path d={star(7.4, 8, 3.4)} />
        <path d={star(12.6, 4.4, 1.2)} />
        <path d={star(14.4, 7.2, 1.2)} />
        <path d={star(14, 10.8, 1.2)} />
        <path d={star(11.6, 13, 1.2)} />
      </g>
    </Flag>
  );
}

function AmericanFlag(props: FlagProps) {
  return (
    <Flag {...props}>
      <rect width="24" height="24" fill="#ffffff" />
      <g fill="#b22234">
        {US_STRIPES.map((y) => (
          <rect key={y} y={y} width="24" height={24 / 13} />
        ))}
      </g>
      <rect width="10" height={(24 / 13) * 7} fill="#3c3b6e" />
      {/*
        Пятьдесят звёзд здесь неразличимы и не нужны: девять точек
        читаются как звёздное поле, а не как попытка их пересчитать.
      */}
      <g fill="#ffffff">
        {[2.1, 5, 7.9].map((cx) =>
          [2.6, 6.5, 10.4].map((cy) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="0.62" />),
        )}
      </g>
    </Flag>
  );
}

function EuropeanFlag(props: FlagProps) {
  return (
    <Flag {...props}>
      <rect width="24" height="24" fill="#003399" />
      <g fill="#ffcc00">
        {EU_STARS.map((path) => (
          <path key={path} d={path} />
        ))}
      </g>
    </Flag>
  );
}

function SouthAfricanFlag(props: FlagProps) {
  return (
    <Flag {...props}>
      <rect width="24" height="12" fill="#e03c31" />
      <rect y="12" width="24" height="12" fill="#001489" />
      {/* Лежащая на боку «игрек»: сначала белая кайма, поверх — зелёный. */}
      <path
        d="M-2 0.5 10.5 12 26 12M-2 23.5 10.5 12"
        fill="none"
        stroke="#ffffff"
        strokeWidth="7.2"
        strokeLinejoin="round"
      />
      <path
        d="M-2 0.5 10.5 12 26 12M-2 23.5 10.5 12"
        fill="none"
        stroke="#007a4d"
        strokeWidth="4.4"
        strokeLinejoin="round"
      />
      <path d="M-1 1.5 9.6 12 -1 22.5Z" fill="#ffb612" />
      <path d="M-1 4.8 6.2 12 -1 19.2Z" fill="#000000" />
    </Flag>
  );
}

/**
 * У USDT страны нет, а ряд должен остаться ровным: вместо флага — знак
 * валюты на её же фирменном зелёном.
 */
function TetherMark(props: FlagProps) {
  return (
    <Flag {...props}>
      <rect width="24" height="24" fill="#26a17b" />
      <g fill="#ffffff">
        <rect x="5.6" y="6.2" width="12.8" height="2.5" rx="0.4" />
        <rect x="10.5" y="6.2" width="3" height="11.6" rx="0.4" />
        <rect x="7.8" y="10.6" width="8.4" height="1.9" rx="0.4" />
      </g>
    </Flag>
  );
}

/**
 * Валюта, о которой этот файл не знает. Появится, если справочник
 * пополнили, а сюда не заглянули: кружок держит строку ровной и молчит —
 * выдуманный флаг был бы хуже отсутствующего.
 */
function UnknownCurrency(props: FlagProps) {
  return (
    <Flag {...props}>
      <rect width="24" height="24" fill="rgba(158, 146, 214, 0.3)" />
      <circle cx="12" cy="12" r="4" fill="rgba(244, 241, 251, 0.38)" />
    </Flag>
  );
}

/**
 * Что сервис знает о валюте: как она называется, где ходит и чем
 * подписана.
 *
 * Название и место — не одно и то же, и нужны оба. В строке выбора
 * стоит место: рядом с флагом оно читается одним движением, а «ZAR ·
 * ЮАР» узнаётся быстрее, чем «ZAR · Южноафриканский рэнд». Название
 * уходит в подпись для экранного диктора, который флага не видит вовсе.
 *
 * Порядок строк здесь и есть порядок в списке выбора — рубль первым,
 * дальше по алфавиту кода.
 */
const CURRENCIES: Record<
  string,
  { name: string; place: string; flag: (props: FlagProps) => ReactNode }
> = {
  RUB: { name: 'Российский рубль', place: 'Россия', flag: RussianFlag },
  CNY: { name: 'Китайский юань', place: 'Китай', flag: ChineseFlag },
  EUR: { name: 'Евро', place: 'Еврозона', flag: EuropeanFlag },
  INR: { name: 'Индийская рупия', place: 'Индия', flag: IndianFlag },
  THB: { name: 'Тайский бат', place: 'Таиланд', flag: ThaiFlag },
  TRY: { name: 'Турецкая лира', place: 'Турция', flag: TurkishFlag },
  USD: { name: 'Доллар США', place: 'США', flag: AmericanFlag },
  // У стейблкоина страны нет, и придумывать её нельзя: в столбце мест
  // честнее сказать, что это криптовалюта.
  USDT: { name: 'Tether', place: 'Криптовалюта', flag: TetherMark },
  ZAR: { name: 'Южноафриканский рэнд', place: 'ЮАР', flag: SouthAfricanFlag },
};

const ORDER = Object.keys(CURRENCIES);

/** Флаг валюты — или молчаливый кружок, если валюта здесь не описана. */
export function CurrencyFlag({ code, size }: { readonly code: string; readonly size?: number }) {
  const known = CURRENCIES[code.toUpperCase()];
  const Mark = known?.flag ?? UnknownCurrency;
  return <Mark {...(size === undefined ? {} : { size })} />;
}

/**
 * Название валюты словами. Незнакомая называется своим кодом: он всё
 * равно стоит рядом, и строка остаётся собранной.
 */
export function currencyName(code: string): string {
  return CURRENCIES[code.toUpperCase()]?.name ?? code;
}

/**
 * Где эта валюта ходит — страна или зона. У незнакомой пусто: строка
 * останется с одним кодом, и это честнее выдуманной страны.
 */
export function currencyPlace(code: string): string {
  return CURRENCIES[code.toUpperCase()]?.place ?? '';
}

/**
 * Порядок валют в списке выбора.
 *
 * Рубль первым — за ним приходит большинство; дальше по алфавиту кода,
 * потому что всякий другой порядок пришлось бы объяснять и пересматривать
 * при каждой новой валюте. Незнакомые уходят в конец: справочник впереди
 * этого файла, и молчаливый кружок не должен стоять первым.
 */
export function sortCurrencies(codes: readonly string[]): string[] {
  return [...codes].sort((left, right) => {
    const leftIndex = ORDER.indexOf(left.toUpperCase());
    const rightIndex = ORDER.indexOf(right.toUpperCase());
    if (leftIndex === rightIndex) return left.localeCompare(right);
    if (leftIndex === -1) return 1;
    if (rightIndex === -1) return -1;
    return leftIndex - rightIndex;
  });
}
