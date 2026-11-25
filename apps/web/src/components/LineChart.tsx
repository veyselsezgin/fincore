import { useMemo } from 'react';
import { fmtMoney, fmtNum, fmtPct } from '../format';
import type { AxisFormat, LineChartSpec } from '../registry';
import { compact, niceTicks } from './NpvChart';

const W = 640;
const H = 280;
const PAD = { l: 62, r: 16, t: 22, b: 38 };
const CLASSES = ['curve', 'curve curve-2', 'curve curve-3'];

export function fmtAxis(v: number, f: AxisFormat, short = true): string {
  if (f === 'pct') return fmtPct(v, short ? 1 : 2);
  if (f === 'money') return short ? compact(v) : fmtMoney(v);
  return short ? compact(v) : fmtNum(v, 4);
}

/** Generic x–y chart with named series and vertical markers. */
export function LineChart({ spec }: { spec: LineChartSpec }) {
  const d = useMemo(() => {
    const pts = spec.series
      .flatMap((s) => s.points)
      .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    let [x0, x1] = [Math.min(...xs), Math.max(...xs)];
    let [y0, y1] = [Math.min(...ys), Math.max(...ys)];
    if (x0 === x1) [x0, x1] = [x0 - 1, x1 + 1];
    if (y0 === y1) [y0, y1] = [y0 - 1, y1 + 1];
    const pad = (y1 - y0) * 0.08;
    return { x0, x1, y0: y0 - pad, y1: y1 + pad };
  }, [spec]);
  const x = (v: number) => PAD.l + ((v - d.x0) / (d.x1 - d.x0)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + ((d.y1 - v) / (d.y1 - d.y0)) * (H - PAD.t - PAD.b);

  return (
    <figure className="chart">
      <figcaption>
        {spec.title}
        {spec.series.length > 1 && (
          <span className="legend">
            {spec.series.map((s, i) => (
              <span key={s.name} className={`legend-item s${i}`}>
                {s.name}
              </span>
            ))}
          </span>
        )}
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={spec.title}>
        {niceTicks(d.y0, d.y1, 5).map((tk) => (
          <g key={`y${tk}`}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(tk)} y2={y(tk)} className="grid" />
            <text x={PAD.l - 6} y={y(tk) + 4} textAnchor="end" className="tick">
              {fmtAxis(tk, spec.yFormat)}
            </text>
          </g>
        ))}
        {niceTicks(d.x0, d.x1, 6).map((tk) => (
          <text key={`x${tk}`} x={x(tk)} y={H - 20} textAnchor="middle" className="tick">
            {fmtAxis(tk, spec.xFormat)}
          </text>
        ))}
        <text x={(PAD.l + W - PAD.r) / 2} y={H - 4} textAnchor="middle" className="tick">
          {spec.xLabel}
        </text>
        {d.y0 < 0 && d.y1 > 0 && (
          <line x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} className="zero" />
        )}
        {spec.series.map((s, i) => (
          <path
            key={s.name}
            className={CLASSES[i % CLASSES.length]}
            d={s.points
              .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b))
              .map(([a, b], k) => `${k ? 'L' : 'M'}${x(a).toFixed(1)},${y(b).toFixed(1)}`)
              .join('')}
          />
        ))}
        {spec.markers
          ?.filter((m) => Number.isFinite(m.x) && m.x >= d.x0 && m.x <= d.x1)
          .map((m) => (
            <g key={m.label}>
              <line x1={x(m.x)} x2={x(m.x)} y1={PAD.t} y2={H - PAD.b} className="marker" />
              <text x={x(m.x) + 4} y={PAD.t + 10} className="marker-label">
                {m.label}
              </text>
            </g>
          ))}
      </svg>
    </figure>
  );
}
