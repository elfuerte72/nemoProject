/**
 * Воронка: ступени с числом и долей от первой.
 *
 * Полоса — доля от поданных, а не от предыдущей ступени: вопрос к
 * воронке один — «из каждых ста поданных сколько дошло», — и доля от
 * соседа на него не отвечает.
 */
export interface FunnelStep {
  readonly label: string;
  readonly count: number;
  readonly tone?: 'plain' | 'up' | 'down' | 'wait';
}

export function Funnel({ steps, total }: { steps: readonly FunnelStep[]; total: number }) {
  return (
    <ol className="funnel">
      {steps.map((step) => {
        const share = total > 0 ? step.count / total : 0;
        return (
          <li key={step.label} className={`funnel__step funnel__step--${step.tone ?? 'plain'}`}>
            <span className="funnel__label">{step.label}</span>
            <span className="funnel__bar" aria-hidden>
              <span className="funnel__fill" style={{ width: `${Math.round(share * 100)}%` }} />
            </span>
            <span className="funnel__count">{step.count}</span>
            <span className="funnel__share">
              {total > 0 ? `${Math.round(share * 100)} %` : '—'}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
