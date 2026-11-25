import type * as E from '@fincore/engine';
import { fmtNum, fmtPct } from '../format';
import type { Presentation } from '../registry';

const x2 = (v: number | null) => (v === null ? 'n/a' : `${fmtNum(v, 3)}×`);
const pc = (v: number | null) => (v === null ? 'n/a' : fmtPct(v, 2));

/** Arrow comparing a factor with the previous period. */
function Trend({ cur, prev }: { cur: number | null; prev: number | null | undefined }) {
  if (cur === null || prev === null || prev === undefined || Math.abs(cur - prev) < 1e-12)
    return null;
  return <span className={`trend ${cur > prev ? 'up' : 'down'}`}>{cur > prev ? '▲' : '▼'}</span>;
}

type Factor = { key: keyof E.DupontPeriod; label: string; fmt: (v: number | null) => string };

const THREE: Factor[] = [
  { key: 'netMargin', label: 'Net margin', fmt: pc },
  { key: 'assetTurnover', label: 'Asset turnover', fmt: x2 },
  { key: 'equityMultiplier', label: 'Equity multiplier', fmt: x2 },
];
const FIVE: Factor[] = [
  { key: 'taxBurden', label: 'Tax burden', fmt: x2 },
  { key: 'interestBurden', label: 'Interest burden', fmt: x2 },
  { key: 'ebitMargin', label: 'EBIT margin', fmt: pc },
  { key: 'assetTurnover', label: 'Asset turnover', fmt: x2 },
  { key: 'equityMultiplier', label: 'Equity multiplier', fmt: x2 },
];

export function DupontView({ spec }: { spec: NonNullable<Presentation['dupont']> }) {
  const block = (title: string, factors: Factor[]) => (
    <div className="dupont-block">
      <h3 className="table-title">{title}</h3>
      <div className="table-wrap">
        <table className="dupont">
          <thead>
            <tr>
              <th>Period</th>
              {factors.map((f, i) => (
                <th key={f.key} className="num">
                  {i > 0 && <span className="op">×</span>}
                  {f.label}
                </th>
              ))}
              <th className="num">
                <span className="op">=</span>ROE
              </th>
            </tr>
          </thead>
          <tbody>
            {spec.rows.map((r, p) => (
              <tr key={spec.periods[p]}>
                <th>{spec.periods[p]}</th>
                {factors.map((f) => (
                  <td key={f.key} className="num">
                    {f.fmt(r[f.key])} <Trend cur={r[f.key]} prev={spec.rows[p - 1]?.[f.key]} />
                  </td>
                ))}
                <td className="num roe-cell">
                  {pc(r.roe)} <Trend cur={r.roe} prev={spec.rows[p - 1]?.roe} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
  return (
    <section className="analysis-section">
      <h2 className="section-title">DuPont Decomposition</h2>
      <DupontTree spec={spec} />
      {block('3-Step · Margin × Turnover × Leverage', THREE)}
      {block('5-Step · Tax × Interest × EBIT Margin × Turnover × Leverage', FIVE)}
      <p className="hint">
        ▲▼ change versus the previous period. If ROE rises only because the equity multiplier rises,
        the gain comes from leverage, not operations.
      </p>
    </section>
  );
}

export function ZScoreView({ spec }: { spec: NonNullable<Presentation['zscore']> }) {
  const scores = spec.altman.map((a) => a.score).filter((s): s is number => s !== null);
  const lo = Math.min(0, ...scores.map((s) => s - 0.3));
  const hi = Math.max(spec.safe * 1.6, ...scores.map((s) => s + 0.5));
  const pos = (v: number) => `${((v - lo) / (hi - lo)) * 100}%`;
  return (
    <section className="analysis-section">
      <h2 className="section-title">Altman Z-Score · {spec.modelLabel}</h2>
      {spec.altman.map((a, p) => (
        <div key={spec.periods[p]} className="zgauge-row">
          <span className="zgauge-label">{spec.periods[p]}</span>
          <div
            className="zgauge"
            role="img"
            aria-label={`Z-score ${a.score === null ? 'not available' : a.score.toFixed(2)}, ${a.zone ?? ''} zone`}
          >
            <div className="zone distress" style={{ left: 0, width: pos(spec.distress) }} />
            <div
              className="zone grey"
              style={{
                left: pos(spec.distress),
                width: `calc(${pos(spec.safe)} - ${pos(spec.distress)})`,
              }}
            />
            <div className="zone safe" style={{ left: pos(spec.safe), right: 0 }} />
            {a.score !== null && (
              <div className="zmarker" style={{ left: pos(Math.min(hi, Math.max(lo, a.score))) }}>
                <span>{a.score.toFixed(2)}</span>
              </div>
            )}
          </div>
          <span className={`zone-tag ${a.zone ?? 'na'}`}>{a.zone ?? 'n/a'}</span>
        </div>
      ))}
      <div className="zgauge-legend">
        <span>Distress &lt; {spec.distress}</span>
        <span>
          Grey {spec.distress}–{spec.safe}
        </span>
        <span>Safe &gt; {spec.safe}</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Component</th>
              <th className="num">Weight</th>
              {spec.periods.map((p) => (
                <th key={p} className="num">
                  {p}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {spec.altman[0]!.components.map((c, k) => (
              <tr key={c.id}>
                <td>
                  {c.id}: {c.label}
                </td>
                <td className="num">{c.weight}</td>
                {spec.altman.map((a, p) => (
                  <td key={p} className="num">
                    {a.components[k]!.value === null ? 'n/a' : fmtNum(a.components[k]!.value!, 4)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 } as const;

export function DiagnosticsView({ items }: { items: E.Diagnostic[] }) {
  const sorted = [...items].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.period.localeCompare(a.period),
  );
  return (
    <section className="analysis-section">
      <h2 className="section-title">
        Red Flag Monitor{' '}
        <span className="count">
          {items.length === 0
            ? 'none'
            : `${items.filter((d) => d.severity === 'critical').length} critical · ${items.length} total`}
        </span>
      </h2>
      {items.length === 0 ? (
        <p className="note">
          No rule was triggered. The rules and thresholds are listed under Assumptions.
        </p>
      ) : (
        <ul className="diagnostics">
          {sorted.map((d, i) => (
            <li key={i} className={`diag ${d.severity}`}>
              <span className="diag-sev">{d.severity}</span>
              <span className="diag-period">{d.period}</span>
              <span className="diag-msg">{d.message}</span>
              <code className="diag-code">{d.code}</code>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type TreeNode = {
  key: keyof E.DupontPeriod;
  label: string;
  fmt: (v: number | null) => string;
  x: number;
  y: number;
};

/**
 * DuPont node-link tree for the latest period: ROE splits into margin × turnover × leverage
 * (3-step), and net margin splits further into tax burden × interest burden × EBIT margin
 * (5-step). Each node shows the change versus the previous period.
 */
export function DupontTree({ spec }: { spec: NonNullable<Presentation['dupont']> }) {
  const last = spec.rows.length - 1;
  const cur = spec.rows[last]!;
  const prev = last > 0 ? spec.rows[last - 1]! : null;
  const W = 680;
  const NW = 142;
  const NH = 54;
  const nodes: TreeNode[] = [
    { key: 'roe', label: 'ROE', fmt: pc, x: W / 2, y: 30 },
    { key: 'netMargin', label: 'Net margin', fmt: pc, x: 140, y: 130 },
    { key: 'assetTurnover', label: 'Asset turnover', fmt: x2, x: W / 2, y: 130 },
    { key: 'equityMultiplier', label: 'Equity multiplier', fmt: x2, x: W - 140, y: 130 },
    { key: 'taxBurden', label: 'Tax burden', fmt: x2, x: 80, y: 232 },
    { key: 'interestBurden', label: 'Interest burden', fmt: x2, x: 232, y: 232 },
    { key: 'ebitMargin', label: 'EBIT margin', fmt: pc, x: 384, y: 232 },
  ];
  const at = (k: keyof E.DupontPeriod) => nodes.find((n) => n.key === k)!;
  const edges: [keyof E.DupontPeriod, keyof E.DupontPeriod][] = [
    ['roe', 'netMargin'],
    ['roe', 'assetTurnover'],
    ['roe', 'equityMultiplier'],
    ['netMargin', 'taxBurden'],
    ['netMargin', 'interestBurden'],
    ['netMargin', 'ebitMargin'],
  ];
  return (
    <figure className="chart dupont-tree">
      <figcaption>
        DuPont tree · {spec.periods[last]}
        {prev && <span className="legend">▲▼ vs {spec.periods[last - 1]}</span>}
      </figcaption>
      <svg viewBox={`0 0 ${W} 270`} role="img" aria-label="DuPont decomposition tree">
        {edges.map(([a, b]) => {
          const p = at(a);
          const c = at(b);
          return (
            <path
              key={`${a}-${b}`}
              className="tree-edge"
              d={`M${p.x},${p.y + NH / 2} C${p.x},${(p.y + c.y) / 2 + NH / 4} ${c.x},${(p.y + c.y) / 2} ${c.x},${c.y - NH / 2}`}
            />
          );
        })}
        <text x={(at('netMargin').x + at('assetTurnover').x) / 2} y={134} className="tree-op">
          ×
        </text>
        <text
          x={(at('assetTurnover').x + at('equityMultiplier').x) / 2}
          y={134}
          className="tree-op"
        >
          ×
        </text>
        <text x={(at('taxBurden').x + at('interestBurden').x) / 2} y={236} className="tree-op">
          ×
        </text>
        <text x={(at('interestBurden').x + at('ebitMargin').x) / 2} y={236} className="tree-op">
          ×
        </text>
        {nodes.map((n) => {
          const v = cur[n.key];
          const p = prev?.[n.key] ?? null;
          const dir =
            v === null || p === null || Math.abs(v - p) < 1e-12 ? null : v > p ? 'up' : 'down';
          return (
            <g key={n.key} transform={`translate(${n.x - NW / 2},${n.y - NH / 2})`}>
              <rect
                width={NW}
                height={NH}
                rx={8}
                className={`tree-node ${n.key === 'roe' ? 'root' : ''}`}
              />
              <text x={NW / 2} y={18} textAnchor="middle" className="tree-label">
                {n.label}
              </text>
              <text x={NW / 2} y={39} textAnchor="middle" className="tree-value">
                {n.fmt(v)}
                {dir && <tspan className={`tree-trend ${dir}`}>{dir === 'up' ? ' ▲' : ' ▼'}</tspan>}
              </text>
              {p !== null && <title>{`${spec.periods[last - 1]}: ${n.fmt(p)}`}</title>}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
