import * as E from '@fincore/engine';
import type { Result } from '@fincore/engine';
import { fmtMoney, fmtNum, fmtPct } from './format';
import { list, num, optNum, pct, str, txt } from './fieldValues';
import { readNumber } from './io/parse';
import { bondCalc, dcfCalc, ddmCalc, portfolioCalc, varCalc } from './calculators/markets';
import { cashCalc, ebitEpsCalc, eoqCalc, leverageCalc } from './calculators/corporate';
import * as SB from './io/statementsBook';
import * as W from './io/workbooks';
import type { XBook } from './io/xlsx';

/**
 * Calculator registry. Each calculator is a descriptor; the form, result panel, charts,
 * cross-calculator actions, Excel workbook and PDF report are all generated from it.
 */

export interface DatedRow {
  date: string;
  amount: string;
}

export type DistType = E.Distribution['type'];

export interface DistRow {
  type: DistType;
  a: string;
  b: string;
  c: string;
}

/** Multi-period statement grid: one string per period for every line item. */
export interface StatementGrid {
  periods: string[];
  values: Partial<Record<E.StatementItemKey, string[]>>;
}

/** Ratio id → target as typed by the user (percent ratios in %, days in days, multiples in ×). */
export type BenchmarkValues = Partial<Record<E.RatioId, string>>;

/** Editable table: rows of text cells under fixed columns. */
export type GridValue = string[][];

export type FieldValue =
  string | string[] | DatedRow[] | DistRow[] | StatementGrid | BenchmarkValues | GridValue;
export type Values = Record<string, FieldValue>;

interface FieldBase {
  key: string;
  label: string;
  hint?: string;
  /** Engine field name, when it differs from `key`; used to highlight inputs with errors. */
  engineField?: string;
  /** Hide the field for some input combinations (e.g. the TVM variable being solved for). */
  visible?: (v: Values) => boolean;
  /** 'view': rendered inside a result section (see `PresentationSection.fields`), not the form. */
  placement?: 'view';
}

export type Field =
  | (FieldBase & { kind: 'number'; default: string; suffix?: string })
  | (FieldBase & { kind: 'date'; default: string })
  | (FieldBase & { kind: 'text'; default: string })
  | (FieldBase & { kind: 'select'; default: string; options: { value: string; label: string }[] })
  | (FieldBase & { kind: 'numberList'; default: string[] })
  | (FieldBase & { kind: 'datedFlows'; default: DatedRow[] })
  | (FieldBase & { kind: 'distFlows'; default: DistRow[] })
  | (FieldBase & { kind: 'statementGrid'; default: StatementGrid; maxPeriods: number })
  | (FieldBase & {
      kind: 'slider';
      default: string;
      min: number;
      max: number;
      step: number;
      suffix?: string;
    })
  | (FieldBase & { kind: 'benchmarks'; default: BenchmarkValues })
  | (FieldBase & {
      kind: 'grid';
      default: GridValue;
      columns: { label: string; numeric?: boolean }[];
      minRows: number;
      maxRows: number;
    });

export interface TableSpec {
  title?: string;
  columns: string[];
  rows: string[][];
  numeric?: boolean[];
  /** Optional per-cell tone for status columns. */
  tones?: (('good' | 'bad' | 'neutral' | null)[] | null)[];
  /** Caveat shown under the title (e.g. data-quality warnings that affect these figures). */
  note?: string;
}

export type SectionPart =
  | 'outputs'
  | 'notes'
  | 'actions'
  | 'diagnostics'
  | 'tables'
  | 'dupont'
  | 'zscore'
  | 'chart'
  | 'heatmap'
  | 'histogram'
  | 'lines';

/** A result sub-tab: which presentation parts it shows. */
export interface PresentationSection {
  id: string;
  label: string;
  include: SectionPart[];
  /** Restrict `tables` to these titles (prefix match). */
  tables?: string[];
  /** Restrict `outputs` to these labels. */
  outputs?: string[];
  /** Input fields (placement: 'view') rendered at the top of this section. */
  fields?: string[];
}

export interface Output {
  label: string;
  value: string;
  primary?: boolean;
  sub?: string;
}

export interface ProfileSeries {
  name: string;
  cashFlows: number[];
}

export interface Presentation {
  outputs: Output[];
  notes?: string[];
  table?: TableSpec;
  /** Additional tables, rendered in order after `table`. */
  tables?: TableSpec[];
  /** Rule-based diagnostics (red flags). */
  diagnostics?: E.Diagnostic[];
  dupont?: { periods: string[]; rows: E.DupontPeriod[] };
  zscore?: {
    periods: string[];
    altman: E.AltmanPeriod[];
    distress: number;
    safe: number;
    modelLabel: string;
  };
  chart?: {
    kind: 'npvProfile';
    series: ProfileSeries[];
    points: { rate: number; label: string; kind: 'root' | 'cross' }[];
    marker?: number;
  };
  heatmap?: {
    title: string;
    rowTitle: string;
    colTitle: string;
    rowLabels: string[];
    colLabels: string[];
    values: number[][];
    base: [number, number];
  };
  histogram?: { bins: E.HistogramBin[]; mean: number; p5: number; p95: number };
  /** Generic x–y line chart (EBIT-EPS, cost curves, price–yield). */
  lines?: LineChartSpec;
  /** One-click hand-offs to other calculators (e.g. use this WACC as the NPV discount rate). */
  actions?: Action[];
  /** Blocking data-quality alerts, shown prominently above the inputs. */
  alerts?: { title: string; message: string; items: string[] }[];
  /** Optional sub-tabs that organise long results; without it everything renders in order. */
  sections?: PresentationSection[];
}

export type AxisFormat = 'money' | 'pct' | 'num';

export interface LineChartSpec {
  title: string;
  xLabel: string;
  yLabel: string;
  xFormat: AxisFormat;
  yFormat: AxisFormat;
  series: { name: string; points: [number, number][] }[];
  /** Vertical markers (e.g. EOQ, indifference EBIT, current yield). */
  markers?: { x: number; label: string }[];
}

export interface Action {
  label: string;
  target: string;
  patch: Values;
  message: string;
}

export interface Computation {
  result: Result<unknown>;
  view?: Presentation;
}

export interface Calculator {
  id: string;
  category: string;
  title: string;
  description: string;
  fields: Field[];
  compute: (v: Values) => Computation;
  /** Excel workbook with live formulas, when the inputs are valid. */
  excel?: (v: Values) => XBook | null;
  /** 'wide': inputs span the full width above the results (large input grids). */
  layout?: 'wide';
}

// --- value helpers ---------------------------------------------------------------------------

// num / pct / str / list / txt live in fieldValues.ts (shared with calculators/*), re-exported here.
export { num, txt } from './fieldValues';
const dated = (x: FieldValue | undefined) =>
  Array.isArray(x) ? (x as DatedRow[]).map((r) => ({ date: r.date, amount: num(r.amount) })) : [];

export function toDistribution(r: DistRow): E.Distribution {
  const [a, b, c] = [num(r.a), num(r.b), num(r.c)];
  switch (r.type) {
    case 'fixed':
      return { type: 'fixed', value: a };
    case 'normal':
      return { type: 'normal', mean: a, sd: b };
    case 'triangular':
      return { type: 'triangular', min: a, mode: b, max: c };
    case 'uniform':
      return { type: 'uniform', min: a, max: b };
  }
}

/** Base-case values → distributions with a ±spread around each (first flow kept fixed). */
export function spreadRows(
  values: number[],
  kind: 'fixed' | 'triangular' | 'normal',
  spread: number,
): DistRow[] {
  return values.map((x, i) => {
    if (i === 0 || kind === 'fixed' || x === 0) return { type: 'fixed', a: txt(x), b: '', c: '' };
    if (kind === 'normal')
      return { type: 'normal', a: txt(x), b: txt(Math.abs(x) * spread), c: '' };
    const lo = Math.min(x * (1 - spread), x * (1 + spread));
    const hi = Math.max(x * (1 - spread), x * (1 + spread));
    return { type: 'triangular', a: txt(lo), b: txt(x), c: txt(hi) };
  });
}

const timingField: Field = {
  key: 'timing',
  label: 'Payment Timing',
  kind: 'select',
  default: 'end',
  options: [
    { value: 'end', label: 'End of Period (Ordinary Annuity)' },
    { value: 'begin', label: 'Beginning of Period (Annuity Due)' },
  ],
};

const DEMO_FLOWS = ['-70000', '12000', '15000', '18000', '21000', '26000'];
const signed = (x: number) => (x > 0 ? '+' : x < 0 ? '−' : '±') + fmtPct(Math.abs(x), 0);

// --- TVM -------------------------------------------------------------------------------------

function tvmInputs(v: Values) {
  const ppy = num(v.ppy);
  return {
    solveFor: (str(v.solveFor) || 'pmt') as W.SolveFor,
    ppy,
    annualRate: pct(v.annualRate),
    rate: pct(v.annualRate) / ppy,
    nper: num(v.nper),
    pmt: num(v.pmt),
    pv: num(v.pv),
    fv: num(v.fv),
    timing: str(v.timing) as E.PaymentTiming,
  };
}

function tvmSolve(i: ReturnType<typeof tvmInputs>): Result<number | E.RateOutput> {
  const { rate, nper, pmt, pv, fv, timing } = i;
  switch (i.solveFor) {
    case 'fv':
      return E.fv({ rate, nper, pmt, pv, timing });
    case 'pv':
      return E.pv({ rate, nper, pmt, fv, timing });
    case 'nper':
      return E.nper({ rate, pmt, pv, fv, timing });
    case 'rate':
      return E.rate({ nper, pmt, pv, fv, timing });
    default:
      return E.pmt({ rate, nper, pv, fv, timing });
  }
}

const tvm: Calculator = {
  id: 'tvm',
  category: 'Time Value of Money',
  title: 'TVM Solver',
  description:
    'Five-key TVM solver: solve for FV, PV, PMT, N or I/Y. Sign convention: outflows negative, inflows positive.',
  fields: [
    {
      key: 'solveFor',
      label: 'Solve For',
      kind: 'select',
      default: 'pmt',
      options: [
        { value: 'fv', label: 'Future Value (FV)' },
        { value: 'pv', label: 'Present Value (PV)' },
        { value: 'pmt', label: 'Payment (PMT)' },
        { value: 'nper', label: 'Periods (N)' },
        { value: 'rate', label: 'Rate (I/Y)' },
      ],
    },
    {
      key: 'annualRate',
      label: 'Annual Rate (APR)',
      kind: 'number',
      default: '8',
      suffix: '%',
      engineField: 'rate',
      visible: (v) => v.solveFor !== 'rate',
    },
    {
      key: 'ppy',
      label: 'Compounding Periods / Yr',
      kind: 'number',
      default: '12',
      hint: '12 = monthly, 4 = quarterly, 1 = annual',
    },
    {
      key: 'nper',
      label: 'Periods (N)',
      kind: 'number',
      default: '10',
      visible: (v) => v.solveFor !== 'nper',
    },
    {
      key: 'pv',
      label: 'Present Value (PV)',
      kind: 'number',
      default: '10000',
      visible: (v) => v.solveFor !== 'pv',
    },
    {
      key: 'pmt',
      label: 'Payment (PMT)',
      kind: 'number',
      default: '0',
      visible: (v) => v.solveFor !== 'pmt',
    },
    {
      key: 'fv',
      label: 'Future Value (FV)',
      kind: 'number',
      default: '0',
      visible: (v) => v.solveFor !== 'fv',
    },
    timingField,
  ],
  compute: (v) => {
    const i = tvmInputs(v);
    const r = tvmSolve(i);
    if (r.value === null) return { result: r };
    if (typeof r.value === 'number') {
      const x = r.value;
      const label = {
        fv: 'Future Value (FV)',
        pv: 'Present Value (PV)',
        pmt: 'Payment (PMT)',
        nper: 'Periods (N)',
        rate: '',
      }[i.solveFor];
      const outputs: Output[] =
        i.solveFor === 'nper'
          ? [
              { label, value: fmtNum(x, 4), primary: true },
              { label: 'Term (Years)', value: fmtNum(x / i.ppy, 4) },
            ]
          : [{ label, value: fmtMoney(x), primary: true }];
      return { result: r, view: { outputs } };
    }
    const { rate, roots } = r.value;
    if (rate === null) {
      return {
        result: r,
        view: {
          outputs: roots.map((x, k) => ({
            label: `Solution ${k + 1} (per period)`,
            value: fmtPct(x),
          })),
        },
      };
    }
    return {
      result: r,
      view: {
        outputs: [
          { label: 'Nominal Annual Rate', value: fmtPct(rate * i.ppy), primary: true },
          { label: 'Periodic Rate', value: fmtPct(rate) },
          { label: 'Effective Annual Rate (EAR)', value: fmtPct(Math.pow(1 + rate, i.ppy) - 1) },
        ],
      },
    };
  },
  excel: (v) => {
    const i = tvmInputs(v);
    const r = tvmSolve(i);
    if (r.value === null) return null;
    const result = typeof r.value === 'number' ? r.value : r.value.rate;
    if (result === null) return null;
    return W.tvmBook({ ...i, result });
  },
};

// --- WACC / CAPM -----------------------------------------------------------------------------

/** Hamada re-levering at the target structure (E, D and T from the WACC inputs), when selected. */
function hamadaFor(v: Values): E.Result<E.HamadaOutput> | null {
  if (str(v.betaSource) !== 'hamada') return null;
  return E.hamadaBeta({
    peerBeta: num(v.peerBeta),
    peerDebtToEquity: num(v.peerDebtToEquity),
    peerTaxRate: pct(v.peerTaxRate),
    targetDebtToEquity: num(v.debtValue) / num(v.equityValue),
    targetTaxRate: pct(v.taxRate),
  });
}

/** WACC with an optional Hamada beta step, as one traced calculation (orchestration only). */
function waccResult(v: Values): E.Result<E.WaccOutput> {
  const h = hamadaFor(v);
  if (!h) return E.waccFromCapm(waccInputs(v));
  const t = new E.Trace('valuation.waccFromCapm');
  const hb = t.include('hamada', h);
  if (hb === null) return t.fail();
  const w = t.include('wacc', E.waccFromCapm({ ...waccInputs(v), beta: hb.releveredBeta }));
  return w === null ? t.fail() : t.ok(w);
}

function waccInputs(v: Values): E.WaccFromCapmInput {
  const h = hamadaFor(v);
  return {
    riskFree: pct(v.riskFree),
    beta: h?.value ? h.value.releveredBeta : num(v.beta),
    marketRiskPremium: pct(v.erp),
    equityValue: num(v.equityValue),
    debtValue: num(v.debtValue),
    preTaxCostOfDebt: pct(v.costOfDebt),
    taxRate: pct(v.taxRate),
  };
}

const waccCalc: Calculator = {
  id: 'wacc',
  category: 'Cost of Capital',
  title: 'WACC · CAPM',
  description:
    'Hurdle rate build-up: CAPM cost of equity blended with the after-tax cost of debt at market-value weights. Push the WACC directly into NPV, Monte Carlo or project comparison.',
  fields: [
    {
      key: 'riskFree',
      label: 'Risk-Free Rate (Rf)',
      kind: 'number',
      default: '4',
      suffix: '%',
      hint: 'e.g. a government bond yield in the cash flows’ currency',
    },
    {
      key: 'betaSource',
      label: 'Beta Source',
      kind: 'select',
      default: 'direct',
      options: [
        { value: 'direct', label: 'Direct input (levered β)' },
        { value: 'hamada', label: 'Hamada: re-lever a peer β to my D/E' },
      ],
    },
    {
      key: 'beta',
      label: 'Levered Beta (β)',
      kind: 'number',
      default: '1.2',
      visible: (v) => v.betaSource !== 'hamada',
    },
    {
      key: 'peerBeta',
      label: 'Peer Levered Beta (βL)',
      kind: 'number',
      default: '1.1',
      visible: (v) => v.betaSource === 'hamada',
    },
    {
      key: 'peerDebtToEquity',
      label: 'Peer D/E',
      kind: 'number',
      default: '0.4',
      visible: (v) => v.betaSource === 'hamada',
    },
    {
      key: 'peerTaxRate',
      label: 'Peer Tax Rate',
      kind: 'number',
      default: '25',
      suffix: '%',
      visible: (v) => v.betaSource === 'hamada',
      hint: 'Target D/E comes from E and D below; target tax from T.',
    },
    {
      key: 'erp',
      label: 'Equity Risk Premium (ERP)',
      kind: 'number',
      default: '5.5',
      suffix: '%',
      engineField: 'marketRiskPremium',
    },
    { key: 'equityValue', label: 'Equity, Market Value (E)', kind: 'number', default: '600000' },
    { key: 'debtValue', label: 'Debt, Market Value (D)', kind: 'number', default: '400000' },
    {
      key: 'costOfDebt',
      label: 'Pre-Tax Cost of Debt (Rd)',
      kind: 'number',
      default: '6',
      suffix: '%',
      engineField: 'preTaxCostOfDebt',
    },
    { key: 'taxRate', label: 'Marginal Tax Rate (T)', kind: 'number', default: '25', suffix: '%' },
  ],
  compute: (v) => {
    const r = waccResult(v);
    if (r.value === null) return { result: r };
    const w = r.value;
    const h = hamadaFor(v)?.value;
    const rate = txt(w.wacc * 100);
    const msg = `Discount rate ${fmtPct(w.wacc)} imported from WACC & CAPM.`;
    return {
      result: r,
      view: {
        outputs: [
          { label: 'WACC', value: fmtPct(w.wacc), primary: true },
          ...(h
            ? [
                { label: 'Unlevered Beta (βU)', value: fmtNum(h.unleveredBeta, 4) },
                {
                  label: 'Re-levered Beta (βL*)',
                  value: fmtNum(h.releveredBeta, 4),
                  sub: `at D/E ${fmtNum(num(v.debtValue) / num(v.equityValue), 3)}`,
                },
              ]
            : []),
          { label: 'Cost of Equity (Re)', value: fmtPct(w.costOfEquity) },
          { label: 'After-Tax Cost of Debt', value: fmtPct(w.afterTaxCostOfDebt) },
          {
            label: 'Capital Weights E / D',
            value: `${fmtPct(w.weightEquity, 1)} / ${fmtPct(w.weightDebt, 1)}`,
          },
        ],
        actions: [
          { label: 'Push to NPV →', target: 'npv', patch: { rate }, message: msg },
          { label: 'Push to Monte Carlo →', target: 'montecarlo', patch: { rate }, message: msg },
          {
            label: 'Push to Project Comparison →',
            target: 'compare',
            patch: { rate },
            message: msg,
          },
        ],
      },
    };
  },
  excel: (v) => {
    const input = waccInputs(v);
    const r = waccResult(v);
    return r.value ? W.waccBook(input, r.value) : null;
  },
};

// --- NPV + sensitivity -----------------------------------------------------------------------

function npvInputs(v: Values) {
  const range = pct(v.sensRange);
  const steps = num(v.sensSteps);
  const shocks =
    Number.isFinite(range) && range > 0 && range < 1 ? E.symmetricShocks(range, steps) : null;
  return {
    rate: pct(v.rate),
    cashFlows: list(v.cashFlows),
    firstPeriod: (str(v.firstPeriod) === '1' ? 1 : 0) as 0 | 1,
    shocks,
  };
}

const builderOn = (v: Values) => v.source === 'builder';
const realOn = (v: Values) => v.basis === 'real';

/**
 * Resolves the discount rate (nominal, or real via Fisher) and the cash flows (typed, or built
 * bottom-up), then runs NPV. Composite steps are folded into one trace (orchestration only:
 * every number comes from an engine function).
 */
function npvModel(v: Values) {
  const i = npvInputs(v);
  const composite = builderOn(v) || realOn(v);
  const t = new E.Trace('cashflow.npv');
  let rate: number | null = i.rate;
  if (realOn(v)) {
    rate = t.include(
      'fisher',
      E.fisherConvert({ rate: i.rate, inflation: pct(v.inflation), from: 'nominal' }),
    );
  }
  let fcf: E.ProjectFcfOutput | null = null;
  let cashFlows = i.cashFlows;
  if (rate !== null && builderOn(v)) {
    fcf = t.include(
      'fcf',
      E.projectFcf({
        years: num(v.fcfYears),
        revenue: num(v.fcfRevenue),
        revenueGrowth: pct(v.fcfGrowth),
        cogsPct: pct(v.fcfCogs),
        ebitdaMargin: pct(v.fcfEbitda),
        daPct: pct(v.fcfDa),
        capexPct: pct(v.fcfCapex),
        taxRate: pct(v.fcfTax),
        dso: num(v.fcfDso),
        dio: num(v.fcfDio),
        dpo: num(v.fcfDpo),
        initialInvestment: num(v.fcfInvestment),
        terminalGrowth: optNum(v.fcfTerminalGrowth) === null ? null : pct(v.fcfTerminalGrowth),
        discountRate: rate,
      }),
    );
    if (fcf) cashFlows = fcf.cashFlows;
  }
  let result: E.Result<E.NpvOutput>;
  if (!composite) result = E.npv({ rate: i.rate, cashFlows, firstPeriod: i.firstPeriod });
  else if (rate === null || (builderOn(v) && !fcf)) result = t.fail();
  else {
    const n = t.include('npv', E.npv({ rate, cashFlows, firstPeriod: i.firstPeriod }));
    result = n === null ? t.fail() : t.ok(n);
  }
  return { ...i, rate: rate ?? Number.NaN, cashFlows, fcf, result };
}

function npvSens(i: {
  rate: number;
  cashFlows: number[];
  firstPeriod: 0 | 1;
  shocks: number[] | null;
}) {
  if (!i.shocks) return null;
  return E.npvSensitivity({
    rate: i.rate,
    cashFlows: i.cashFlows,
    cashFlowShocks: i.shocks,
    rateShocks: i.shocks,
    firstPeriod: i.firstPeriod,
  });
}

const fcfField = (
  key: string,
  label: string,
  def: string,
  suffix?: string,
  hint?: string,
): Field => ({
  key,
  label,
  kind: 'number',
  default: def,
  ...(suffix && { suffix }),
  ...(hint && { hint }),
  visible: builderOn,
});

const npvCalc: Calculator = {
  id: 'npv',
  category: 'Capital Budgeting',
  title: 'NPV & Sensitivity',
  description:
    'Discounted cash flow valuation: type the cash flows or build them bottom-up from operating drivers, choose nominal or real terms, and stress the result on a two-way grid.',
  fields: [
    {
      key: 'rate',
      label: 'Discount Rate, Nominal (r)',
      kind: 'number',
      default: '10',
      suffix: '%',
      hint: 'Build it on the WACC page and push it here in one click',
    },
    {
      key: 'basis',
      label: 'Cash Flow Terms',
      kind: 'select',
      default: 'nominal',
      options: [
        { value: 'nominal', label: 'Nominal (include inflation)' },
        { value: 'real', label: 'Real (today’s money): discount at the real rate' },
      ],
    },
    {
      key: 'inflation',
      label: 'Expected Inflation (π)',
      kind: 'number',
      default: '3',
      suffix: '%',
      visible: realOn,
      hint: '(1 + r nominal) = (1 + r real)(1 + π)',
    },
    {
      key: 'source',
      label: 'Cash Flow Source',
      kind: 'select',
      default: 'direct',
      options: [
        { value: 'direct', label: 'Enter cash flows directly' },
        { value: 'builder', label: 'Build bottom-up (FCF from drivers)' },
      ],
    },
    {
      key: 'firstPeriod',
      label: 'First Cash Flow Timing',
      kind: 'select',
      default: '0',
      options: [
        { value: '0', label: 't = 0 (CFA convention)' },
        { value: '1', label: 't = 1 (Excel NPV convention)' },
      ],
      visible: (v) => !builderOn(v),
    },
    {
      key: 'cashFlows',
      label: 'Cash Flow Series',
      kind: 'numberList',
      default: DEMO_FLOWS,
      visible: (v) => !builderOn(v),
    },
    fcfField('fcfInvestment', 'Initial Investment (t = 0)', '70000'),
    fcfField('fcfYears', 'Forecast Years', '5'),
    fcfField('fcfRevenue', 'Year-1 Revenue', '60000'),
    fcfField('fcfGrowth', 'Revenue Growth', '6', '%'),
    fcfField('fcfCogs', 'COGS % of Revenue', '55', '%', 'Drives inventory and payables'),
    fcfField('fcfEbitda', 'EBITDA Margin', '30', '%'),
    fcfField('fcfDa', 'D&A % of Revenue', '8', '%'),
    fcfField('fcfCapex', 'CapEx % of Revenue', '9', '%'),
    fcfField('fcfTax', 'Tax Rate on EBIT', '25', '%'),
    fcfField('fcfDso', 'DSO (days)', '45'),
    fcfField('fcfDio', 'DIO (days)', '40'),
    fcfField('fcfDpo', 'DPO (days)', '35'),
    fcfField(
      'fcfTerminalGrowth',
      'Terminal Growth (blank = none)',
      '',
      '%',
      'Gordon terminal value added to the final year',
    ),
    {
      key: 'sensRange',
      label: 'Shock Range (±)',
      kind: 'number',
      default: '20',
      suffix: '%',
      engineField: 'cashFlowShocks',
    },
    {
      key: 'sensSteps',
      label: 'Grid Resolution',
      kind: 'select',
      default: '9',
      options: [
        { value: '5', label: '5 × 5' },
        { value: '7', label: '7 × 7' },
        { value: '9', label: '9 × 9' },
        { value: '11', label: '11 × 11' },
      ],
    },
  ],
  compute: (v) => {
    const i = npvModel(v);
    const r = i.result;
    if (r.value === null) return { result: r };
    const irr = E.irr({ cashFlows: i.cashFlows });
    const mirr = E.mirr({ cashFlows: i.cashFlows, financeRate: i.rate, reinvestRate: i.rate });
    const pb =
      i.firstPeriod === 0
        ? E.paybackAnalysis({ rate: i.rate, cashFlows: i.cashFlows }).value
        : null;
    const sens = npvSens(i);
    const real = realOn(v);
    const outputs: Output[] = [
      { label: real ? 'NPV (real terms)' : 'NPV', value: fmtMoney(r.value.npv), primary: true },
    ];
    if (irr.value?.irr != null)
      outputs.push({ label: real ? 'IRR (real)' : 'IRR', value: fmtPct(irr.value.irr) });
    else if (irr.value)
      outputs.push({
        label: 'IRR',
        value: 'several',
        sub: irr.value.roots.map((x) => fmtPct(x, 2)).join(', '),
      });
    if (mirr.value !== null)
      outputs.push({ label: 'MIRR (r = finance = reinvest)', value: fmtPct(mirr.value) });
    if (pb) {
      outputs.push({
        label: 'Profitability Index',
        value: pb.profitabilityIndex === null ? 'n/a' : fmtNum(pb.profitabilityIndex, 3),
        primary: true,
      });
      outputs.push({
        label: 'Payback',
        value: pb.payback === null ? 'not recovered' : `${fmtNum(pb.payback, 2)} periods`,
      });
      outputs.push({
        label: 'Discounted Payback',
        value:
          pb.discountedPayback === null
            ? 'not recovered'
            : `${fmtNum(pb.discountedPayback, 2)} periods`,
      });
    }
    if (real)
      outputs.push({
        label: 'Real Discount Rate',
        value: fmtPct(i.rate, 3),
        sub: `nominal ${fmtPct(pct(v.rate), 2)}, π ${fmtPct(pct(v.inflation), 2)}`,
      });

    const view: Presentation = {
      outputs,
      table: {
        title: 'Cash flow schedule',
        columns: ['Period', 'Cash flow', 'Present value', 'Cumulative PV'],
        numeric: [true, true, true, true],
        rows: i.cashFlows.map((c, k) => [
          String(k),
          fmtMoney(c),
          fmtMoney(r.value!.presentValues[k]!),
          pb ? fmtMoney(pb.cumulativeDiscounted[k]!) : '',
        ]),
      },
      chart: {
        kind: 'npvProfile',
        series: [{ name: 'NPV', cashFlows: i.cashFlows }],
        points: (irr.value?.roots ?? []).map((x) => ({
          rate: x,
          label: `IRR ${fmtPct(x, 2)}`,
          kind: 'root' as const,
        })),
        marker: i.rate,
      },
      actions: [
        {
          label: 'Run Monte Carlo (±20% ranges) →',
          target: 'montecarlo',
          patch: { rate: txt(i.rate * 100), flows: spreadRows(i.cashFlows, 'triangular', 0.2) },
          message:
            'Cash flows imported from NPV as triangular ranges ±20% around each value. Adjust the ranges to your own estimates.',
        },
        {
          label: 'Compare vs. Alternative →',
          target: 'compare',
          patch: { rate: txt(i.rate * 100), projectA: i.cashFlows.map(txt) },
          message: 'Project A and the discount rate were imported from NPV.',
        },
      ],
      tables: i.fcf
        ? [
            {
              title: 'Bottom-up free cash flow build',
              columns: [
                'Year',
                'Revenue',
                'EBITDA',
                'D&A',
                'EBIT',
                'Tax',
                'NOPAT',
                'CapEx',
                'NWC',
                'ΔNWC',
                'FCF',
              ],
              numeric: Array(11).fill(true),
              rows: i.fcf.rows.map((x) =>
                [
                  x.year,
                  x.revenue,
                  x.ebitda,
                  x.depreciation,
                  x.ebit,
                  x.taxes,
                  x.nopat,
                  x.capex,
                  x.nwc,
                  x.deltaNwc,
                  x.fcf,
                ].map((n, k) => (k === 0 ? String(n) : fmtMoney(n))),
              ),
            },
          ]
        : [],
      notes: [
        ...(i.fcf && i.fcf.terminalValue !== 0
          ? [
              `Terminal value ${fmtMoney(i.fcf.terminalValue)} is included in the final-year cash flow.`,
            ]
          : []),
        ...(real
          ? [
              'Real cash flows are discounted at the real rate; the NPV is identical to discounting the inflated (nominal) flows at the nominal rate.',
            ]
          : []),
      ],
    };
    if (sens?.value) {
      const s = sens.value;
      const mid = Math.floor(s.rateShocks.length / 2);
      view.heatmap = {
        title: `NPV sensitivity: ${fmtPct(s.positiveShare, 0)} of scenarios have NPV > 0`,
        rowTitle: 'Future cash flows',
        colTitle: 'Discount rate',
        rowLabels: s.cashFlowShocks.map(signed),
        colLabels: s.rates.map((x, j) => `${fmtPct(x, 2)} (${signed(s.rateShocks[j]!)})`),
        values: s.npv,
        base: [
          s.cashFlowShocks.indexOf(0) >= 0 ? s.cashFlowShocks.indexOf(0) : mid,
          s.rateShocks.indexOf(0) >= 0 ? s.rateShocks.indexOf(0) : mid,
        ],
      };
    } else if (sens) {
      view.notes!.push(
        `Sensitivity grid unavailable: ${sens.errors[0]?.message ?? 'check the range'}`,
      );
    } else {
      view.notes!.push('Set a sensitivity range between 0% and 100% to see the heatmap.');
    }
    return { result: r, view };
  },
  excel: (v) => {
    const i = npvModel(v);
    if (i.result.value === null) return null;
    return W.npvBook({
      rate: i.rate,
      cashFlows: i.cashFlows,
      firstPeriod: i.firstPeriod,
      sensitivity: npvSens(i)?.value ?? null,
    });
  },
};

const irrCalc: Calculator = {
  id: 'irr',
  category: 'Capital Budgeting',
  title: 'Internal Rate of Return',
  description:
    'All roots of NPV(r) = 0. Non-conventional cash flows (multiple sign changes) return every IRR and are flagged; none is silently selected.',
  fields: [
    { key: 'cashFlows', label: 'Cash Flow Series', kind: 'numberList', default: DEMO_FLOWS },
  ],
  compute: (v) => {
    const cashFlows = list(v.cashFlows);
    const r = E.irr({ cashFlows });
    if (r.value === null) return { result: r };
    const { irr, roots } = r.value;
    return {
      result: r,
      view: {
        outputs:
          irr !== null
            ? [{ label: 'IRR', value: fmtPct(irr), primary: true }]
            : roots.map((x, i) => ({ label: `IRR ${i + 1}`, value: fmtPct(x), primary: true })),
        chart: {
          kind: 'npvProfile',
          series: [{ name: 'NPV', cashFlows }],
          points: roots.map((x) => ({ rate: x, label: fmtPct(x, 2), kind: 'root' as const })),
        },
      },
    };
  },
  excel: (v) => {
    const cashFlows = list(v.cashFlows);
    return E.irr({ cashFlows }).value ? W.irrBook(cashFlows) : null;
  },
};

const mirrCalc: Calculator = {
  id: 'mirr',
  category: 'Capital Budgeting',
  title: 'Modified IRR',
  description:
    'IRR with explicit finance and reinvestment rates. Always unique, so it is robust where IRR is ambiguous.',
  fields: [
    { key: 'financeRate', label: 'Finance Rate', kind: 'number', default: '10', suffix: '%' },
    { key: 'reinvestRate', label: 'Reinvestment Rate', kind: 'number', default: '12', suffix: '%' },
    {
      key: 'cashFlows',
      label: 'Cash Flow Series',
      kind: 'numberList',
      default: ['-120000', '39000', '30000', '21000', '37000', '46000'],
    },
  ],
  compute: (v) => {
    const r = E.mirr({
      cashFlows: list(v.cashFlows),
      financeRate: pct(v.financeRate),
      reinvestRate: pct(v.reinvestRate),
    });
    if (r.value === null) return { result: r };
    return {
      result: r,
      view: { outputs: [{ label: 'MIRR', value: fmtPct(r.value), primary: true }] },
    };
  },
  excel: (v) => {
    const args = [list(v.cashFlows), pct(v.financeRate), pct(v.reinvestRate)] as const;
    return E.mirr({ cashFlows: args[0], financeRate: args[1], reinvestRate: args[2] }).value ===
      null
      ? null
      : W.mirrBook(...args);
  },
};

// --- Project comparison ----------------------------------------------------------------------

const compareCalc: Calculator = {
  id: 'compare',
  category: 'Capital Budgeting',
  title: 'Mutually Exclusive Projects',
  description:
    'NPV profiles of two mutually exclusive projects and their Fisher (crossover) rate. Below the crossover, NPV and IRR rankings can conflict; NPV governs.',
  fields: [
    { key: 'rate', label: 'Discount Rate (r)', kind: 'number', default: '5', suffix: '%' },
    {
      key: 'projectA',
      label: 'Project A: Cash Flows',
      kind: 'numberList',
      default: ['-100000', '70000', '40000', '20000', '10000'],
    },
    {
      key: 'projectB',
      label: 'Project B: Cash Flows',
      kind: 'numberList',
      default: ['-100000', '10000', '30000', '50000', '85000'],
    },
  ],
  compute: (v) => {
    const rate = pct(v.rate);
    const a = list(v.projectA);
    const b = list(v.projectB);
    const r = E.compareProjects({ rate, projectA: a, projectB: b });
    if (r.value === null) return { result: r };
    const o = r.value;
    const irrTxt = (x: number | null) => (x === null ? 'n/a' : fmtPct(x));
    const outputs: Output[] = [
      { label: 'NPV A', value: fmtMoney(o.npvA), primary: o.choiceByNpv === 'A' },
      { label: 'NPV B', value: fmtMoney(o.npvB), primary: o.choiceByNpv === 'B' },
      { label: 'IRR A', value: irrTxt(o.irrA) },
      { label: 'IRR B', value: irrTxt(o.irrB) },
    ];
    if (o.crossoverRates.length === 0)
      outputs.push({
        label: 'Fisher (Crossover) Rate',
        value: 'none',
        sub: 'profiles never cross',
      });
    o.crossoverRates.forEach((x, k) =>
      outputs.push({
        label: o.crossoverRates.length > 1 ? `Fisher rate ${k + 1}` : 'Fisher rate',
        value: fmtPct(x),
        primary: true,
      }),
    );

    const notes: string[] = [];
    const fisher = o.crossoverRates[0];
    if (fisher !== undefined && o.crossoverRates.length === 1) {
      const low = E.npvRaw(fisher - 0.01, a) > E.npvRaw(fisher - 0.01, b) ? 'A' : 'B';
      const high = low === 'A' ? 'B' : 'A';
      notes.push(
        `Below ${fmtPct(fisher, 2)} project ${low} has the higher NPV; above it, project ${high} does.`,
      );
    }
    notes.push(
      o.conflict
        ? `At ${fmtPct(rate, 2)}, NPV picks ${o.choiceByNpv} while IRR picks ${o.choiceByIrr}. IRR ranks by percentage return and implicitly reinvests interim cash at the IRR itself (and ignores differences in project size); NPV measures the value created at your cost of capital, so choose ${o.choiceByNpv}.`
        : `At ${fmtPct(rate, 2)}, NPV and IRR agree${o.choiceByNpv === 'A' || o.choiceByNpv === 'B' ? ` on project ${o.choiceByNpv}` : ''}.`,
    );

    const grid = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3];
    return {
      result: r,
      view: {
        outputs,
        notes,
        chart: {
          kind: 'npvProfile',
          series: [
            { name: 'Project A', cashFlows: a },
            { name: 'Project B', cashFlows: b },
          ],
          points: o.crossoverRates.map((x) => ({
            rate: x,
            label: `Fisher ${fmtPct(x, 2)}`,
            kind: 'cross' as const,
          })),
          marker: rate,
        },
        table: {
          title: 'NPV by Discount Rate',
          columns: ['Discount rate', 'NPV A', 'NPV B', 'Higher NPV'],
          numeric: [true, true, true, false],
          rows: grid.map((g) => {
            const x = E.npvRaw(g, a);
            const y = E.npvRaw(g, b);
            return [
              fmtPct(g, 0),
              fmtMoney(x),
              fmtMoney(y),
              Math.abs(x - y) < 1e-9 ? 'tie' : x > y ? 'A' : 'B',
            ];
          }),
        },
      },
    };
  },
  excel: (v) => {
    const rate = pct(v.rate);
    const a = list(v.projectA);
    const b = list(v.projectB);
    const r = E.compareProjects({ rate, projectA: a, projectB: b });
    return r.value ? W.compareBook(rate, a, b, r.value) : null;
  },
};

// --- Monte Carlo -----------------------------------------------------------------------------

function mcInputs(v: Values) {
  const rate = pct(v.rate);
  const rateSd = pct(v.rateSd);
  const rateDist: E.Distribution =
    rateSd > 0 ? { type: 'normal', mean: rate, sd: rateSd } : { type: 'fixed', value: rate };
  const flows = Array.isArray(v.flows) ? (v.flows as DistRow[]).map(toDistribution) : [];
  return { rateDist, flows, iterations: num(v.iterations), seed: num(v.seed) };
}

const mcCalc: Calculator = {
  id: 'montecarlo',
  category: 'Risk Analytics',
  title: 'Monte Carlo NPV',
  description:
    'Stochastic NPV: assign a distribution to each cash flow and simulate. Headline output: probability of value creation, P(NPV > 0), with its confidence interval.',
  fields: [
    {
      key: 'rate',
      label: 'Discount Rate, Expected E[r]',
      kind: 'number',
      default: '10',
      suffix: '%',
    },
    {
      key: 'rateSd',
      label: 'Rate Volatility (σ)',
      kind: 'number',
      default: '0',
      suffix: '%',
      hint: '0 = fixed rate. 1.5 means the rate is normally distributed with a 1.5 point SD.',
    },
    {
      key: 'iterations',
      label: 'Iterations',
      kind: 'select',
      default: '10000',
      options: ['1000', '10000', '50000', '100000'].map((x) => ({
        value: x,
        label: Number(x).toLocaleString('en-US'),
      })),
    },
    {
      key: 'seed',
      label: 'PRNG Seed',
      kind: 'number',
      default: '42',
      hint: 'Same seed + same inputs = exactly the same result',
    },
    {
      key: 'flows',
      label: 'Cash Flow Distributions',
      kind: 'distFlows',
      engineField: 'cashFlows',
      default: [
        { type: 'fixed', a: '-100000', b: '', c: '' },
        { type: 'triangular', a: '15000', b: '25000', c: '35000' },
        { type: 'normal', a: '30000', b: '8000', c: '' },
        { type: 'triangular', a: '20000', b: '32000', c: '40000' },
        { type: 'normal', a: '35000', b: '10000', c: '' },
        { type: 'uniform', a: '10000', b: '30000', c: '' },
      ],
    },
  ],
  compute: (v) => {
    const i = mcInputs(v);
    const r = E.monteCarloNpv({
      rate: i.rateDist,
      cashFlows: i.flows,
      iterations: i.iterations,
      seed: i.seed,
    });
    if (r.value === null) return { result: r };
    const m = r.value;
    const p5 = m.percentiles.find((x) => x.p === 0.05)!.value;
    const p95 = m.percentiles.find((x) => x.p === 0.95)!.value;
    return {
      result: r,
      view: {
        outputs: [
          {
            label: 'P(NPV > 0)',
            value: fmtPct(m.probabilityPositive, 1),
            primary: true,
            sub: `± ${fmtPct(1.96 * m.probabilityStdError, 1)} (95% CI)`,
          },
          { label: 'E[NPV]', value: fmtMoney(m.mean) },
          { label: 'σ(NPV)', value: fmtMoney(m.sd) },
          { label: '90% Interval (P5–P95)', value: `${fmtMoney(p5)} to ${fmtMoney(p95)}` },
        ],
        notes: [
          `In ${fmtPct(m.probabilityPositive, 1)} of ${m.iterations.toLocaleString('en-US')} simulated scenarios the project's NPV is positive. With every input at its expected value the NPV is ${fmtMoney(m.npvAtMeans)}.`,
        ],
        histogram: { bins: m.histogram, mean: m.mean, p5, p95 },
        table: {
          title: 'NPV Percentile Distribution',
          columns: ['Percentile', 'NPV'],
          numeric: [false, true],
          rows: m.percentiles.map((x) => [`P${Math.round(x.p * 100)}`, fmtMoney(x.value)]),
        },
      },
    };
  },
  excel: (v) => {
    const i = mcInputs(v);
    const r = E.monteCarloNpv({
      rate: i.rateDist,
      cashFlows: i.flows,
      iterations: i.iterations,
      seed: i.seed,
    });
    return r.value ? W.monteCarloBook(i.rateDist, i.flows, r.value) : null;
  },
};

// --- Dated flows, loans, dates ---------------------------------------------------------------

const xirrCalc: Calculator = {
  id: 'xirr',
  category: 'Capital Budgeting',
  title: 'XNPV · XIRR',
  description:
    'NPV and IRR for irregularly dated cash flows on an ACT/365F basis from the first date (Excel parity).',
  fields: [
    {
      key: 'rate',
      label: 'Discount Rate, Annual (XNPV)',
      kind: 'number',
      default: '9',
      suffix: '%',
    },
    {
      key: 'flows',
      label: 'Dated Cash Flows',
      kind: 'datedFlows',
      default: [
        { date: '2008-01-01', amount: '-10000' },
        { date: '2008-03-01', amount: '2750' },
        { date: '2008-10-30', amount: '4250' },
        { date: '2009-02-15', amount: '3250' },
        { date: '2009-04-01', amount: '2750' },
      ],
    },
  ],
  compute: (v) => {
    const flows = dated(v.flows);
    const x = E.xnpv({ rate: pct(v.rate), flows });
    if (x.value === null) return { result: x };
    const i = E.xirr({ flows });
    const outputs: Output[] = [{ label: 'XNPV', value: fmtMoney(x.value), primary: true }];
    if (i.value?.xirr != null)
      outputs.push({ label: 'XIRR', value: fmtPct(i.value.xirr), primary: true });
    else if (i.value)
      i.value.roots.forEach((r, k) => outputs.push({ label: `XIRR ${k + 1}`, value: fmtPct(r) }));
    else outputs.push({ label: 'XIRR', value: 'n/a', sub: i.errors[0]?.message ?? '' });
    return { result: x, view: { outputs } };
  },
  excel: (v) => {
    const flows = dated(v.flows);
    return E.xnpv({ rate: pct(v.rate), flows }).value === null
      ? null
      : W.xirrBook(pct(v.rate), flows);
  },
};

function amortInputs(v: Values): E.AmortizationInput {
  return {
    // Canonical decimal text keeps the principal exact for decimal arithmetic.
    principal: readNumber(str(v.principal))?.canonical ?? 'x',
    annualRate: pct(v.annualRate),
    periodsPerYear: num(v.periodsPerYear),
    nper: num(v.nper),
    currency: str(v.currency) as E.CurrencyCode,
  };
}

const amort: Calculator = {
  id: 'amortization',
  category: 'Credit & Lending',
  title: 'Amortization Schedule',
  description:
    'Level-payment schedule in exact decimal arithmetic. Interest rounds to the currency minor unit each period; the final payment absorbs rounding so the balance closes at exactly zero.',
  fields: [
    { key: 'principal', label: 'Principal', kind: 'number', default: '250000' },
    {
      key: 'currency',
      label: 'Currency',
      kind: 'select',
      default: 'TRY',
      options: Object.keys(E.CURRENCY_MINOR_UNITS).map((c) => ({ value: c, label: c })),
    },
    {
      key: 'annualRate',
      label: 'Annual Rate (APR)',
      kind: 'number',
      default: '36',
      suffix: '%',
    },
    { key: 'periodsPerYear', label: 'Payments / Yr', kind: 'number', default: '12' },
    { key: 'nper', label: 'Term (Payments)', kind: 'number', default: '24' },
  ],
  compute: (v) => {
    const r = E.amortizationSchedule(amortInputs(v));
    if (r.value === null) return { result: r };
    const a = r.value;
    const c = a.currency;
    const m = (s: string) => fmtMoney(Number(s));
    return {
      result: r,
      view: {
        outputs: [
          { label: `Payment (${c})`, value: m(a.payment), primary: true },
          { label: `Total interest (${c})`, value: m(a.totalInterest) },
          { label: `Total paid (${c})`, value: m(a.totalPaid) },
        ],
        table: {
          columns: ['#', 'Opening', 'Payment', 'Interest', 'Principal', 'Closing'],
          numeric: [true, true, true, true, true, true],
          rows: a.rows.map((row) => [
            String(row.period),
            m(row.openingBalance),
            m(row.payment),
            m(row.interest),
            m(row.principal),
            m(row.closingBalance),
          ]),
        },
      },
    };
  },
  excel: (v) => {
    const input = amortInputs(v);
    const r = E.amortizationSchedule(input);
    return r.value ? W.amortizationBook(input, r.value) : null;
  },
};

const dayCount: Calculator = {
  id: 'daycount',
  category: 'Fixed Income',
  title: 'Day Count Conventions',
  description:
    'Year fraction between two dates under each market day count basis: the input to accrued interest.',
  fields: [
    { key: 'start', label: 'Start Date', kind: 'date', default: '2024-02-29' },
    { key: 'end', label: 'End Date', kind: 'date', default: '2025-03-31' },
    {
      key: 'dayCount',
      label: 'Day Count Basis',
      kind: 'select',
      default: 'ACT/ACT-ISDA',
      options: E.DAY_COUNTS.map((d) => ({ value: d, label: d })),
    },
  ],
  compute: (v) => {
    const start = str(v.start);
    const end = str(v.end);
    const r = E.yearFraction({ start, end, dayCount: str(v.dayCount) as E.DayCount });
    if (r.value === null) return { result: r };
    return {
      result: r,
      view: {
        outputs: [
          { label: 'Year Fraction', value: fmtNum(r.value.yearFraction, 8), primary: true },
          { label: 'Days', value: String(r.value.days) },
        ],
        table: {
          title: 'Convention Matrix',
          columns: ['Convention', 'Days', 'Year fraction'],
          numeric: [false, true, true],
          rows: E.DAY_COUNTS.map((dc) => {
            const x = E.yearFraction({ start, end, dayCount: dc }).value!;
            return [dc, String(x.days), fmtNum(x.yearFraction, 8)];
          }),
        },
      },
    };
  },
  excel: (v) =>
    E.yearFraction({ start: str(v.start), end: str(v.end), dayCount: 'ACT/360' }).value
      ? W.dayCountBook(str(v.start), str(v.end))
      : null,
};

// --- Financial statement analysis --------------------------------------------------------------

/** Example company (thousands), three years that each balance. Built to show a deteriorating story. */
const EXAMPLE_STATEMENTS: StatementGrid = {
  periods: ['FY2023', 'FY2024', 'FY2025'],
  values: {
    cash: ['120', '90', '60'],
    shortTermInvestments: ['30', '20', '10'],
    receivables: ['380', '470', '610'],
    inventory: ['420', '500', '590'],
    otherCurrentAssets: ['50', '60', '60'],
    nonCurrentAssets: ['1500', '1560', '1620'],
    payables: ['300', '330', '360'],
    shortTermDebt: ['150', '200', '290'],
    otherCurrentLiabilities: ['100', '110', '120'],
    longTermDebt: ['700', '760', '850'],
    otherNonCurrentLiabilities: ['50', '50', '60'],
    equity: ['1200', '1250', '1270'],
    retainedEarnings: ['800', '850', '870'],
    revenue: ['3000', '3200', '3300'],
    cogs: ['1950', '2140', '2300'],
    operatingExpenses: ['600', '640', '680'],
    depreciation: ['120', '130', '140'],
    interestExpense: ['55', '65', '85'],
    otherIncome: ['5', '5', '5'],
    taxExpense: ['70', '57.5', '25'],
    principalRepayment: ['100', '110', '130'],
    operatingCashFlow: ['260', '150', '40'],
    marketCap: ['1800', '1600', '1200'],
  },
};

/** Generic textbook heuristics, clearly not industry data. */
const RULES_OF_THUMB: Partial<Record<E.RatioId, number>> = {
  currentRatio: 1.5,
  quickRatio: 1.0,
  interestCoverage: 3,
  dscr: 1.25,
  debtToEquity: 1.0,
};

const FIXED2 = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const FIXED1 = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export function fmtRatio(v: number | null | undefined, unit: E.RatioUnit): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return 'n/a';
  switch (unit) {
    case 'x':
      return `${FIXED2.format(v)}×`;
    case 'pct':
      return fmtPct(v, 2);
    case 'days':
      return `${FIXED1.format(v)} d`;
    case 'money':
      return fmtMoney(v);
  }
}

/** Benchmark as typed (%, days, ×) → engine units. */
const benchmarkValue = (id: E.RatioId, raw: string | undefined) => {
  const x = num(raw);
  if (!Number.isFinite(x)) return undefined;
  return E.ratioMeta(id).unit === 'pct' ? x / 100 : x;
};

function statementInputs(v: Values): E.StatementAnalysisInput {
  const g = (v.statements as StatementGrid | undefined) ?? EXAMPLE_STATEMENTS;
  const periods: E.StatementPeriod[] = g.periods.map((label, p) => {
    const row = { label } as E.StatementPeriod;
    for (const it of E.STATEMENT_ITEMS) {
      const raw = g.values[it.key]?.[p] ?? '';
      row[it.key] = raw.trim() === '' ? null : num(raw);
    }
    return row;
  });
  const preset = str(v.benchmarkPreset);
  let benchmarks: Partial<Record<E.RatioId, number>> | undefined;
  if (preset === 'rules') benchmarks = RULES_OF_THUMB;
  else if (preset === 'custom') {
    const raw = (v.benchmarks as BenchmarkValues | undefined) ?? {};
    benchmarks = {};
    for (const id of E.RATIO_IDS) {
      const x = benchmarkValue(id, raw[id]);
      if (x !== undefined) benchmarks[id] = x;
    }
  }
  const tax = pct(v.statutoryTaxRate);
  return {
    periods,
    daysInYear: str(v.daysInYear) === '360' ? 360 : 365,
    altmanModel: (str(v.altmanModel) || 'private') as E.AltmanModel,
    ...(Number.isFinite(tax) && { statutoryTaxRate: tax }),
    ...(benchmarks && { benchmarks }),
    whatIf: { deltaDso: num(v.deltaDso), deltaDio: num(v.deltaDio), deltaDpo: num(v.deltaDpo) },
    covenants: { minDscr: optNum(v.covenantDscr), minInterestCoverage: optNum(v.covenantTie) },
  };
}

const CATEGORY_TITLE: Record<E.RatioCategory, string> = {
  liquidity: 'Liquidity',
  activity: 'Activity & efficiency',
  leverage: 'Leverage & coverage',
  profitability: 'Profitability',
};

const statementsCalc: Calculator = {
  id: 'statements',
  category: 'Financial Statement Analysis',
  title: 'Ratio Analysis · DuPont · Altman Z',
  description:
    'Single input, full credit and performance read: 20 ratios, 3- and 5-step DuPont, Altman Z, rule-based red flags and a working-capital release model from 1–3 fiscal years.',
  layout: 'wide',
  fields: [
    {
      key: 'statements',
      label: 'Financial Statements (oldest → newest)',
      kind: 'statementGrid',
      maxPeriods: 3,
      default: EXAMPLE_STATEMENTS,
      engineField: 'periods',
      hint: 'Expenses as positive amounts. Paste from Excel with English or Turkish row labels; negative-expense layouts are converted.',
    },
    {
      key: 'altmanModel',
      label: 'Altman Z Specification',
      kind: 'select',
      default: 'private',
      options: (Object.keys(E.ALTMAN_MODELS) as E.AltmanModel[]).map((k) => ({
        value: k,
        label: E.ALTMAN_MODELS[k].label,
      })),
    },
    {
      key: 'daysInYear',
      label: 'Day Basis',
      kind: 'select',
      default: '365',
      options: [
        { value: '365', label: '365' },
        { value: '360', label: '360' },
      ],
    },
    {
      key: 'statutoryTaxRate',
      label: 'Statutory Tax Rate',
      kind: 'number',
      default: '25',
      suffix: '%',
      hint: 'Used for ROIC when profit before tax is zero or negative',
    },
    {
      key: 'benchmarkPreset',
      label: 'Peer Benchmark',
      kind: 'select',
      default: 'rules',
      options: [
        { value: 'none', label: 'None' },
        { value: 'rules', label: 'Rules of Thumb (generic, not peer data)' },
        { value: 'custom', label: 'Custom (my sector data)' },
      ],
    },
    {
      key: 'benchmarks',
      label: 'Custom Benchmarks',
      kind: 'benchmarks',
      default: {},
      visible: (v) => v.benchmarkPreset === 'custom',
      hint: 'Enter your source’s figures (e.g. a sector median). Percent ratios in %, days in days.',
    },
    {
      key: 'covenantDscr',
      label: 'Covenant: Min DSCR (×)',
      kind: 'number',
      default: '1.25',
      hint: 'Blank = no covenant. A breach raises a critical red flag.',
    },
    {
      key: 'covenantTie',
      label: 'Covenant: Min Interest Coverage (×)',
      kind: 'number',
      default: '2.5',
      hint: 'Blank = no covenant.',
    },
    {
      key: 'deltaDso',
      label: 'Δ DSO (Receivables)',
      kind: 'slider',
      min: -60,
      max: 60,
      step: 1,
      default: '-10',
      suffix: ' days',
      placement: 'view',
    },
    {
      key: 'deltaDio',
      label: 'Δ DIO (Inventory)',
      kind: 'slider',
      min: -60,
      max: 60,
      step: 1,
      default: '-10',
      suffix: ' days',
      placement: 'view',
    },
    {
      key: 'deltaDpo',
      label: 'Δ DPO (Payables)',
      kind: 'slider',
      min: -60,
      max: 60,
      step: 1,
      default: '5',
      suffix: ' days',
      placement: 'view',
    },
  ],
  compute: (v) => {
    const input = statementInputs(v);
    const r = E.analyzeStatements(input);
    if (r.value === null) return { result: r };
    const a = r.value;
    const last = a.periods.length - 1;
    const prev = last - 1;
    const get = (id: E.RatioId) => a.ratios.find((x) => x.id === id)!;
    const kpi = (id: E.RatioId, primary = false): Output => {
      const row = get(id);
      const cur = row.values[last];
      const out: Output = { label: row.label, value: fmtRatio(cur, row.unit), primary };
      if (prev >= 0) {
        const p = row.values[prev];
        if (p !== null && p !== undefined) out.sub = `${a.periods[prev]}: ${fmtRatio(p, row.unit)}`;
      }
      return out;
    };
    const z = a.altman[last]!;
    const am = E.ALTMAN_MODELS[z.model];
    const w = a.whatIf;

    const outputs: Output[] = [
      kpi('currentRatio'),
      kpi('debtToEquity'),
      kpi('interestCoverage'),
      kpi('roe', true),
      kpi('ccc'),
      {
        label: `Altman Z (${a.periods[last]})`,
        value: z.score === null ? 'n/a' : fmtNum(z.score, 2),
        sub: z.zone ? `${z.zone} zone` : 'needs market value of equity',
        primary: true,
      },
    ];
    if (w) {
      outputs.push({
        label: 'Working Capital Release',
        value: fmtMoney(w.totalCashReleased),
        primary: true,
        ...(w.newCcc !== null &&
          w.currentCcc !== null && {
            sub: `CCC ${fmtNum(w.currentCcc, 1)} → ${fmtNum(w.newCcc, 1)} days`,
          }),
      });
    }

    const tone = (s: E.RatioRow['status']) =>
      s === 'better' ? 'good' : s === 'worse' ? 'bad' : s === 'inline' ? 'neutral' : null;
    const statusText = (s: E.RatioRow['status']) =>
      s === 'better' ? '▲ better' : s === 'worse' ? '▼ worse' : s === 'inline' ? '≈ in line' : '';
    const hasBench = a.ratios.some((x) => x.benchmark !== null);
    // Periods whose balance sheet does not tie (flagged by the engine): every ratio that uses
    // balance-sheet totals for them is unreliable, so their columns are marked.
    const oob = new Set(
      a.diagnostics.filter((d) => d.code === 'BALANCE_SHEET_MISMATCH').map((d) => d.period),
    );
    const periodHead = (p: string) => (oob.has(p) ? `${p} ⚠` : p);
    const oobNote =
      oob.size > 0
        ? `⚠ ${[...oob].join(', ')}: balance sheet out of balance. Ratios using balance-sheet totals for ${oob.size > 1 ? 'these periods' : 'this period'} are unreliable until the variance is resolved.`
        : undefined;
    const tables: TableSpec[] = (Object.keys(CATEGORY_TITLE) as E.RatioCategory[]).map((cat) => {
      const rows = a.ratios.filter((x) => x.category === cat);
      return {
        title: CATEGORY_TITLE[cat],
        columns: [
          'Ratio',
          ...a.periods.map(periodHead),
          ...(hasBench ? ['Benchmark', `vs benchmark (${a.periods[last]})`] : []),
        ],
        numeric: [false, ...a.periods.map(() => true), ...(hasBench ? [true, false] : [])],
        rows: rows.map((x) => [
          x.label,
          ...x.values.map((y) => fmtRatio(y, x.unit)),
          ...(hasBench
            ? [x.benchmark === null ? '' : fmtRatio(x.benchmark, x.unit), statusText(x.status)]
            : []),
        ]),
        tones: rows.map((x) =>
          hasBench ? [null, ...a.periods.map(() => null), null, tone(x.status)] : null,
        ),
        ...(oobNote && { note: oobNote }),
      };
    });
    tables.push({
      title: 'Derived Line Items',
      columns: ['Line', ...a.periods.map(periodHead)],
      numeric: [false, ...a.periods.map(() => true)],
      rows: (
        [
          ['Current assets', 'currentAssets'],
          ['Total assets', 'totalAssets'],
          ['Current liabilities', 'currentLiabilities'],
          ['Total liabilities', 'totalLiabilities'],
          ['Total debt', 'totalDebt'],
          ['Balance check (assets − L&E)', 'balanceDifference'],
          ['Gross profit', 'grossProfit'],
          ['EBITDA', 'ebitda'],
          ['EBIT', 'ebit'],
          ['Profit before tax', 'ebt'],
          ['Net income', 'netIncome'],
        ] as const
      )
        .map(([label, key]) => [label, ...a.derived.map((d) => fmtMoney(d[key]))])
        .concat([
          [
            'Effective tax rate (tax / EBT)',
            ...a.derived.map((d) =>
              d.effectiveTaxRate === null ? 'n/a' : fmtPct(d.effectiveTaxRate, 2),
            ),
          ],
        ]),
    });
    // Effective tax rate bridge: latest meaningful historical rate, pushable into WACC.
    const etrIdx = a.derived.reduce(
      (acc, d, k) =>
        d.effectiveTaxRate !== null && d.effectiveTaxRate >= 0 && d.effectiveTaxRate < 1 ? k : acc,
      -1,
    );
    const etr = etrIdx >= 0 ? a.derived[etrIdx]!.effectiveTaxRate : null;
    const etrPeriod = etrIdx >= 0 ? a.periods[etrIdx] : null;
    if (etr !== null)
      outputs.push({
        label: 'Effective Tax Rate',
        value: fmtPct(etr, 2),
        sub: `${etrPeriod} · tax / EBT`,
      });
    if (w) {
      tables.push({
        title: `Working-capital what-if (${a.periods[last]})`,
        columns: ['Lever', 'Change', 'Cash effect'],
        numeric: [false, true, true],
        rows: [
          [
            'Collect receivables faster (DSO)',
            `${num(v.deltaDso)} days`,
            fmtMoney(w.cashFromReceivables),
          ],
          ['Hold less inventory (DIO)', `${num(v.deltaDio)} days`, fmtMoney(w.cashFromInventory)],
          ['Pay suppliers later (DPO)', `${num(v.deltaDpo)} days`, fmtMoney(w.cashFromPayables)],
          ['Total one-off cash released', '', fmtMoney(w.totalCashReleased)],
        ],
      });
    }

    return {
      result: r,
      view: {
        outputs,
        diagnostics: a.diagnostics,
        dupont: { periods: a.periods, rows: a.dupont },
        actions:
          etr === null
            ? []
            : [
                {
                  label: 'Push Tax Rate to WACC →',
                  target: 'wacc',
                  patch: { taxRate: txt(etr * 100) },
                  message: `Tax rate ${fmtPct(etr, 2)} (${etrPeriod} effective rate) imported from Financial Statement Analysis.`,
                },
              ],
        zscore: {
          periods: a.periods,
          altman: a.altman,
          distress: am.distress,
          safe: am.safe,
          modelLabel: am.label,
        },
        tables,
        alerts:
          oob.size > 0
            ? [
                {
                  title: 'Out of Balance',
                  message:
                    'Total assets do not equal total liabilities plus equity. Correct the statements before relying on any ratio.',
                  items: a.periods.flatMap((p, i) => {
                    if (!oob.has(p)) return [];
                    const d = a.derived[i]!;
                    return [
                      `${p}: assets ${fmtMoney(d.totalAssets)} vs liabilities + equity ${fmtMoney(d.liabilitiesAndEquity)}, variance ${fmtMoney(d.balanceDifference)}`,
                    ];
                  }),
                },
              ]
            : [],
        sections: [
          {
            id: 'overview',
            label: 'Overview & Red Flags',
            include: ['outputs', 'notes', 'actions', 'diagnostics'],
          },
          {
            id: 'ratios',
            label: 'Ratios & Benchmarks',
            include: ['notes', 'tables'],
            tables: [...Object.values(CATEGORY_TITLE), 'Derived Line Items'],
          },
          { id: 'dupont', label: 'DuPont & Altman Z', include: ['dupont', 'zscore'] },
          {
            id: 'wc',
            label: 'Working Capital Simulator',
            include: ['outputs', 'tables'],
            outputs: ['Working Capital Release', 'Cash conversion cycle (CCC)'],
            tables: ['Working-capital what-if'],
            fields: ['deltaDso', 'deltaDio', 'deltaDpo'],
          },
        ],
        notes:
          str(v.benchmarkPreset) === 'rules'
            ? [
                'Benchmarks are generic rules of thumb from finance textbooks, not your industry’s figures. Choose “Custom” to enter sector data from your own source.',
              ]
            : [],
      },
    };
  },
  excel: (v) => {
    const input = statementInputs(v);
    const r = E.analyzeStatements(input);
    return r.value ? SB.statementsBook(input, r.value) : null;
  },
};

/** Sidebar order: groups appear in the order their first calculator does. */
export const CALCULATORS: Calculator[] = [
  statementsCalc,
  waccCalc,
  leverageCalc,
  ebitEpsCalc,
  npvCalc,
  irrCalc,
  mirrCalc,
  compareCalc,
  xirrCalc,
  mcCalc,
  eoqCalc,
  cashCalc,
  bondCalc,
  dayCount,
  ddmCalc,
  dcfCalc,
  portfolioCalc,
  varCalc,
  tvm,
  amort,
];

export function defaults(c: Calculator): Values {
  return Object.fromEntries(c.fields.map((f) => [f.key, structuredClone(f.default)]));
}
