import { useState } from 'react';
import { defaults, type Calculator, type Values } from '../registry';
import type { SavedCase } from '../session';

/** Save, load and delete named cases (e.g. Base / Bull / Bear) for the current calculator. */
export function CaseManager({
  cases,
  onSave,
  onLoad,
  onDelete,
  comparing,
  onToggleCompare,
}: {
  cases: SavedCase[];
  onSave: (name: string) => void;
  onLoad: (c: SavedCase) => void;
  onDelete: (name: string) => void;
  comparing: boolean;
  onToggleCompare: () => void;
}) {
  const [name, setName] = useState('');
  const save = () => {
    if (!name.trim()) return;
    onSave(name);
    setName('');
  };
  return (
    <div className="cases">
      <div className="cases-save">
        <input
          value={name}
          maxLength={60}
          placeholder="Case name, e.g. Base / Bull / Bear"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              save();
            }
          }}
          aria-label="Case name"
        />
        <button type="button" className="secondary" disabled={!name.trim()} onClick={save}>
          Save Case
        </button>
      </div>
      {cases.length > 0 && (
        <>
          <ul className="case-list">
            {cases.map((c) => (
              <li key={c.name}>
                <button
                  type="button"
                  className="link"
                  onClick={() => onLoad(c)}
                  title={`Saved ${new Date(c.savedAt).toLocaleString()}`}
                >
                  {c.name}
                </button>
                <button
                  type="button"
                  className="icon"
                  aria-label={`Delete ${c.name}`}
                  onClick={() => onDelete(c.name)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="link small" onClick={onToggleCompare}>
            {comparing ? 'Hide case comparison' : `Compare ${cases.length + 1} cases side by side`}
          </button>
        </>
      )}
    </div>
  );
}

/** Headline outputs of the current inputs and every saved case, computed by the same engine. */
export function CaseComparison({
  calc,
  current,
  cases,
}: {
  calc: Calculator;
  current: Values;
  cases: SavedCase[];
}) {
  const columns = [{ name: 'Current', values: current }, ...cases];
  const outputs = columns.map((c) => {
    try {
      const r = calc.compute({ ...defaults(calc), ...c.values });
      return {
        status: r.result.status,
        outputs: r.view?.outputs ?? [],
        error: r.result.errors[0]?.message,
      };
    } catch (e) {
      return { status: 'error' as const, outputs: [], error: String(e) };
    }
  });
  const labels = [...new Set(outputs.flatMap((o) => o.outputs.map((x) => x.label)))];
  return (
    <section className="case-compare">
      <h2 className="section-title">Case Comparison</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Metric</th>
              {columns.map((c) => (
                <th key={c.name} className="num">
                  {c.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Status</td>
              {outputs.map((o, i) => (
                <td
                  key={i}
                  className={`num ${o.status === 'error' ? 'tone-bad' : o.status === 'warning' ? 'tone-neutral' : 'tone-good'}`}
                  title={o.error ?? ''}
                >
                  {o.status}
                </td>
              ))}
            </tr>
            {labels.map((l) => (
              <tr key={l}>
                <td>{l}</td>
                {outputs.map((o, i) => (
                  <td key={i} className="num">
                    {o.outputs.find((x) => x.label === l)?.value ?? '—'}
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
