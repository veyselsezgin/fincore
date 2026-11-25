import { fmtMoney } from '../format';
import type { Presentation } from '../registry';

type Spec = NonNullable<Presentation['heatmap']>;

/** Diverging colour: red for negative NPV, green for positive, stronger with magnitude. */
export function heatColor(v: number, maxAbs: number): string {
  const a = maxAbs === 0 ? 0 : 0.12 + 0.68 * Math.min(1, Math.abs(v) / maxAbs);
  return v >= 0 ? `rgba(26, 140, 80, ${a.toFixed(3)})` : `rgba(200, 45, 35, ${a.toFixed(3)})`;
}

export function Heatmap({ spec }: { spec: Spec }) {
  const maxAbs = Math.max(...spec.values.flat().map(Math.abs));
  return (
    <figure className="heatmap">
      <figcaption>{spec.title}</figcaption>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="corner">
                {spec.rowTitle} ↓ <br /> {spec.colTitle} →
              </th>
              {spec.colLabels.map((c) => (
                <th key={c} className="num">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {spec.values.map((row, i) => (
              <tr key={i}>
                <th className="num">{spec.rowLabels[i]}</th>
                {row.map((v, j) => (
                  <td
                    key={j}
                    className={`num heat ${spec.base[0] === i && spec.base[1] === j ? 'base' : ''}`}
                    style={{ background: heatColor(v, maxAbs) }}
                    title={`Cash flows ${spec.rowLabels[i]}, rate ${spec.colLabels[j]}: NPV ${fmtMoney(v)}`}
                  >
                    {fmtMoney(v)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">Outlined cell = base case. Red = NPV below zero, green = above zero.</p>
    </figure>
  );
}
