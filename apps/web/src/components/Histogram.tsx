import { fmtMoney } from '../format';
import type { Presentation } from '../registry';
import { compact, niceTicks } from './NpvChart';

type Spec = NonNullable<Presentation['histogram']>;

const W = 640;
const H = 260;
const PAD = { l: 48, r: 16, t: 24, b: 34 };

export function Histogram({ spec }: { spec: Spec }) {
  const { bins, mean, p5, p95 } = spec;
  const lo = bins[0]!.x0;
  const hi = bins[bins.length - 1]!.x1;
  const span = hi - lo || 1;
  const maxCount = Math.max(...bins.map((b) => b.count));
  const x = (v: number) => PAD.l + ((v - lo) / span) * (W - PAD.l - PAD.r);
  const y = (c: number) => PAD.t + (1 - c / maxCount) * (H - PAD.t - PAD.b);
  const ticks = niceTicks(lo, hi, 6);
  const vline = (v: number, cls: string, label: string) =>
    v >= lo && v <= hi ? (
      <g>
        <line x1={x(v)} x2={x(v)} y1={PAD.t - 6} y2={H - PAD.b} className={cls} />
        <text x={x(v)} y={PAD.t - 10} textAnchor="middle" className={`${cls}-label`}>
          {label}
        </text>
      </g>
    ) : null;

  return (
    <figure className="chart">
      <figcaption>
        Distribution of simulated NPV
        <span className="legend">
          <span className="legend-item neg">NPV ≤ 0</span>
          <span className="legend-item pos">NPV &gt; 0</span>
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Histogram of simulated NPV">
        {bins.map((b, i) => {
          const cls = b.x1 <= 0 ? 'bar neg' : b.x0 >= 0 ? 'bar pos' : 'bar mixed';
          return (
            <rect
              key={i}
              x={x(b.x0) + 0.5}
              width={Math.max(0.5, x(b.x1) - x(b.x0) - 1)}
              y={y(b.count)}
              height={H - PAD.b - y(b.count)}
              className={cls}
            >
              <title>{`${fmtMoney(b.x0)} to ${fmtMoney(b.x1)}: ${b.count.toLocaleString('en-US')} scenarios`}</title>
            </rect>
          );
        })}
        <line x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} className="zero" />
        {ticks.map((t) => (
          <text key={t} x={x(t)} y={H - 12} textAnchor="middle" className="tick">
            {compact(t)}
          </text>
        ))}
        {vline(0, 'zero-v', 'NPV = 0')}
        {vline(mean, 'mean', 'mean')}
        {vline(p5, 'pctl', 'P5')}
        {vline(p95, 'pctl', 'P95')}
      </svg>
    </figure>
  );
}
