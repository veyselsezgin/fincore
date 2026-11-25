import * as E from '@fincore/engine';
import { useRef, useState } from 'react';
import { normaliseExpenseSigns, parseStatementBlock } from '../io/statements';
import {
  MAX_IMPORT_BYTES,
  readNumber,
  parseDatedList,
  parseNumberList,
  type DecimalStyle,
  type ParseReport,
} from '../io/parse';
import {
  spreadRows,
  txt,
  type DatedRow,
  type DistRow,
  type BenchmarkValues,
  type DistType,
  type Field,
  type FieldValue,
  type StatementGrid,
} from '../registry';

interface Props {
  field: Field;
  value: FieldValue;
  invalid: boolean;
  onChange: (v: FieldValue) => void;
}

export function FieldInput({ field, value, invalid, onChange }: Props) {
  const id = `f-${field.key}`;
  const isList =
    field.kind === 'numberList' || field.kind === 'datedFlows' || field.kind === 'distFlows';
  const wide = field.kind === 'statementGrid' || field.kind === 'benchmarks';
  return (
    <div className={`field ${invalid ? 'invalid' : ''} ${wide ? 'span-all' : ''}`}>
      <div className="field-head">
        <label htmlFor={id}>{field.label}</label>
        {isList && <ImportButton field={field} value={value} onChange={onChange} />}
        {field.kind === 'statementGrid' && (
          <StatementImportButton
            grid={value as StatementGrid}
            maxPeriods={field.maxPeriods}
            onChange={onChange}
          />
        )}
      </div>
      {renderControl(id, field, value, onChange)}
      {field.hint && <small className="hint">{field.hint}</small>}
    </div>
  );
}

function renderControl(
  id: string,
  field: Field,
  value: FieldValue,
  onChange: (v: FieldValue) => void,
) {
  switch (field.kind) {
    case 'number':
      return (
        <>
          <div className="input-wrap">
            <input
              id={id}
              inputMode="decimal"
              value={value as string}
              onChange={(e) => onChange(e.target.value)}
            />
            {field.suffix && <span className="suffix">{field.suffix}</span>}
          </div>
          <ReadAs text={value as string} />
        </>
      );
    case 'date':
      return (
        <input
          id={id}
          type="date"
          value={value as string}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'select':
      return (
        <select id={id} value={value as string} onChange={(e) => onChange(e.target.value)}>
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case 'numberList':
      return <NumberList values={value as string[]} onChange={onChange} />;
    case 'datedFlows':
      return <DatedList rows={value as DatedRow[]} onChange={onChange} />;
    case 'distFlows':
      return <DistList rows={value as DistRow[]} onChange={onChange} />;
    case 'statementGrid':
      return (
        <StatementGridInput
          grid={value as StatementGrid}
          maxPeriods={field.maxPeriods}
          onChange={onChange}
        />
      );
    case 'slider':
      return (
        <div className="slider">
          <input
            id={id}
            type="range"
            min={field.min}
            max={field.max}
            step={field.step}
            value={Number(value) || 0}
            onChange={(e) => onChange(e.target.value)}
          />
          <span className="slider-value">
            {Number(value) > 0 ? '+' : ''}
            {value as string}
            {field.suffix}
          </span>
        </div>
      );
    case 'benchmarks':
      return <BenchmarkEditor values={value as BenchmarkValues} onChange={onChange} />;
  }
}

// --- statement grid --------------------------------------------------------------------------

const SECTION_TITLE: Record<E.StatementSection, string> = {
  assets: 'Balance sheet: assets',
  liabilities: 'Balance sheet: liabilities & equity',
  income: 'Income statement',
  other: 'Debt service, cash flow & market data',
};

function StatementGridInput({
  grid,
  maxPeriods,
  onChange,
}: {
  grid: StatementGrid;
  maxPeriods: number;
  onChange: (g: StatementGrid) => void;
}) {
  const n = grid.periods.length;
  const setCell = (key: E.StatementItemKey, p: number, x: string) => {
    const row = [...(grid.values[key] ?? Array(n).fill(''))];
    row[p] = x;
    onChange({ ...grid, values: { ...grid.values, [key]: row } });
  };
  const setLabel = (p: number, x: string) =>
    onChange({ ...grid, periods: grid.periods.map((l, i) => (i === p ? x : l)) });
  const addPeriod = () => {
    const lastLabel = grid.periods[n - 1] ?? 'FY2024';
    const m = /(\d{4})/.exec(lastLabel);
    const label = m ? lastLabel.replace(m[1]!, String(Number(m[1]) + 1)) : `Period ${n + 1}`;
    const values = Object.fromEntries(
      Object.entries(grid.values).map(([k, row]) => [k, [...(row ?? []), '']]),
    );
    onChange({ periods: [...grid.periods, label], values });
  };
  const removePeriod = (p: number) =>
    onChange({
      periods: grid.periods.filter((_, i) => i !== p),
      values: Object.fromEntries(
        Object.entries(grid.values).map(([k, row]) => [k, (row ?? []).filter((_, i) => i !== p)]),
      ),
    });

  let section = '';
  return (
    <div className="table-wrap statement-grid">
      <table>
        <thead>
          <tr>
            <th>Line item</th>
            {grid.periods.map((label, p) => (
              <th key={p} className="period-head">
                <input
                  value={label}
                  onChange={(e) => setLabel(p, e.target.value)}
                  aria-label={`Period ${p + 1} label`}
                />
                <RemoveButton disabled={n <= 1} onClick={() => removePeriod(p)} />
              </th>
            ))}
            {n < maxPeriods && (
              <th>
                <button type="button" className="add" onClick={addPeriod}>
                  + Period
                </button>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {E.STATEMENT_ITEMS.flatMap((it) => {
            const rows = [];
            if (it.section !== section) {
              section = it.section;
              rows.push(
                <tr key={`s-${section}`} className="section-row">
                  <th colSpan={n + 2}>{SECTION_TITLE[it.section]}</th>
                </tr>,
              );
            }
            rows.push(
              <tr key={it.key}>
                <th className="item-label">{it.label}</th>
                {grid.periods.map((_, p) => (
                  <td key={p}>
                    <input
                      inputMode="decimal"
                      value={grid.values[it.key]?.[p] ?? ''}
                      onChange={(e) => setCell(it.key, p, e.target.value)}
                      aria-label={`${it.label}, ${grid.periods[p]}`}
                    />
                  </td>
                ))}
                {n < maxPeriods && <td />}
              </tr>,
            );
            return rows;
          })}
        </tbody>
      </table>
    </div>
  );
}

function StatementImportButton({
  grid,
  maxPeriods,
  onChange,
}: {
  grid: StatementGrid;
  maxPeriods: number;
  onChange: (g: StatementGrid) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [decimal, setDecimal] = useState<DecimalStyle>('auto');
  const imp = text.trim() ? normaliseExpenseSigns(parseStatementBlock(text, { decimal })) : null;
  const ok = imp && imp.errors.length === 0 && imp.matched.length > 0;

  const apply = () => {
    const n = Math.min(maxPeriods, Math.max(1, imp!.periodCount));
    const periods =
      imp!.periods?.slice(0, n) ??
      Array.from({ length: n }, (_, i) => grid.periods[i] ?? `Period ${i + 1}`);
    while (periods.length < n) periods.push(`Period ${periods.length + 1}`);
    const values: StatementGrid['values'] = {};
    for (const it of E.STATEMENT_ITEMS) {
      const got = imp!.values[it.key];
      values[it.key] = periods.map((_, p) => (got && got[p] !== undefined ? txt(got[p]!) : ''));
    }
    onChange({ periods, values });
    setOpen(false);
    setText('');
  };

  return (
    <>
      <button
        type="button"
        className="link small"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        {open ? 'Close' : 'Import Statements'}
      </button>
      {open && (
        <div className="import-panel span-all">
          <p className="hint">
            Copy the statement block from Excel (row labels in the first column, one column per
            year, oldest first) and paste it here. Labels are matched in English or Turkish (e.g.
            “Revenue / Hasılat”, “Trade receivables / Ticari alacaklar”). Missing items stay empty
            for you to fill in.
          </p>
          <textarea
            rows={8}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              'Kalem\t2024\t2025\nHasılat\t3.200\t3.300\nSatışların maliyeti\t(2.140)\t(2.300)\nTicari alacaklar\t470\t610'
            }
            aria-label="Statements to import"
          />
          <div className="import-controls">
            <label>
              <span>Decimal Mark</span>
              <select value={decimal} onChange={(e) => setDecimal(e.target.value as DecimalStyle)}>
                <option value="auto">Auto-detect</option>
                <option value="dot">Dot: 1,234.56</option>
                <option value="comma">Comma: 1.234,56</option>
              </select>
            </label>
          </div>
          {imp && (
            <div className="import-report">
              {imp.errors.map((e) => (
                <p key={e} className="import-msg error">
                  {e}
                </p>
              ))}
              {imp.notes.map((x) => (
                <p key={x} className="import-msg warn">
                  {x}
                </p>
              ))}
              {imp.matched.length > 0 && (
                <p className="import-msg ok">
                  {imp.matched.length} line item(s) recognised across {imp.periodCount} period(s)
                  {imp.periods ? ` (${imp.periods.join(', ')})` : ''}.
                </p>
              )}
              {imp.unmatched.length > 0 && (
                <p className="import-msg warn">
                  Not recognised, ignored:{' '}
                  {imp.unmatched
                    .slice(0, 6)
                    .map((u) => `“${u.label}”`)
                    .join(', ')}
                  {imp.unmatched.length > 6 ? ` and ${imp.unmatched.length - 6} more` : ''}.
                </p>
              )}
              {imp.periodCount > maxPeriods && (
                <p className="import-msg warn">Only the first {maxPeriods} periods are used.</p>
              )}
            </div>
          )}
          <div className="import-actions">
            <button type="button" className="primary" disabled={!ok} onClick={apply}>
              Load Statements
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// --- benchmarks ------------------------------------------------------------------------------

const UNIT_SUFFIX: Record<E.RatioUnit, string> = { x: '×', pct: '%', days: 'days', money: '' };

function BenchmarkEditor({
  values,
  onChange,
}: {
  values: BenchmarkValues;
  onChange: (v: BenchmarkValues) => void;
}) {
  const ids = E.RATIO_IDS.filter((id) => E.ratioMeta(id).better !== 'neutral');
  return (
    <div className="benchmark-grid">
      {ids.map((id) => {
        const m = E.ratioMeta(id);
        return (
          <label key={id} className="param">
            <span>{m.label}</span>
            <div className="input-wrap">
              <input
                inputMode="decimal"
                value={values[id] ?? ''}
                placeholder="—"
                onChange={(e) => onChange({ ...values, [id]: e.target.value })}
              />
              <span className="suffix">{UNIT_SUFFIX[m.unit]}</span>
            </div>
          </label>
        );
      })}
    </div>
  );
}

/** Shows how a typed number was read when separators were interpreted ("12,5" → 12.5). */
function ReadAs({ text }: { text: string }) {
  const r = readNumber(text ?? '');
  if (!r || (!r.reinterpreted && !r.ambiguous)) return null;
  const shown = r.value.toLocaleString('en-US', { maximumFractionDigits: 10 });
  return (
    <span className={`read-as ${r.ambiguous ? 'ambiguous' : ''}`}>
      {r.ambiguous ? `Ambiguous: read as ${shown}` : `Read as ${shown}`}
    </span>
  );
}

function RemoveButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className="icon"
      title="Remove"
      aria-label="Remove row"
      disabled={disabled}
      onClick={onClick}
    >
      ×
    </button>
  );
}

function NumberList({ values, onChange }: { values: string[]; onChange: (v: string[]) => void }) {
  const set = (i: number, x: string) => onChange(values.map((v, j) => (j === i ? x : v)));
  return (
    <div className="rows">
      {values.map((v, i) => (
        <div className="row" key={i}>
          <span className="row-label">t = {i}</span>
          <input
            inputMode="decimal"
            value={v}
            onChange={(e) => set(i, e.target.value)}
            aria-label={`Cash flow ${i}`}
          />
          <RemoveButton
            disabled={values.length <= 1}
            onClick={() => onChange(values.filter((_, j) => j !== i))}
          />
        </div>
      ))}
      <button type="button" className="add" onClick={() => onChange([...values, '0'])}>
        + Add Period
      </button>
    </div>
  );
}

function DatedList({ rows, onChange }: { rows: DatedRow[]; onChange: (v: DatedRow[]) => void }) {
  const set = (i: number, patch: Partial<DatedRow>) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="rows">
      {rows.map((r, i) => (
        <div className="row dated" key={i}>
          <input
            type="date"
            value={r.date}
            onChange={(e) => set(i, { date: e.target.value })}
            aria-label={`Date ${i}`}
          />
          <input
            inputMode="decimal"
            value={r.amount}
            onChange={(e) => set(i, { amount: e.target.value })}
            aria-label={`Amount ${i}`}
          />
          <RemoveButton
            disabled={rows.length <= 1}
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
          />
        </div>
      ))}
      <button
        type="button"
        className="add"
        onClick={() =>
          onChange([...rows, { date: rows.at(-1)?.date ?? '2025-01-01', amount: '0' }])
        }
      >
        + Add Cash Flow
      </button>
    </div>
  );
}

const DIST_PARAMS: Record<DistType, string[]> = {
  fixed: ['Value'],
  normal: ['Mean', 'Std. dev.'],
  triangular: ['Min', 'Most likely', 'Max'],
  uniform: ['Min', 'Max'],
};

function DistList({ rows, onChange }: { rows: DistRow[]; onChange: (v: DistRow[]) => void }) {
  const set = (i: number, patch: Partial<DistRow>) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="rows">
      {rows.map((r, i) => {
        const params = DIST_PARAMS[r.type];
        return (
          <div className="dist-row" key={i}>
            <div className="dist-head">
              <span className="row-label">t = {i}</span>
              <select
                value={r.type}
                onChange={(e) => set(i, { type: e.target.value as DistType })}
                aria-label={`Distribution ${i}`}
              >
                <option value="fixed">Fixed</option>
                <option value="normal">Normal</option>
                <option value="triangular">Triangular</option>
                <option value="uniform">Uniform</option>
              </select>
              <RemoveButton
                disabled={rows.length <= 2}
                onClick={() => onChange(rows.filter((_, j) => j !== i))}
              />
            </div>
            <div className={`dist-params n${params.length}`}>
              {params.map((p, k) => {
                const key = (['a', 'b', 'c'] as const)[k]!;
                return (
                  <label key={p} className="param">
                    <span>{p}</span>
                    <input
                      inputMode="decimal"
                      value={r[key]}
                      onChange={(e) => set(i, { [key]: e.target.value })}
                      aria-label={`${p} ${i}`}
                    />
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}
      <button
        type="button"
        className="add"
        onClick={() => onChange([...rows, { type: 'triangular', a: '0', b: '0', c: '0' }])}
      >
        + Add Period
      </button>
    </div>
  );
}

// --- bulk import -----------------------------------------------------------------------------

type Spread = 'fixed' | 'triangular' | 'normal';

function ImportButton({
  field,
  value,
  onChange,
}: {
  field: Field;
  value: FieldValue;
  onChange: (v: FieldValue) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="link small"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        {open ? 'Close' : 'Import Data'}
      </button>
      {open && (
        <ImportPanel
          field={field}
          value={value}
          onDone={(v) => {
            onChange(v);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

function ImportPanel({
  field,
  value,
  onDone,
}: {
  field: Field;
  value: FieldValue;
  onDone: (v: FieldValue) => void;
}) {
  const [text, setText] = useState('');
  const [decimal, setDecimal] = useState<DecimalStyle>('auto');
  const [spread, setSpread] = useState<Spread>('triangular');
  const [spreadPct, setSpreadPct] = useState('20');
  const [fileError, setFileError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dated = field.kind === 'datedFlows';

  const report: ParseReport<number | { date: string; amount: number }> | null = text.trim()
    ? dated
      ? parseDatedList(text, { decimal })
      : parseNumberList(text, { decimal })
    : null;
  const ok = report && report.errors.length === 0 && report.values.length > 0;

  const build = (mode: 'replace' | 'append'): FieldValue => {
    const vals = report!.values;
    if (field.kind === 'datedFlows') {
      const rows = (vals as { date: string; amount: number }[]).map((r) => ({
        date: r.date,
        amount: txt(r.amount),
      }));
      return mode === 'append' ? [...(value as DatedRow[]), ...rows] : rows;
    }
    if (field.kind === 'distFlows') {
      const s = (readNumber(spreadPct)?.value ?? 0) / 100;
      const nums = vals as number[];
      // spreadRows keeps index 0 fixed (the initial investment); appended rows are all future flows.
      if (mode === 'append')
        return [...(value as DistRow[]), ...spreadRows([0, ...nums], spread, s).slice(1)];
      return spreadRows(nums, spread, s);
    }
    const rows = (vals as number[]).map(txt);
    return mode === 'append' ? [...(value as string[]), ...rows] : rows;
  };

  const onFile = async (f: File | undefined) => {
    setFileError(null);
    if (!f) return;
    if (!/\.(csv|txt|tsv)$/i.test(f.name))
      return setFileError(
        'Choose a .csv, .tsv or .txt file. For Excel files, select the cells in Excel and paste them here.',
      );
    if (f.size > MAX_IMPORT_BYTES) return setFileError('The file is larger than 1 MB.');
    setText(await f.text());
  };

  return (
    <div className="import-panel">
      <p className="hint">
        {dated
          ? 'Paste two columns from Excel (date and amount, YYYY-MM-DD or DD.MM.YYYY), or load a CSV file.'
          : 'Paste a column from Excel or load a CSV file. Header rows are skipped; with several columns, the last number in each row is used.'}
      </p>
      <textarea
        rows={6}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={
          dated
            ? '01.01.2025\t-100.000\n30.06.2025\t25.000'
            : '-100000\n30000\n35.000,50\n(1,250.00)'
        }
        aria-label="Data to import"
      />
      <div className="import-controls">
        <label>
          <span>Decimal Mark</span>
          <select value={decimal} onChange={(e) => setDecimal(e.target.value as DecimalStyle)}>
            <option value="auto">Auto-detect</option>
            <option value="dot">Dot: 1,234.56</option>
            <option value="comma">Comma: 1.234,56</option>
          </select>
        </label>
        {field.kind === 'distFlows' && (
          <>
            <label>
              <span>Distribution</span>
              <select value={spread} onChange={(e) => setSpread(e.target.value as Spread)}>
                <option value="triangular">Triangular ± range</option>
                <option value="normal">Normal, SD = % of value</option>
                <option value="fixed">Fixed</option>
              </select>
            </label>
            {spread !== 'fixed' && (
              <label>
                <span>Spread ±%</span>
                <input
                  inputMode="decimal"
                  value={spreadPct}
                  onChange={(e) => setSpreadPct(e.target.value)}
                />
              </label>
            )}
          </>
        )}
        <label className="file">
          <span>CSV File</span>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.tsv,.txt,text/csv,text/plain"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
        </label>
      </div>
      {fileError && <p className="import-msg error">{fileError}</p>}
      {report && (
        <div className="import-report">
          {report.errors.map((e) => (
            <p key={e} className="import-msg error">
              {e}
            </p>
          ))}
          {report.notes.map((n) => (
            <p key={n} className="import-msg warn">
              {n}
            </p>
          ))}
          {report.errors.length === 0 && (
            <p className="import-msg ok">
              {report.values.length} value(s) ready
              {report.skipped.length > 0 &&
                `, ${report.skipped.length} non-numeric row(s) skipped (${report.skipped
                  .slice(0, 2)
                  .map((s) => `"${s.text.slice(0, 24)}"`)
                  .join(', ')})`}
              .{field.kind === 'distFlows' && ' The first value stays fixed (initial investment).'}
            </p>
          )}
        </div>
      )}
      <div className="import-actions">
        <button
          type="button"
          className="primary"
          disabled={!ok}
          onClick={() => onDone(build('replace'))}
        >
          Replace Series
        </button>
        <button
          type="button"
          className="secondary"
          disabled={!ok}
          onClick={() => onDone(build('append'))}
        >
          Append to Series
        </button>
      </div>
    </div>
  );
}
