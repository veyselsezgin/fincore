import { lazy, Suspense, useState, type ReactNode } from 'react';
import { fmtTrace, fullPrecision } from '../format';
import type {
  Action,
  Calculator,
  Computation,
  Presentation,
  PresentationSection,
  SectionPart,
  TableSpec,
  Values,
} from '../registry';
import { DiagnosticsView, DupontView, ZScoreView } from './Analysis';
import { writeXlsx } from '../io/xlsx';
// KaTeX is large and only needed for the trace tab: load it on demand.
const Formula = lazy(() => import('./Formula').then((m) => ({ default: m.Formula })));
import { Heatmap } from './Heatmap';
import { Histogram } from './Histogram';
import { NpvChart } from './NpvChart';

const STATUS_LABEL = {
  ok: 'Verified',
  warning: 'Review Flags',
  error: 'Invalid Input',
} as const;

interface Props {
  calc: Calculator;
  values: Values;
  computation: Computation;
  onAction: (a: Action) => void;
  /** Renders an input field inside a result section (fields with placement 'view'). */
  renderField?: (key: string) => ReactNode;
}

export function ResultPanel({ calc, values, computation, onAction, renderField }: Props) {
  const { result, view } = computation;
  const [tab, setTab] = useState<'steps' | 'assumptions' | 'raw'>('steps');
  const [sectionId, setSectionId] = useState<string | null>(null);
  const sections = view?.sections;
  const section = sections ? (sections.find((s) => s.id === sectionId) ?? sections[0]!) : null;

  return (
    <section className="results" aria-live="polite">
      <div className="results-head">
        <div className={`status status-${result.status}`}>
          <span className="dot" />
          {STATUS_LABEL[result.status]}
          <code className="formula-id">{result.formulaId}</code>
        </div>
        <ExportBar calc={calc} values={values} computation={computation} />
      </div>

      {result.errors.length > 0 && (
        <ul className="issues errors">
          {result.errors.map((e, i) => (
            <li key={i}>
              <strong>{e.code}</strong> {e.message}
            </li>
          ))}
        </ul>
      )}
      {result.warnings.length > 0 && (
        <ul className="issues warnings">
          {result.warnings.map((w, i) => (
            <li key={i}>
              <strong>{w.code}</strong> {w.message}
            </li>
          ))}
        </ul>
      )}

      {sections && section && (
        <div className="subtabs" role="tablist" aria-label="Result sections">
          {sections.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={s.id === section.id}
              className={s.id === section.id ? 'active' : ''}
              onClick={() => setSectionId(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      {view && (
        <ViewParts view={view} section={section} onAction={onAction} renderField={renderField} />
      )}

      <div className="tabs" role="tablist">
        {(['steps', 'assumptions', 'raw'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={tab === t ? 'active' : ''}
            onClick={() => setTab(t)}
          >
            {t === 'steps'
              ? `Calculation Trace · ${result.steps.length}`
              : t === 'assumptions'
                ? `Assumptions & Conventions · ${result.assumptions.length}`
                : 'Audit Payload'}
          </button>
        ))}
      </div>

      {tab === 'steps' && (
        <ol className="steps">
          {result.steps.length === 0 && (
            <li className="muted">No trace: inputs failed validation.</li>
          )}
          {result.steps.map((s, i) => (
            <li key={`${s.id}-${i}`}>
              <div className="step-head">
                <span>{s.label}</span>
                {s.value !== undefined && (
                  <code className="step-value" title={fullPrecision(s.value)}>
                    {fmtTrace(s.value)}
                  </code>
                )}
              </div>
              {s.expression && (
                <Suspense fallback={<code className="formula">{s.expression}</code>}>
                  <Formula tex={s.expression} />
                </Suspense>
              )}
            </li>
          ))}
        </ol>
      )}
      {tab === 'assumptions' && (
        <ul className="assumptions">
          {result.assumptions.map((a) => (
            <li key={a.id}>{a.text}</li>
          ))}
          {result.assumptions.length === 0 && <li className="muted">No conventions recorded.</li>}
        </ul>
      )}
      {tab === 'raw' && <pre className="raw">{JSON.stringify(result, null, 2)}</pre>}

      {view?.table && <DataTable spec={view.table} />}

      <p className="engine-version">Engine v{result.engineVersion}</p>
    </section>
  );
}

const ALL_PARTS: SectionPart[] = [
  'outputs',
  'notes',
  'actions',
  'chart',
  'histogram',
  'heatmap',
  'diagnostics',
  'tables',
  'dupont',
  'zscore',
];

/**
 * Renders the presentation parts, either all of them in the default order or only those of the
 * selected sub-tab (with optional filters on outputs and tables, and inline input fields).
 */
function ViewParts({
  view,
  section,
  onAction,
  renderField,
}: {
  view: Presentation;
  section: PresentationSection | null;
  onAction: (a: Action) => void;
  renderField: ((key: string) => ReactNode) | undefined;
}) {
  const parts = new Set(section ? section.include : ALL_PARTS);
  const outputs = section?.outputs
    ? view.outputs.filter((o) => section.outputs!.includes(o.label))
    : view.outputs;
  const tables = section?.tables
    ? (view.tables ?? []).filter((t) => section.tables!.some((p) => t.title?.startsWith(p)))
    : (view.tables ?? []);
  return (
    <>
      {section?.fields && renderField && (
        <div className="section-fields">{section.fields.map((k) => renderField(k))}</div>
      )}
      {parts.has('outputs') && outputs.length > 0 && (
        <div className="outputs">
          {outputs.map((o) => (
            <div key={o.label} className={`output ${o.primary ? 'primary' : ''}`}>
              <span className="output-label">{o.label}</span>
              <span className={`output-value ${/^[-−]\d/.test(o.value) ? 'neg' : ''}`}>
                {o.value}
              </span>
              {o.sub && <span className="output-sub">{o.sub}</span>}
            </div>
          ))}
        </div>
      )}
      {parts.has('notes') &&
        view.notes?.map((n) => (
          <p key={n} className="note">
            {n}
          </p>
        ))}
      {parts.has('actions') && view.actions && view.actions.length > 0 && (
        <div className="actions">
          {view.actions.map((a) => (
            <button key={a.label} type="button" className="action" onClick={() => onAction(a)}>
              {a.label}
            </button>
          ))}
        </div>
      )}
      {parts.has('chart') && view.chart && <NpvChart spec={view.chart} />}
      {parts.has('histogram') && view.histogram && <Histogram spec={view.histogram} />}
      {parts.has('heatmap') && view.heatmap && <Heatmap spec={view.heatmap} />}
      {parts.has('diagnostics') && view.diagnostics && <DiagnosticsView items={view.diagnostics} />}
      {parts.has('tables') &&
        tables.map((t) => <DataTable key={t.title ?? t.columns.join()} spec={t} />)}
      {parts.has('dupont') && view.dupont && <DupontView spec={view.dupont} />}
      {parts.has('zscore') && view.zscore && <ZScoreView spec={view.zscore} />}
    </>
  );
}

function DataTable({ spec }: { spec: TableSpec }) {
  return (
    <>
      {spec.title && <h3 className="table-title">{spec.title}</h3>}
      {spec.note && <p className="table-note">{spec.note}</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {spec.columns.map((c, i) => (
                <th key={c} className={spec.numeric?.[i] ? 'num' : ''}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {spec.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, i) => {
                  const tone = spec.tones?.[r]?.[i];
                  return (
                    <td
                      key={i}
                      className={`${spec.numeric?.[i] ? 'num' : ''} ${tone ? `tone-${tone}` : ''}`}
                    >
                      {cell}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ExportBar({
  calc,
  values,
  computation,
}: {
  calc: Calculator;
  values: Values;
  computation: Computation;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const disabled = computation.result.status === 'error';

  const run = async (kind: string, job: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await job();
    } catch (e) {
      setError(`${kind} export failed: ${String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="export-bar">
      {calc.excel && (
        <button
          type="button"
          disabled={disabled || !!busy}
          title="Workbook with live Excel formulas (=NPV, =IRR, =XIRR…): every figure is auditable"
          onClick={() =>
            run('Excel', async () => {
              const book = calc.excel!(values);
              if (!book) throw new Error('inputs are not valid');
              const { saveBlob } = await import('../io/report');
              saveBlob(await writeXlsx(book), book.fileName);
            })
          }
        >
          {busy === 'Excel' ? 'Building…' : 'Export XLSX'}
        </button>
      )}
      <button
        type="button"
        disabled={disabled || !!busy}
        title="Parameters and outputs as CSV"
        onClick={() =>
          run('CSV', async () =>
            (await import('../io/report')).exportCsv(calc, values, computation),
          )
        }
      >
        Export CSV
      </button>
      <button
        type="button"
        disabled={disabled || !!busy}
        title="Tear sheet: parameters, outputs, charts, trace and conventions"
        onClick={() =>
          run('PDF', async () =>
            (await import('../io/report')).exportPdf(calc, values, computation),
          )
        }
      >
        {busy === 'PDF' ? 'Building…' : 'Tear Sheet (PDF)'}
      </button>
      {error && <span className="export-error">{error}</span>}
    </div>
  );
}
