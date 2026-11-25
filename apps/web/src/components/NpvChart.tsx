import { npvRaw } from '@fincore/engine';
import { useMemo } from 'react';
import { fmtMoney, fmtPct } from '../format';
import type { Presentation } from '../registry';

type ChartSpec = NonNullable<Presentation['chart']>;

const W = 640;
const H = 280;
const PAD = { l: 64, r: 16, t: 20, b: 34 };
const SERIES_CLASS = ['curve', 'curve curve-2'];

/** Rate range that shows every point of interest with some margin. */
export function profileRange(spec: ChartSpec): [number, number] {
  const xs = [
    ...spec.points.map((p) => p.rate),
    ...(spec.marker !== undefined && Number.isFinite(spec.marker) ? [spec.marker] : []),
  ];
  const lo = Math.max(-0.9, Math.min(-0.1, ...xs.map((r) => r - 0.15)));
  const hi = Math.max(0.4, ...xs.map((r) => r * 1.4 + 0.1));
  return [lo, hi];
}

/** NPV profile: NPV as a function of the discount rate. Zero crossings are IRRs; curve crossings are Fisher rates. */
export function NpvChart({ spec }: { spec: ChartSpec }) {
  const { series, points, marker } = spec;
  const data = useMemo(() => {
    const [lo, hi] = profileRange(spec);
    const lines = series.map((s) => {
      const pts: [number, number][] = [];
      for (let i = 0; i <= 240; i++) {
        const r = lo + ((hi - lo) * i) / 240;
        const y = npvRaw(r, s.cashFlows);
        if (Number.isFinite(y)) pts.push([r, y]);
      }
      return pts;
    });
    const ys = lines
      .flat()
      .map((p) => p[1])
      .sort((a, b) => a - b);
    // Clip the extreme tails so the crossings stay readable.
    let yMin = Math.min(0, ys[Math.floor(ys.length * 0.02)] ?? 0);
    let yMax = Math.max(0, ys[Math.ceil(ys.length * 0.98) - 1] ?? 0);
    if (yMin === yMax) {
      yMin -= 1;
      yMax += 1;
    }
    const padY = (yMax - yMin) * 0.08;
    return { lines, lo, hi, yMin: yMin - padY, yMax: yMax + padY };
  }, [spec, series]);

  const { lines, lo, hi, yMin, yMax } = data;
  const x = (r: number) => PAD.l + ((r - lo) / (hi - lo)) * (W - PAD.l - PAD.r);
  const y = (v: number) =>
    PAD.t + ((yMax - Math.min(yMax, Math.max(yMin, v))) / (yMax - yMin)) * (H - PAD.t - PAD.b);
  const xTicks = niceTicks(lo, hi, 6);
  const yTicks = niceTicks(yMin, yMax, 5);
  const visible = points.filter((p) => p.rate >= lo && p.rate <= hi);

  return (
    <figure className="chart">
      <figcaption>
        {series.length > 1
          ? 'NPV profiles: where the curves cross is the Fisher rate'
          : 'NPV profile: where the curve crosses zero is an IRR'}
        {series.length > 1 && (
          <span className="legend">
            {series.map((s, i) => (
              <span key={s.name} className={`legend-item s${i}`}>
                {s.name}
              </span>
            ))}
          </span>
        )}
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="NPV as a function of the discount rate">
        {yTicks.map((t) => (
          <g key={`y${t}`}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} className="grid" />
            <text x={PAD.l - 6} y={y(t) + 4} textAnchor="end" className="tick">
              {compact(t)}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={`x${t}`} x={x(t)} y={H - 12} textAnchor="middle" className="tick">
            {fmtPct(t, 0)}
          </text>
        ))}
        <line x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} className="zero" />
        {marker !== undefined && Number.isFinite(marker) && marker >= lo && marker <= hi && (
          <g>
            <line x1={x(marker)} x2={x(marker)} y1={PAD.t} y2={H - PAD.b} className="marker" />
            <text x={x(marker) + 4} y={PAD.t + 10} className="marker-label">
              {`r = ${fmtPct(marker, 2)}`}
            </text>
            {series.map((s) => (
              <circle
                key={s.name}
                cx={x(marker)}
                cy={y(npvRaw(marker, s.cashFlows))}
                r={4}
                className="marker-dot"
              >
                <title>{`${s.name} at ${fmtPct(marker)}: ${fmtMoney(npvRaw(marker, s.cashFlows))}`}</title>
              </circle>
            ))}
          </g>
        )}
        {lines.map((pts, i) => (
          <path
            key={i}
            d={pts
              .map(([r, v], k) => `${k ? 'L' : 'M'}${x(r).toFixed(1)},${y(v).toFixed(1)}`)
              .join('')}
            className={SERIES_CLASS[i % SERIES_CLASS.length]}
          />
        ))}
        {visible.map((p) => {
          const cy = p.kind === 'cross' ? y(npvRaw(p.rate, series[0]!.cashFlows)) : y(0);
          return (
            <g key={`${p.kind}${p.rate}`}>
              {p.kind === 'cross' && (
                <line x1={x(p.rate)} x2={x(p.rate)} y1={cy} y2={H - PAD.b} className="cross-line" />
              )}
              <circle
                cx={x(p.rate)}
                cy={cy}
                r={5}
                className={p.kind === 'cross' ? 'cross' : 'root'}
              />
              <text
                x={x(p.rate)}
                y={cy - 10}
                textAnchor="middle"
                className={p.kind === 'cross' ? 'cross-label' : 'root-label'}
              >
                {p.label}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

export function niceTicks(lo: number, hi: number, count: number): number[] {
  const span = hi - lo;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) ?? 10 * mag;
  const out: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi + 1e-12; t += step)
    out.push(Number(t.toPrecision(12)));
  return out;
}

export function compact(v: number): string {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(
    v,
  );
}
