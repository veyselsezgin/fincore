import { npvRaw, ratioMeta, RATIO_IDS, STATEMENT_ITEMS, type DupontPeriod } from '@fincore/engine';
import { fmtMoney, fmtPct, fmtTrace } from '../format';
import { profileRange } from '../components/NpvChart';
import { num } from '../registry';
import { heatColorRgb } from './colors';
import { csvCell } from './parse';
import type {
  BenchmarkValues,
  Calculator,
  Computation,
  DatedRow,
  DistRow,
  Presentation,
  StatementGrid,
  TableSpec,
  Values,
} from '../registry';

export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const stamp = () => new Date().toISOString().slice(0, 10);

/** Human-readable inputs, shared by the PDF and CSV exports. */
export function inputRows(
  calc: Calculator,
  values: Values,
): {
  scalars: [string, string][];
  lists: { title: string; columns: string[]; rows: string[][] }[];
} {
  const scalars: [string, string][] = [];
  const lists: { title: string; columns: string[]; rows: string[][] }[] = [];
  for (const f of calc.fields) {
    if (f.visible && !f.visible(values)) continue;
    const v = values[f.key] ?? f.default;
    switch (f.kind) {
      case 'number':
        scalars.push([f.label, `${v as string}${f.suffix ?? ''}`]);
        break;
      case 'date':
        scalars.push([f.label, v as string]);
        break;
      case 'select':
        scalars.push([f.label, f.options.find((o) => o.value === v)?.label ?? String(v)]);
        break;
      case 'numberList':
        lists.push({
          title: f.label,
          columns: ['Period', 'Amount'],
          rows: (v as string[]).map((x, i) => [String(i), fmtMoney(num(x))]),
        });
        break;
      case 'datedFlows':
        lists.push({
          title: f.label,
          columns: ['Date', 'Amount'],
          rows: (v as DatedRow[]).map((r) => [r.date, fmtMoney(num(r.amount))]),
        });
        break;
      case 'distFlows':
        lists.push({
          title: f.label,
          columns: ['Period', 'Distribution', 'Parameters'],
          rows: (v as DistRow[]).map((r, i) => [String(i), r.type, describeDist(r)]),
        });
        break;
      case 'slider':
        scalars.push([f.label, `${v as string}${f.suffix ?? ''}`]);
        break;
      case 'statementGrid': {
        const g = v as StatementGrid;
        lists.push({
          title: f.label,
          columns: ['Line item', ...g.periods],
          rows: STATEMENT_ITEMS.map((it) => [
            it.label,
            ...g.periods.map((_, p) => {
              const raw = g.values[it.key]?.[p] ?? '';
              return raw.trim() === '' ? '' : fmtMoney(num(raw));
            }),
          ]),
        });
        break;
      }
      case 'benchmarks': {
        const b = v as BenchmarkValues;
        const rows = RATIO_IDS.filter((id) => (b[id] ?? '').trim() !== '').map((id) => [
          ratioMeta(id).label,
          b[id]!,
        ]);
        if (rows.length) lists.push({ title: f.label, columns: ['Ratio', 'Target'], rows });
        break;
      }
    }
  }
  return { scalars, lists };
}

/** Every table of a presentation, including analysis sections, as plain rows. */
export function presentationTables(view: Presentation): TableSpec[] {
  const out: TableSpec[] = [];
  if (view.diagnostics) {
    out.push({
      title: 'Red flags',
      columns: ['Severity', 'Period', 'Finding'],
      rows: view.diagnostics.length
        ? view.diagnostics.map((d) => [d.severity, d.period, d.message])
        : [['', '', 'No rule triggered']],
    });
  }
  if (view.tables) out.push(...view.tables);
  if (view.dupont) {
    const d = view.dupont;
    const f = (x: number | null, pct: boolean) =>
      x === null ? 'n/a' : pct ? fmtPct(x, 2) : x.toFixed(3);
    const rows: [string, keyof DupontPeriod, boolean][] = [
      ['Net margin', 'netMargin', true],
      ['Asset turnover', 'assetTurnover', false],
      ['Equity multiplier', 'equityMultiplier', false],
      ['Tax burden', 'taxBurden', false],
      ['Interest burden', 'interestBurden', false],
      ['EBIT margin', 'ebitMargin', true],
      ['ROE', 'roe', true],
    ];
    out.push({
      title: 'DuPont decomposition',
      columns: ['Factor', ...d.periods],
      rows: rows.map(([l, k, p]) => [l, ...d.rows.map((r) => f(r[k], p))]),
    });
  }
  if (view.zscore) {
    const z = view.zscore;
    out.push({
      title: `Altman Z-score: ${z.modelLabel} (distress < ${z.distress}, safe > ${z.safe})`,
      columns: ['Component', 'Weight', ...z.periods],
      rows: [
        ...z.altman[0]!.components.map((c, k) => [
          `${c.id}: ${c.label}`,
          String(c.weight),
          ...z.altman.map((a) =>
            a.components[k]!.value === null ? 'n/a' : a.components[k]!.value!.toFixed(4),
          ),
        ]),
        ['Z-score', '', ...z.altman.map((a) => (a.score === null ? 'n/a' : a.score.toFixed(2)))],
        ['Zone', '', ...z.altman.map((a) => a.zone ?? 'n/a')],
      ],
    });
  }
  if (view.table) out.push(view.table);
  return out;
}

function describeDist(r: DistRow): string {
  const m = (s: string) => fmtMoney(num(s));
  switch (r.type) {
    case 'fixed':
      return m(r.a);
    case 'normal':
      return `mean ${m(r.a)}, SD ${m(r.b)}`;
    case 'triangular':
      return `min ${m(r.a)}, most likely ${m(r.b)}, max ${m(r.c)}`;
    case 'uniform':
      return `min ${m(r.a)}, max ${m(r.b)}`;
  }
}

// --- CSV -------------------------------------------------------------------------------------

export function exportCsv(calc: Calculator, values: Values, comp: Computation): void {
  const lines: (string | number)[][] = [
    ['FinCore', calc.title],
    ['Generated', stamp()],
    ['Engine version', comp.result.engineVersion],
    ['Status', comp.result.status],
    [],
    ['Input', 'Value'],
  ];
  const inputs = inputRows(calc, values);
  lines.push(...inputs.scalars);
  for (const l of inputs.lists) lines.push([], [l.title], l.columns, ...l.rows);
  const view = comp.view;
  if (view) {
    lines.push(
      [],
      ['Result', 'Value'],
      ...view.outputs.map((o) => [o.label, o.sub ? `${o.value} (${o.sub})` : o.value]),
    );
    for (const t of presentationTables(view))
      lines.push([], [t.title ?? 'Detail'], t.columns, ...t.rows);
    if (view.heatmap) {
      const h = view.heatmap;
      lines.push([], [h.title], [`${h.rowTitle} \\ ${h.colTitle}`, ...h.colLabels]);
      h.values.forEach((row, i) =>
        lines.push([h.rowLabels[i]!, ...row.map((x) => Number(x.toFixed(2)))]),
      );
    }
  }
  for (const w of comp.result.warnings) lines.push(['Warning', w.message]);
  for (const e of comp.result.errors) lines.push(['Error', e.message]);
  const csv = '﻿' + lines.map((row) => row.map(csvCell).join(',')).join('\r\n');
  saveBlob(
    new Blob([csv], { type: 'text/csv;charset=utf-8' }),
    `fincore-${calc.id}-${stamp()}.csv`,
  );
}

// --- PDF -------------------------------------------------------------------------------------

/** jsPDF's standard fonts cover Latin-1 only: map the symbols FinCore uses to safe text. */
export function pdfText(s: string): string {
  const map: Record<string, string> = {
    '−': '-',
    '–': '-',
    '—': '-',
    '≥': '>=',
    '≤': '<=',
    '±': '+/-',
    '×': 'x',
    '→': '->',
    '↓': '',
    '←': '<-',
    '’': "'",
    '‘': "'",
    '“': '"',
    '”': '"',
    '…': '...',
    '₺': 'TRY ',
    '€': 'EUR ',
    β: 'beta',
    σ: 'sigma',
    Δ: 'Delta ',
    '▲': '+',
    '▼': '-',
    '≈': '~',
    '·': '-',
    ş: 's',
    Ş: 'S',
    ğ: 'g',
    Ğ: 'G',
    ı: 'i',
    İ: 'I',
    ' ': ' ',
    ' ': ' ',
  };
  return s.replace(/[^\x20-\x7e\xa0-\xff]/g, (c) => map[c] ?? '');
}

type Doc = import('jspdf').jsPDF;
type RGB = [number, number, number];

const BLUE: RGB = [31, 111, 235];
const ORANGE: RGB = [221, 120, 20];
const GREEN: RGB = [26, 127, 70];
const RED: RGB = [200, 45, 35];
const GREY: RGB = [110, 120, 135];

export async function exportPdf(
  calc: Calculator,
  values: Values,
  comp: Computation,
): Promise<void> {
  const doc = await buildPdf(calc, values, comp);
  doc.save(`fincore-${calc.id}-report-${stamp()}.pdf`);
}

/** Builds the feasibility report (separate from saving so it can be tested). */
export async function buildPdf(calc: Calculator, values: Values, comp: Computation): Promise<Doc> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 42;
  let y = M;
  const t = pdfText;
  const lastY = () =>
    (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  const ensure = (h: number) => {
    if (y + h > H - M - 20) {
      doc.addPage();
      y = M;
    }
  };
  const heading = (s: string) => {
    ensure(40);
    y += 14;
    doc.setFont('helvetica', 'bold').setFontSize(12).setTextColor(20, 30, 45).text(t(s), M, y);
    y += 8;
  };
  const para = (s: string, color: RGB = [60, 70, 85]) => {
    doc
      .setFont('helvetica', 'normal')
      .setFontSize(9.5)
      .setTextColor(...color);
    const lines = doc.splitTextToSize(t(s), W - 2 * M) as string[];
    ensure(lines.length * 12 + 4);
    doc.text(lines, M, y + 10);
    y += lines.length * 12 + 4;
  };
  const table = (head: string[], body: string[][], opts: Record<string, unknown> = {}) => {
    autoTable(doc, {
      startY: y + 4,
      head: [head.map(t)],
      body: body.map((r) => r.map(t)),
      margin: { left: M, right: M },
      styles: { fontSize: 8.5, cellPadding: 3.5 },
      headStyles: { fillColor: [15, 26, 43] },
      theme: 'grid',
      ...opts,
    });
    y = lastY() + 6;
  };

  // Header band
  doc.setFillColor(15, 26, 43).rect(0, 0, W, 78, 'F');
  doc
    .setFont('helvetica', 'bold')
    .setFontSize(18)
    .setTextColor(255, 255, 255)
    .text('FinCore Tear Sheet', M, 34);
  doc.setFont('helvetica', 'normal').setFontSize(11).text(t(calc.title), M, 54);
  doc
    .setFontSize(8.5)
    .setTextColor(190, 200, 215)
    .text(
      t(`${stamp()}  |  engine v${comp.result.engineVersion}  |  ${comp.result.formulaId}`),
      M,
      68,
    );
  y = 100;
  const statusColor: RGB =
    comp.result.status === 'ok' ? GREEN : comp.result.status === 'warning' ? ORANGE : RED;
  doc
    .setFont('helvetica', 'bold')
    .setFontSize(10)
    .setTextColor(...statusColor);
  doc.text(
    comp.result.status === 'ok'
      ? 'Status: verified, no warnings'
      : comp.result.status === 'warning'
        ? 'Status: result with warnings'
        : 'Status: cannot calculate',
    M,
    y,
  );
  y += 6;
  para(calc.description);

  // Key results
  const view: Presentation | undefined = comp.view;
  if (view) {
    heading('Key results');
    table(
      ['Measure', 'Value'],
      view.outputs.map((o) => [o.label, o.sub ? `${o.value}  (${o.sub})` : o.value]),
      { columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } } },
    );
    for (const n of view.notes ?? []) para(n);
  }
  if (comp.result.warnings.length || comp.result.errors.length) {
    heading('Warnings and errors');
    for (const e of comp.result.errors) para(`Error ${e.code}: ${e.message}`, RED);
    for (const w of comp.result.warnings) para(`Warning ${w.code}: ${w.message}`, ORANGE);
  }

  // Inputs
  const inputs = inputRows(calc, values);
  heading('Inputs');
  if (inputs.scalars.length)
    table(['Input', 'Value'], inputs.scalars, { columnStyles: { 1: { halign: 'right' } } });
  for (const l of inputs.lists) {
    para(l.title);
    table(l.columns, l.rows, { columnStyles: { 1: { halign: 'right' } } });
  }

  // Charts
  if (view?.chart) {
    heading('NPV profile');
    ensure(230);
    drawProfile(doc, view.chart, M, y + 6, W - 2 * M, 210);
    y += 226;
  }
  if (view?.histogram) {
    heading('Distribution of simulated NPV');
    ensure(210);
    drawHistogram(doc, view.histogram, M, y + 6, W - 2 * M, 190);
    y += 206;
  }
  if (view?.heatmap) {
    const h = view.heatmap;
    heading(h.title);
    const maxAbs = Math.max(...h.values.flat().map(Math.abs));
    table(
      [`${h.rowTitle} / ${h.colTitle}`, ...h.colLabels],
      h.values.map((row, i) => [h.rowLabels[i]!, ...row.map((v) => fmtMoney(v))]),
      {
        styles: { fontSize: h.colLabels.length > 7 ? 6.2 : 7.5, cellPadding: 2.5, halign: 'right' },
        didParseCell: (d: {
          section: string;
          column: { index: number };
          row: { index: number };
          cell: { styles: Record<string, unknown> };
        }) => {
          if (d.section !== 'body' || d.column.index === 0) return;
          const v = h.values[d.row.index]![d.column.index - 1]!;
          d.cell.styles.fillColor = heatColorRgb(v, maxAbs);
          if (h.base[0] === d.row.index && h.base[1] === d.column.index - 1)
            d.cell.styles.fontStyle = 'bold';
        },
      },
    );
    para(
      'Bold cell = base case. Rows scale every cash flow after the first; columns scale the discount rate relatively.',
    );
  }
  for (const spec of view ? presentationTables(view) : []) {
    heading(spec.title ?? 'Detail');
    const rows = spec.rows.slice(0, 400);
    table(spec.columns, rows, {
      styles: { fontSize: spec.columns.length > 5 ? 7 : 7.5, cellPadding: 2.5, halign: 'right' },
      columnStyles: { 0: { halign: 'left' } },
    });
    if (spec.rows.length > rows.length)
      para(
        `Showing the first ${rows.length} of ${spec.rows.length} rows; the Excel export has all of them.`,
      );
  }

  // Method
  if (comp.result.steps.length) {
    heading('Calculation steps');
    table(
      ['Step', 'Value'],
      comp.result.steps.map((s) => [s.label, s.value === undefined ? '' : fmtTrace(s.value)]),
      { columnStyles: { 1: { halign: 'right' } } },
    );
  }
  if (comp.result.assumptions.length) {
    heading('Assumptions');
    for (const a of comp.result.assumptions) para(`- ${a.text}`);
  }

  // Footer on every page
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc
      .setFont('helvetica', 'normal')
      .setFontSize(7.5)
      .setTextColor(...GREY);
    doc.text(
      t(
        `Calculated by the FinCore engine v${comp.result.engineVersion} from user-entered inputs only; no market data is used. Not investment advice.`,
      ),
      M,
      H - 22,
    );
    doc.text(`Page ${p} of ${pages}`, W - M, H - 22, { align: 'right' });
  }
  return doc;
}

function niceStep(span: number, count: number): number {
  const raw = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) ?? 10 * mag;
}

function axes(doc: Doc, x0: number, y0: number, w: number, h: number) {
  doc.setDrawColor(225, 229, 236).setLineWidth(0.5).rect(x0, y0, w, h);
}

function drawProfile(
  doc: Doc,
  spec: NonNullable<Presentation['chart']>,
  X: number,
  Y: number,
  Wd: number,
  Ht: number,
) {
  const padL = 52;
  const padB = 20;
  const x0 = X + padL;
  const w = Wd - padL;
  const h = Ht - padB;
  const [lo, hi] = profileRange(spec);
  const lines = spec.series.map((s) =>
    Array.from({ length: 161 }, (_, i) => lo + ((hi - lo) * i) / 160)
      .map((r) => [r, npvRaw(r, s.cashFlows)] as const)
      .filter(([, v]) => Number.isFinite(v)),
  );
  const ys = lines
    .flat()
    .map(([, v]) => v)
    .sort((a, b) => a - b);
  let yMin = Math.min(0, ys[Math.floor(ys.length * 0.02)] ?? 0);
  let yMax = Math.max(0, ys[Math.ceil(ys.length * 0.98) - 1] ?? 0);
  if (yMin === yMax) [yMin, yMax] = [yMin - 1, yMax + 1];
  const px = (r: number) => x0 + ((r - lo) / (hi - lo)) * w;
  const py = (v: number) => Y + ((yMax - Math.min(yMax, Math.max(yMin, v))) / (yMax - yMin)) * h;

  axes(doc, x0, Y, w, h);
  doc
    .setFont('helvetica', 'normal')
    .setFontSize(7)
    .setTextColor(...GREY);
  const ys0 = niceStep(yMax - yMin, 5);
  for (let v = Math.ceil(yMin / ys0) * ys0; v <= yMax; v += ys0) {
    doc.setDrawColor(238, 241, 245).line(x0, py(v), x0 + w, py(v));
    doc.text(fmtCompact(v), x0 - 4, py(v) + 2.5, { align: 'right' });
  }
  const xs0 = niceStep(hi - lo, 6);
  for (let r = Math.ceil(lo / xs0) * xs0; r <= hi + 1e-12; r += xs0)
    doc.text(fmtPct(r, 0), px(r), Y + h + 12, { align: 'center' });
  doc
    .setDrawColor(...GREY)
    .setLineWidth(0.8)
    .line(x0, py(0), x0 + w, py(0));

  const colors = [BLUE, ORANGE];
  lines.forEach((pts, i) => {
    doc.setDrawColor(...colors[i % 2]!).setLineWidth(1.6);
    for (let k = 1; k < pts.length; k++)
      doc.line(px(pts[k - 1]![0]), py(pts[k - 1]![1]), px(pts[k]![0]), py(pts[k]![1]));
  });
  if (
    spec.marker !== undefined &&
    Number.isFinite(spec.marker) &&
    spec.marker >= lo &&
    spec.marker <= hi
  ) {
    doc
      .setDrawColor(...ORANGE)
      .setLineWidth(0.6)
      .setLineDashPattern([3, 3], 0)
      .line(px(spec.marker), Y, px(spec.marker), Y + h);
    doc.setLineDashPattern([], 0);
    doc.setTextColor(...ORANGE).text(`r = ${fmtPct(spec.marker, 2)}`, px(spec.marker) + 3, Y + 9);
  }
  for (const p of spec.points.filter((q) => q.rate >= lo && q.rate <= hi)) {
    const cy = p.kind === 'cross' ? py(npvRaw(p.rate, spec.series[0]!.cashFlows)) : py(0);
    doc.setFillColor(...GREEN).circle(px(p.rate), cy, 3, 'F');
    doc
      .setFont('helvetica', 'bold')
      .setTextColor(...GREEN)
      .text(t2(p.label), px(p.rate), cy - 6, { align: 'center' });
  }
  if (spec.series.length > 1) {
    spec.series.forEach((s, i) => {
      doc.setFillColor(...colors[i % 2]!).rect(x0 + 8 + i * 80, Y + 6, 10, 4, 'F');
      doc
        .setFont('helvetica', 'normal')
        .setTextColor(40, 50, 65)
        .text(t2(s.name), x0 + 22 + i * 80, Y + 10);
    });
  }
}

function drawHistogram(
  doc: Doc,
  spec: NonNullable<Presentation['histogram']>,
  X: number,
  Y: number,
  Wd: number,
  Ht: number,
) {
  const padL = 30;
  const padB = 20;
  const x0 = X + padL;
  const w = Wd - padL;
  const h = Ht - padB;
  const lo = spec.bins[0]!.x0;
  const hi = spec.bins[spec.bins.length - 1]!.x1;
  const span = hi - lo || 1;
  const maxC = Math.max(...spec.bins.map((b) => b.count));
  const px = (v: number) => x0 + ((v - lo) / span) * w;
  axes(doc, x0, Y, w, h);
  for (const b of spec.bins) {
    const c: RGB = b.x1 <= 0 ? RED : b.x0 >= 0 ? GREEN : GREY;
    const bh = (b.count / maxC) * (h - 12);
    doc
      .setFillColor(...c)
      .rect(px(b.x0) + 0.4, Y + h - bh, Math.max(0.4, px(b.x1) - px(b.x0) - 0.8), bh, 'F');
  }
  doc
    .setFont('helvetica', 'normal')
    .setFontSize(7)
    .setTextColor(...GREY);
  const st = niceStep(span, 6);
  for (let v = Math.ceil(lo / st) * st; v <= hi; v += st)
    doc.text(fmtCompact(v), px(v), Y + h + 12, { align: 'center' });
  const vline = (v: number, label: string, color: RGB) => {
    if (v < lo || v > hi) return;
    doc
      .setDrawColor(...color)
      .setLineWidth(0.7)
      .setLineDashPattern([3, 2], 0)
      .line(px(v), Y, px(v), Y + h);
    doc.setLineDashPattern([], 0);
    doc.setTextColor(...color).text(label, px(v) + 2, Y + 9);
  };
  vline(0, 'NPV = 0', [20, 30, 45]);
  vline(spec.mean, 'mean', BLUE);
  vline(spec.p5, 'P5', GREY);
  vline(spec.p95, 'P95', GREY);
}

const t2 = pdfText;

function fmtCompact(v: number): string {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(
    v,
  );
}
