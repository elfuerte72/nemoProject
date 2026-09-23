/**
 * Ход по дням под числом плитки — линия без осей, как у образца.
 *
 * Украшение, а не второй канал числа: само число стоит над ней, и
 * экранному диктору линия не читается (`aria-hidden`). Осей и подписей
 * нет намеренно — плитка отвечает «сколько», а «когда» живёт в
 * аналитике. Меньше двух точек линии не бывает: одна точка — это не ход.
 * Нет её и у пустого отбора: ровная линия по нулям читается как «ничего
 * не менялось», а не как «нечего показать».
 */
export function Spark({
  series,
  tone = 'plain',
}: {
  readonly series: readonly number[];
  readonly tone?: 'plain' | 'up';
}) {
  if (series.length < 2 || series.every((value) => value === 0)) return null;
  const top = Math.max(...series, 1);
  const last = series.length - 1;
  // Сверху запас в десятую: пик, упёртый в край, срезается штрихом.
  const points = series.map((value, index) => `${index},${1 - (value / top) * 0.9}`).join(' ');

  return (
    <svg
      className={`spark spark--${tone}`}
      viewBox={`0 0 ${last} 1`}
      preserveAspectRatio="none"
      aria-hidden
      focusable="false"
    >
      <polygon className="spark__fill" points={`0,1 ${points} ${last},1`} />
      <polyline className="spark__line" points={points} />
    </svg>
  );
}
