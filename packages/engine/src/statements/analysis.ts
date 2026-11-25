import { Trace, type Result } from '../core/result.js';

/**
 * Financial statement analysis: ratios, DuPont, Altman Z-score, red flags and a working-capital
 * what-if, all from one multi-period set of balance sheet and income statement items.
 *
 * Conventions (CFA): flow / stock ratios (turnover, days, returns) use the AVERAGE of the opening
 * and closing balance when the prior period is available, otherwise the ending balance; the
 * basis used is reported per period. Balance-sheet ratios use ending balances.
 */

// --- inputs ----------------------------------------------------------------------------------

export const STATEMENT_ITEMS = [
  // Balance sheet: assets
  { key: 'cash', label: 'Cash and equivalents', section: 'assets' },
  { key: 'shortTermInvestments', label: 'Short-term investments', section: 'assets' },
  { key: 'receivables', label: 'Accounts receivable', section: 'assets' },
  { key: 'inventory', label: 'Inventory', section: 'assets' },
  { key: 'otherCurrentAssets', label: 'Other current assets', section: 'assets' },
  { key: 'nonCurrentAssets', label: 'Non-current assets', section: 'assets' },
  // Balance sheet: liabilities and equity
  { key: 'payables', label: 'Accounts payable', section: 'liabilities' },
  { key: 'shortTermDebt', label: 'Short-term debt (incl. current LTD)', section: 'liabilities' },
  { key: 'otherCurrentLiabilities', label: 'Other current liabilities', section: 'liabilities' },
  { key: 'longTermDebt', label: 'Long-term debt', section: 'liabilities' },
  {
    key: 'otherNonCurrentLiabilities',
    label: 'Other non-current liabilities',
    section: 'liabilities',
  },
  { key: 'equity', label: 'Total equity', section: 'liabilities' },
  { key: 'retainedEarnings', label: 'Retained earnings (part of equity)', section: 'liabilities' },
  // Income statement
  { key: 'revenue', label: 'Revenue', section: 'income' },
  { key: 'cogs', label: 'Cost of goods sold', section: 'income' },
  { key: 'operatingExpenses', label: 'Operating expenses (excl. D&A)', section: 'income' },
  { key: 'depreciation', label: 'Depreciation & amortisation', section: 'income' },
  { key: 'interestExpense', label: 'Interest expense', section: 'income' },
  { key: 'otherIncome', label: 'Other non-operating income (net)', section: 'income' },
  { key: 'taxExpense', label: 'Income tax expense', section: 'income' },
  // Other
  { key: 'principalRepayment', label: 'Scheduled principal repayment', section: 'other' },
  { key: 'operatingCashFlow', label: 'Cash flow from operations (optional)', section: 'other' },
  { key: 'marketCap', label: 'Market value of equity (optional)', section: 'other' },
] as const;

export type StatementItemKey = (typeof STATEMENT_ITEMS)[number]['key'];
export type StatementSection = (typeof STATEMENT_ITEMS)[number]['section'];

const OPTIONAL_ITEMS: readonly StatementItemKey[] = ['operatingCashFlow', 'marketCap'];
/** Items that may legitimately be negative. */
const SIGNED_ITEMS: readonly StatementItemKey[] = [
  'equity',
  'retainedEarnings',
  'otherIncome',
  'taxExpense',
  'operatingCashFlow',
];

export type StatementPeriod = { label: string } & Record<StatementItemKey, number | null>;

export type AltmanModel = 'public' | 'private' | 'nonManufacturing';

export type RatioId =
  | 'currentRatio'
  | 'quickRatio'
  | 'cashRatio'
  | 'netWorkingCapital'
  | 'inventoryTurnover'
  | 'dio'
  | 'dso'
  | 'dpo'
  | 'assetTurnover'
  | 'ccc'
  | 'debtToAssets'
  | 'debtToEquity'
  | 'interestCoverage'
  | 'dscr'
  | 'grossMargin'
  | 'ebitdaMargin'
  | 'netMargin'
  | 'roa'
  | 'roe'
  | 'roic';

export interface StatementAnalysisInput {
  /** Oldest first; 1 to 3 periods. */
  periods: StatementPeriod[];
  /** Day-count basis for DIO / DSO / DPO. Default 365. */
  daysInYear?: 365 | 360;
  altmanModel?: AltmanModel;
  /** Used for ROIC's NOPAT when the effective tax rate is not meaningful (EBT ≤ 0). */
  statutoryTaxRate?: number;
  /** Optional targets, compared with the latest period. */
  benchmarks?: Partial<Record<RatioId, number>>;
  /** Working-capital what-if on the latest period, in days (negative = faster). */
  whatIf?: { deltaDso: number; deltaDio: number; deltaDpo: number };
  /** Loan covenant minimums; a breach raises a critical red flag. */
  covenants?: { minDscr?: number | null; minInterestCoverage?: number | null };
}

// --- outputs ---------------------------------------------------------------------------------

export interface DerivedLines {
  currentAssets: number;
  totalAssets: number;
  currentLiabilities: number;
  totalLiabilities: number;
  totalDebt: number;
  liabilitiesAndEquity: number;
  balanceDifference: number;
  grossProfit: number;
  ebitda: number;
  ebit: number;
  ebt: number;
  netIncome: number;
  /** Historical effective tax rate = tax / EBT (null when EBT ≤ 0). Full precision. */
  effectiveTaxRate: number | null;
  /** Effective tax rate used for NOPAT (null when not meaningful and no statutory rate). */
  taxRateUsed: number | null;
}

export type RatioCategory = 'liquidity' | 'activity' | 'leverage' | 'profitability';
export type RatioUnit = 'x' | 'pct' | 'days' | 'money';

export interface RatioRow {
  id: RatioId;
  label: string;
  category: RatioCategory;
  unit: RatioUnit;
  formula: string;
  /** Which direction is healthier. */
  better: 'higher' | 'lower' | 'neutral';
  values: (number | null)[];
  benchmark: number | null;
  /** Latest period vs benchmark. */
  status: 'better' | 'inline' | 'worse' | null;
}

export interface DupontPeriod {
  netMargin: number | null;
  assetTurnover: number | null;
  equityMultiplier: number | null;
  taxBurden: number | null;
  interestBurden: number | null;
  ebitMargin: number | null;
  roe: number | null;
}

export interface AltmanPeriod {
  model: AltmanModel;
  score: number | null;
  zone: 'safe' | 'grey' | 'distress' | null;
  /** X1…X5 (X5 absent in the non-manufacturing model). */
  components: { id: string; label: string; value: number | null; weight: number }[];
}

export interface Diagnostic {
  code: string;
  severity: 'critical' | 'warning' | 'info';
  category: RatioCategory | 'data' | 'solvency' | 'quality';
  message: string;
  period: string;
}

export interface WhatIfResult {
  cashFromReceivables: number;
  cashFromInventory: number;
  cashFromPayables: number;
  totalCashReleased: number;
  currentCcc: number | null;
  newCcc: number | null;
}

export interface StatementAnalysis {
  periods: string[];
  /** Per period: 'average' if averages of opening and closing balances were used. */
  basis: ('average' | 'ending')[];
  derived: DerivedLines[];
  ratios: RatioRow[];
  dupont: DupontPeriod[];
  altman: AltmanPeriod[];
  diagnostics: Diagnostic[];
  whatIf: WhatIfResult | null;
}

// --- reference constants (documented, shown as assumptions) ----------------------------------

export const ALTMAN_MODELS: Record<
  AltmanModel,
  { label: string; weights: number[]; distress: number; safe: number; source: string }
> = {
  public: {
    label: 'Original Z (public manufacturers)',
    weights: [1.2, 1.4, 3.3, 0.6, 1.0],
    distress: 1.81,
    safe: 2.99,
    source: 'Altman (1968)',
  },
  private: {
    label: "Z' (private firms, book equity)",
    weights: [0.717, 0.847, 3.107, 0.42, 0.998],
    distress: 1.23,
    safe: 2.9,
    source: 'Altman (1983)',
  },
  nonManufacturing: {
    label: "Z'' (non-manufacturers / emerging markets)",
    weights: [6.56, 3.26, 6.72, 1.05],
    distress: 1.1,
    safe: 2.6,
    source: 'Altman (1995)',
  },
};

/** Rule-of-thumb thresholds for the red-flag engine. Generic heuristics, not industry data. */
export const RED_FLAG_THRESHOLDS = {
  currentRatioMin: 1.0,
  quickRatioMin: 0.7,
  interestCoverageCritical: 1.5,
  interestCoverageWarning: 3.0,
  dscrCritical: 1.0,
  dscrWarning: 1.25,
  debtToEquityMax: 2.0,
  daysIncreasePct: 0.15,
  cccIncreaseDays: 10,
  grossMarginDropPts: 0.03,
  receivablesVsRevenueGrowthPts: 0.1,
  benchmarkTolerance: 0.1,
} as const;

const RATIO_META: Record<RatioId, Omit<RatioRow, 'id' | 'values' | 'benchmark' | 'status'>> = {
  currentRatio: {
    label: 'Current ratio',
    category: 'liquidity',
    unit: 'x',
    better: 'higher',
    formula: 'Current assets / Current liabilities',
  },
  quickRatio: {
    label: 'Quick (acid-test) ratio',
    category: 'liquidity',
    unit: 'x',
    better: 'higher',
    formula: '(Cash + ST investments + Receivables) / Current liabilities',
  },
  cashRatio: {
    label: 'Cash ratio',
    category: 'liquidity',
    unit: 'x',
    better: 'higher',
    formula: '(Cash + ST investments) / Current liabilities',
  },
  netWorkingCapital: {
    label: 'Net working capital',
    category: 'liquidity',
    unit: 'money',
    better: 'neutral',
    formula: 'Current assets − Current liabilities',
  },
  inventoryTurnover: {
    label: 'Inventory turnover',
    category: 'activity',
    unit: 'x',
    better: 'higher',
    formula: 'COGS / Average inventory',
  },
  dio: {
    label: 'Days inventory outstanding (DIO)',
    category: 'activity',
    unit: 'days',
    better: 'lower',
    formula: 'Average inventory / COGS × days',
  },
  dso: {
    label: 'Days sales outstanding (DSO)',
    category: 'activity',
    unit: 'days',
    better: 'lower',
    formula: 'Average receivables / Revenue × days',
  },
  dpo: {
    label: 'Days payables outstanding (DPO)',
    category: 'activity',
    unit: 'days',
    better: 'neutral',
    formula: 'Average payables / COGS × days',
  },
  assetTurnover: {
    label: 'Asset turnover',
    category: 'activity',
    unit: 'x',
    better: 'higher',
    formula: 'Revenue / Average total assets',
  },
  ccc: {
    label: 'Cash conversion cycle (CCC)',
    category: 'activity',
    unit: 'days',
    better: 'lower',
    formula: 'DIO + DSO − DPO',
  },
  debtToAssets: {
    label: 'Debt-to-assets',
    category: 'leverage',
    unit: 'pct',
    better: 'lower',
    formula: 'Total debt / Total assets',
  },
  debtToEquity: {
    label: 'Debt-to-equity (D/E)',
    category: 'leverage',
    unit: 'x',
    better: 'lower',
    formula: 'Total debt / Total equity',
  },
  interestCoverage: {
    label: 'Interest coverage (TIE)',
    category: 'leverage',
    unit: 'x',
    better: 'higher',
    formula: 'EBIT / Interest expense',
  },
  dscr: {
    label: 'Debt service coverage (DSCR)',
    category: 'leverage',
    unit: 'x',
    better: 'higher',
    formula: 'EBITDA / (Interest + Principal repayment)',
  },
  grossMargin: {
    label: 'Gross margin',
    category: 'profitability',
    unit: 'pct',
    better: 'higher',
    formula: 'Gross profit / Revenue',
  },
  ebitdaMargin: {
    label: 'EBITDA margin',
    category: 'profitability',
    unit: 'pct',
    better: 'higher',
    formula: 'EBITDA / Revenue',
  },
  netMargin: {
    label: 'Net profit margin',
    category: 'profitability',
    unit: 'pct',
    better: 'higher',
    formula: 'Net income / Revenue',
  },
  roa: {
    label: 'Return on assets (ROA)',
    category: 'profitability',
    unit: 'pct',
    better: 'higher',
    formula: 'Net income / Average total assets',
  },
  roe: {
    label: 'Return on equity (ROE)',
    category: 'profitability',
    unit: 'pct',
    better: 'higher',
    formula: 'Net income / Average equity',
  },
  roic: {
    label: 'Return on invested capital (ROIC)',
    category: 'profitability',
    unit: 'pct',
    better: 'higher',
    formula: 'EBIT × (1 − tax rate) / Average (debt + equity)',
  },
};

export const RATIO_IDS = Object.keys(RATIO_META) as RatioId[];
export const ratioMeta = (id: RatioId) => RATIO_META[id];

// --- implementation --------------------------------------------------------------------------

/** a / b, or null when b is zero or not finite (a ratio without a meaningful denominator). */
const div = (a: number, b: number): number | null =>
  b === 0 || !Number.isFinite(a / b) ? null : a / b;

export function analyzeStatements(input: StatementAnalysisInput): Result<StatementAnalysis> {
  const t = new Trace('statements.analyze');
  const days = input.daysInYear ?? 365;
  const model = input.altmanModel ?? 'private';
  const P = input.periods;

  // Validation -------------------------------------------------------------------------------
  if (!Array.isArray(P) || P.length < 1 || P.length > 3) {
    return t.fail({
      code: 'INVALID_PERIODS',
      message: 'Enter 1 to 3 periods (oldest first).',
      field: 'periods',
    });
  }
  if (days !== 365 && days !== 360)
    t.error({
      code: 'INVALID_DAYS',
      message: 'Days in year must be 365 or 360.',
      field: 'daysInYear',
    });
  if (!(model in ALTMAN_MODELS))
    t.error({ code: 'INVALID_MODEL', message: 'Unknown Altman model.', field: 'altmanModel' });
  if (
    input.statutoryTaxRate !== undefined &&
    !(input.statutoryTaxRate >= 0 && input.statutoryTaxRate < 1)
  ) {
    t.error({
      code: 'TAX_OUT_OF_RANGE',
      message: 'Statutory tax rate must be from 0% to below 100%.',
      field: 'statutoryTaxRate',
    });
  }
  P.forEach((p, i) => {
    for (const item of STATEMENT_ITEMS) {
      const v = p?.[item.key];
      const optional = OPTIONAL_ITEMS.includes(item.key);
      if (v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v))) {
        if (!optional) {
          t.error({
            code: 'MISSING_ITEM',
            message: `${p?.label ?? `Period ${i + 1}`}: ${item.label} is required (enter 0 if none).`,
            params: { period: i, item: item.key },
            field: 'periods',
          });
        }
        continue;
      }
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        t.error({
          code: 'INPUT_NOT_FINITE',
          message: `${p.label}: ${item.label} must be a number.`,
          params: { period: i, item: item.key },
          field: 'periods',
        });
      } else if (v < 0 && !SIGNED_ITEMS.includes(item.key)) {
        t.error({
          code: 'NEGATIVE_ITEM',
          message: `${p.label}: ${item.label} cannot be negative.`,
          params: { period: i, item: item.key },
          field: 'periods',
        });
      }
    }
  });
  if (input.whatIf) {
    for (const k of ['deltaDso', 'deltaDio', 'deltaDpo'] as const) {
      if (!Number.isFinite(input.whatIf[k]))
        t.error({ code: 'INPUT_NOT_FINITE', message: `${k} must be a number.`, field: k });
    }
  }
  for (const k of ['minDscr', 'minInterestCoverage'] as const) {
    const x = input.covenants?.[k];
    if (x != null && (!Number.isFinite(x) || x < 0)) {
      t.error({
        code: 'INVALID_COVENANT',
        message: `Covenant ${k} must be a non-negative number.`,
        field: k,
      });
    }
  }
  if (t.hasErrors) return t.fail();

  const labels = P.map((p, i) => p.label?.trim() || `Period ${i + 1}`);
  if (input.covenants?.minDscr != null || input.covenants?.minInterestCoverage != null) {
    t.assume(
      'covenants',
      `Loan covenants: minimum DSCR ${input.covenants.minDscr ?? 'none'}×, minimum interest coverage ${input.covenants.minInterestCoverage ?? 'none'}×; any period below a minimum is a critical breach.`,
    );
  }
  const v = (i: number, k: StatementItemKey) => P[i]![k] ?? 0;
  const opt = (i: number, k: StatementItemKey) => P[i]![k];

  t.assume('order', `Periods are ordered oldest to newest: ${labels.join(', ')}.`);
  t.assume(
    'averages',
    'Turnover, days and return ratios use the average of opening and closing balances when the prior period is available; the first period uses ending balances.',
  );
  t.assume('days', `DIO, DSO and DPO use a ${days}-day year.`);
  t.assume(
    'debt',
    'Total debt = short-term debt (incl. current portion of long-term debt) + long-term debt; other liabilities are treated as non-interest-bearing.',
  );
  t.assume(
    'ebit',
    'EBIT = revenue − COGS − operating expenses − D&A; other non-operating income is added after EBIT.',
  );
  t.assume(
    'dscr',
    'DSCR uses EBITDA as cash available for debt service, divided by interest plus scheduled principal.',
  );
  t.assume(
    'roic',
    'ROIC = NOPAT / average invested capital, with NOPAT = EBIT × (1 − effective tax rate) and invested capital = total debt + total equity.',
  );

  // Derived lines ----------------------------------------------------------------------------
  const derived: DerivedLines[] = P.map((_, i) => {
    const currentAssets =
      v(i, 'cash') +
      v(i, 'shortTermInvestments') +
      v(i, 'receivables') +
      v(i, 'inventory') +
      v(i, 'otherCurrentAssets');
    const totalAssets = currentAssets + v(i, 'nonCurrentAssets');
    const currentLiabilities =
      v(i, 'payables') + v(i, 'shortTermDebt') + v(i, 'otherCurrentLiabilities');
    const totalLiabilities =
      currentLiabilities + v(i, 'longTermDebt') + v(i, 'otherNonCurrentLiabilities');
    const totalDebt = v(i, 'shortTermDebt') + v(i, 'longTermDebt');
    const liabilitiesAndEquity = totalLiabilities + v(i, 'equity');
    const grossProfit = v(i, 'revenue') - v(i, 'cogs');
    const ebitda = grossProfit - v(i, 'operatingExpenses');
    const ebit = ebitda - v(i, 'depreciation');
    const ebt = ebit - v(i, 'interestExpense') + v(i, 'otherIncome');
    const netIncome = ebt - v(i, 'taxExpense');
    const effective = ebt > 0 ? v(i, 'taxExpense') / ebt : null;
    const taxRateUsed =
      effective !== null && effective >= 0 && effective < 1
        ? effective
        : (input.statutoryTaxRate ?? null);
    return {
      currentAssets,
      totalAssets,
      currentLiabilities,
      totalLiabilities,
      totalDebt,
      liabilitiesAndEquity,
      balanceDifference: totalAssets - liabilitiesAndEquity,
      grossProfit,
      ebitda,
      ebit,
      ebt,
      netIncome,
      effectiveTaxRate: effective,
      taxRateUsed,
    };
  });

  const avg = (i: number, f: (j: number) => number) => (i > 0 ? (f(i - 1) + f(i)) / 2 : f(i));
  const basis: ('average' | 'ending')[] = P.map((_, i) => (i > 0 ? 'average' : 'ending'));

  // Ratios -----------------------------------------------------------------------------------
  const calc: Record<RatioId, (i: number) => number | null> = {
    currentRatio: (i) => div(derived[i]!.currentAssets, derived[i]!.currentLiabilities),
    quickRatio: (i) =>
      div(
        v(i, 'cash') + v(i, 'shortTermInvestments') + v(i, 'receivables'),
        derived[i]!.currentLiabilities,
      ),
    cashRatio: (i) =>
      div(v(i, 'cash') + v(i, 'shortTermInvestments'), derived[i]!.currentLiabilities),
    netWorkingCapital: (i) => derived[i]!.currentAssets - derived[i]!.currentLiabilities,
    inventoryTurnover: (i) =>
      div(
        v(i, 'cogs'),
        avg(i, (j) => v(j, 'inventory')),
      ),
    dio: (i) =>
      mul(
        div(
          avg(i, (j) => v(j, 'inventory')),
          v(i, 'cogs'),
        ),
        days,
      ),
    dso: (i) =>
      mul(
        div(
          avg(i, (j) => v(j, 'receivables')),
          v(i, 'revenue'),
        ),
        days,
      ),
    dpo: (i) =>
      mul(
        div(
          avg(i, (j) => v(j, 'payables')),
          v(i, 'cogs'),
        ),
        days,
      ),
    assetTurnover: (i) =>
      div(
        v(i, 'revenue'),
        avg(i, (j) => derived[j]!.totalAssets),
      ),
    ccc: (i) => {
      const [a, b, c] = [calc.dio(i), calc.dso(i), calc.dpo(i)];
      return a === null || b === null || c === null ? null : a + b - c;
    },
    debtToAssets: (i) => div(derived[i]!.totalDebt, derived[i]!.totalAssets),
    debtToEquity: (i) => (v(i, 'equity') > 0 ? div(derived[i]!.totalDebt, v(i, 'equity')) : null),
    interestCoverage: (i) => div(derived[i]!.ebit, v(i, 'interestExpense')),
    dscr: (i) => div(derived[i]!.ebitda, v(i, 'interestExpense') + v(i, 'principalRepayment')),
    grossMargin: (i) => div(derived[i]!.grossProfit, v(i, 'revenue')),
    ebitdaMargin: (i) => div(derived[i]!.ebitda, v(i, 'revenue')),
    netMargin: (i) => div(derived[i]!.netIncome, v(i, 'revenue')),
    roa: (i) =>
      div(
        derived[i]!.netIncome,
        avg(i, (j) => derived[j]!.totalAssets),
      ),
    roe: (i) => {
      const e = avg(i, (j) => v(j, 'equity'));
      return e > 0 ? div(derived[i]!.netIncome, e) : null;
    },
    roic: (i) => {
      const tax = derived[i]!.taxRateUsed;
      if (tax === null) return null;
      const ic = avg(i, (j) => derived[j]!.totalDebt + v(j, 'equity'));
      return ic > 0 ? div(derived[i]!.ebit * (1 - tax), ic) : null;
    },
  };

  const last = P.length - 1;
  const tol = RED_FLAG_THRESHOLDS.benchmarkTolerance;
  const ratios: RatioRow[] = RATIO_IDS.map((id) => {
    const meta = RATIO_META[id];
    const values = P.map((_, i) => calc[id](i));
    const bm = input.benchmarks?.[id];
    const benchmark = typeof bm === 'number' && Number.isFinite(bm) ? bm : null;
    const latest = values[last];
    let status: RatioRow['status'] = null;
    if (
      benchmark !== null &&
      latest !== null &&
      latest !== undefined &&
      meta.better !== 'neutral'
    ) {
      const gap = benchmark === 0 ? latest : (latest - benchmark) / Math.abs(benchmark);
      status =
        Math.abs(gap) <= tol
          ? 'inline'
          : gap > 0 === (meta.better === 'higher')
            ? 'better'
            : 'worse';
    }
    return { id, ...meta, values, benchmark, status };
  });
  const r = (id: RatioId, i: number) => ratios.find((x) => x.id === id)!.values[i] ?? null;

  const undefinedRatios = ratios.filter((x) => x.values[last] === null).map((x) => x.label);
  if (undefinedRatios.length > 0) {
    t.warn({
      code: 'RATIOS_UNDEFINED',
      message: `Not meaningful for ${labels[last]} (zero or negative denominator): ${undefinedRatios.join(', ')}.`,
      params: { count: undefinedRatios.length },
    });
  }

  // DuPont -----------------------------------------------------------------------------------
  const dupont: DupontPeriod[] = P.map((_, i) => {
    const d = derived[i]!;
    const avgAssets = avg(i, (j) => derived[j]!.totalAssets);
    const avgEquity = avg(i, (j) => v(j, 'equity'));
    return {
      netMargin: r('netMargin', i),
      assetTurnover: r('assetTurnover', i),
      equityMultiplier: avgEquity > 0 ? div(avgAssets, avgEquity) : null,
      taxBurden: div(d.netIncome, d.ebt),
      interestBurden: div(d.ebt, d.ebit),
      ebitMargin: div(d.ebit, v(i, 'revenue')),
      roe: r('roe', i),
    };
  });
  t.assume(
    'dupont',
    'DuPont: ROE = net margin × asset turnover × equity multiplier (3-step) = tax burden × interest burden × EBIT margin × asset turnover × equity multiplier (5-step), with average assets and equity.',
  );

  // Altman Z ---------------------------------------------------------------------------------
  const am = ALTMAN_MODELS[model];
  t.assume(
    'altman',
    `Altman ${am.label}, ${am.source}: distress below ${am.distress}, safe above ${am.safe}, grey zone in between. Uses ending balances.`,
  );
  const altman: AltmanPeriod[] = P.map((_, i) => {
    const d = derived[i]!;
    const ta = d.totalAssets;
    const mve = opt(i, 'marketCap');
    const x4 =
      model === 'public'
        ? mve === null
          ? null
          : div(mve, d.totalLiabilities)
        : div(v(i, 'equity'), d.totalLiabilities);
    const comps = [
      {
        id: 'X1',
        label: 'Working capital / Total assets',
        value: div(d.currentAssets - d.currentLiabilities, ta),
      },
      {
        id: 'X2',
        label: 'Retained earnings / Total assets',
        value: div(v(i, 'retainedEarnings'), ta),
      },
      { id: 'X3', label: 'EBIT / Total assets', value: div(d.ebit, ta) },
      {
        id: 'X4',
        label:
          model === 'public'
            ? 'Market value of equity / Total liabilities'
            : 'Book equity / Total liabilities',
        value: x4,
      },
      { id: 'X5', label: 'Revenue / Total assets', value: div(v(i, 'revenue'), ta) },
    ].slice(0, am.weights.length);
    const components = comps.map((c, k) => ({ ...c, weight: am.weights[k]! }));
    const score = components.every((c) => c.value !== null)
      ? components.reduce((s, c) => s + c.weight * c.value!, 0)
      : null;
    const zone =
      score === null ? null : score < am.distress ? 'distress' : score > am.safe ? 'safe' : 'grey';
    return { model, score, zone, components };
  });
  if (model === 'public' && altman.some((a) => a.score === null)) {
    t.warn({
      code: 'ALTMAN_NEEDS_MARKET_CAP',
      message:
        'The public-company Z-score needs the market value of equity; enter it or choose the private-firm model.',
    });
  }

  // Diagnostics (red flags) ------------------------------------------------------------------
  const T = RED_FLAG_THRESHOLDS;
  t.assume(
    'redFlags',
    `Red flags use generic rules of thumb, not industry data: current ratio < ${T.currentRatioMin}, quick ratio < ${T.quickRatioMin}, interest coverage < ${T.interestCoverageWarning} (critical < ${T.interestCoverageCritical}), DSCR < ${T.dscrWarning} (critical < ${T.dscrCritical}), D/E > ${T.debtToEquityMax}, DIO/DSO up > ${T.daysIncreasePct * 100}%, CCC up > ${T.cccIncreaseDays} days, gross margin down > ${T.grossMarginDropPts * 100} pts, receivables growing > ${T.receivablesVsRevenueGrowthPts * 100} pts faster than revenue, operating cash flow below net income.`,
  );
  const diagnostics: Diagnostic[] = [];
  const flag = (d: Diagnostic) => diagnostics.push(d);
  P.forEach((_, i) => {
    const L = labels[i]!;
    const d = derived[i]!;
    const scale = Math.max(1, Math.abs(d.totalAssets));
    if (Math.abs(d.balanceDifference) > 1e-6 * scale) {
      flag({
        code: 'BALANCE_SHEET_MISMATCH',
        severity: 'critical',
        category: 'data',
        period: L,
        message: `Assets differ from liabilities + equity by ${d.balanceDifference.toFixed(2)}. Check for missing items: every ratio depends on it.`,
      });
    }
    if (v(i, 'equity') <= 0)
      flag({
        code: 'NEGATIVE_EQUITY',
        severity: 'critical',
        category: 'solvency',
        period: L,
        message: 'Equity is zero or negative: liabilities exceed assets.',
      });
    const cr = r('currentRatio', i);
    if (cr !== null && cr < T.currentRatioMin)
      flag({
        code: 'LOW_CURRENT_RATIO',
        severity: 'warning',
        category: 'liquidity',
        period: L,
        message: `Current ratio ${cr.toFixed(2)} is below ${T.currentRatioMin}: current liabilities exceed current assets.`,
      });
    const qr = r('quickRatio', i);
    if (qr !== null && qr < T.quickRatioMin)
      flag({
        code: 'LOW_QUICK_RATIO',
        severity: 'warning',
        category: 'liquidity',
        period: L,
        message: `Quick ratio ${qr.toFixed(2)} is below ${T.quickRatioMin}: short-term obligations rely on selling inventory.`,
      });
    const ic = r('interestCoverage', i);
    if (ic !== null && ic < T.interestCoverageWarning) {
      flag({
        code: 'LOW_INTEREST_COVERAGE',
        severity: ic < T.interestCoverageCritical ? 'critical' : 'warning',
        category: 'leverage',
        period: L,
        message: `EBIT covers interest only ${ic.toFixed(2)}×.`,
      });
    }
    const ds = r('dscr', i);
    if (ds !== null && ds < T.dscrWarning) {
      flag({
        code: 'LOW_DSCR',
        severity: ds < T.dscrCritical ? 'critical' : 'warning',
        category: 'leverage',
        period: L,
        message: `DSCR ${ds.toFixed(2)}×: ${ds < 1 ? 'operating cash earnings do not cover debt service' : 'below the 1.25× level common in loan covenants'}.`,
      });
    }
    // User-defined loan covenants: a breach is always critical.
    const cov = input.covenants;
    if (cov?.minDscr != null && ds !== null && ds < cov.minDscr) {
      flag({
        code: 'COVENANT_BREACH_DSCR',
        severity: 'critical',
        category: 'leverage',
        period: L,
        message: `Covenant breach: DSCR ${ds.toFixed(2)}× is below the ${cov.minDscr.toFixed(2)}× minimum.`,
      });
    }
    if (cov?.minInterestCoverage != null && ic !== null && ic < cov.minInterestCoverage) {
      flag({
        code: 'COVENANT_BREACH_TIE',
        severity: 'critical',
        category: 'leverage',
        period: L,
        message: `Covenant breach: interest coverage ${ic.toFixed(2)}× is below the ${cov.minInterestCoverage.toFixed(2)}× minimum.`,
      });
    }
    const de = r('debtToEquity', i);
    if (de !== null && de > T.debtToEquityMax)
      flag({
        code: 'HIGH_LEVERAGE',
        severity: 'warning',
        category: 'leverage',
        period: L,
        message: `Debt is ${de.toFixed(2)}× equity.`,
      });
    if (d.ebit < 0)
      flag({
        code: 'OPERATING_LOSS',
        severity: 'critical',
        category: 'profitability',
        period: L,
        message: 'EBIT is negative: the core business loses money.',
      });
    else if (d.netIncome < 0)
      flag({
        code: 'NET_LOSS',
        severity: 'warning',
        category: 'profitability',
        period: L,
        message: 'Net income is negative.',
      });
    const ocf = opt(i, 'operatingCashFlow');
    if (ocf !== null && d.netIncome > 0 && ocf < d.netIncome) {
      flag({
        code: 'EARNINGS_QUALITY',
        severity: ocf < 0 ? 'critical' : 'warning',
        category: 'quality',
        period: L,
        message: `Operating cash flow (${ocf.toFixed(0)}) is below net income (${d.netIncome.toFixed(0)}): profits are not turning into cash (accruals).`,
      });
    }
    const z = altman[i]!;
    if (z.zone === 'distress')
      flag({
        code: 'ALTMAN_DISTRESS',
        severity: 'critical',
        category: 'solvency',
        period: L,
        message: `Altman Z = ${z.score!.toFixed(2)}: distress zone.`,
      });
    else if (z.zone === 'grey')
      flag({
        code: 'ALTMAN_GREY',
        severity: 'warning',
        category: 'solvency',
        period: L,
        message: `Altman Z = ${z.score!.toFixed(2)}: grey zone.`,
      });

    if (i === 0) return;
    const pct = (a: number | null, b: number | null) =>
      a === null || b === null || b === 0 ? null : a / b - 1;
    for (const [id, name] of [
      ['dso', 'DSO'],
      ['dio', 'DIO'],
    ] as const) {
      const g = pct(r(id, i), r(id, i - 1));
      if (g !== null && g > T.daysIncreasePct)
        flag({
          code: `${name}_RISING`,
          severity: 'warning',
          category: 'activity',
          period: L,
          message: `${name} rose ${(g * 100).toFixed(0)}% (${r(id, i - 1)!.toFixed(1)} → ${r(id, i)!.toFixed(1)} days).`,
        });
    }
    const c0 = r('ccc', i - 1);
    const c1 = r('ccc', i);
    if (c0 !== null && c1 !== null && c1 - c0 > T.cccIncreaseDays)
      flag({
        code: 'CCC_RISING',
        severity: 'warning',
        category: 'activity',
        period: L,
        message: `The cash conversion cycle lengthened by ${(c1 - c0).toFixed(1)} days: more cash is tied up in operations.`,
      });
    const g0 = r('grossMargin', i - 1);
    const g1 = r('grossMargin', i);
    if (g0 !== null && g1 !== null && g0 - g1 > T.grossMarginDropPts)
      flag({
        code: 'MARGIN_EROSION',
        severity: 'warning',
        category: 'profitability',
        period: L,
        message: `Gross margin fell ${((g0 - g1) * 100).toFixed(1)} points.`,
      });
    const revG = pct(v(i, 'revenue'), v(i - 1, 'revenue'));
    const arG = pct(v(i, 'receivables'), v(i - 1, 'receivables'));
    if (revG !== null && arG !== null && arG - revG > T.receivablesVsRevenueGrowthPts) {
      flag({
        code: 'RECEIVABLES_OUTPACE_SALES',
        severity: 'warning',
        category: 'quality',
        period: L,
        message: `Receivables grew ${(arG * 100).toFixed(0)}% while revenue grew ${(revG * 100).toFixed(0)}%: check collection and revenue recognition.`,
      });
    }
    const roe0 = r('roe', i - 1);
    const roe1 = r('roe', i);
    const roa0 = r('roa', i - 1);
    const roa1 = r('roa', i);
    if (
      roe0 !== null &&
      roe1 !== null &&
      roa0 !== null &&
      roa1 !== null &&
      roe1 > roe0 &&
      roa1 < roa0
    ) {
      flag({
        code: 'LEVERAGE_DRIVEN_ROE',
        severity: 'info',
        category: 'profitability',
        period: L,
        message:
          'ROE rose while ROA fell: the improvement comes from more leverage, not better operations (see DuPont).',
      });
    }
  });
  const critical = diagnostics.filter((d) => d.severity === 'critical');
  if (critical.length > 0) {
    t.warn({
      code: 'RED_FLAGS',
      message: `${critical.length} critical red flag(s): ${critical.map((d) => `${d.period}: ${d.message}`).join(' ')}`,
      params: { count: critical.length },
    });
  }

  // What-if ----------------------------------------------------------------------------------
  let whatIf: WhatIfResult | null = null;
  if (input.whatIf) {
    const { deltaDso, deltaDio, deltaDpo } = input.whatIf;
    const revPerDay = v(last, 'revenue') / days;
    const cogsPerDay = v(last, 'cogs') / days;
    const cur = r('ccc', last);
    whatIf = {
      cashFromReceivables: -deltaDso * revPerDay,
      cashFromInventory: -deltaDio * cogsPerDay,
      cashFromPayables: deltaDpo * cogsPerDay,
      totalCashReleased: -deltaDso * revPerDay - deltaDio * cogsPerDay + deltaDpo * cogsPerDay,
      currentCcc: cur,
      newCcc: cur === null ? null : cur + deltaDio + deltaDso - deltaDpo,
    };
    t.assume(
      'whatIf',
      `What-if on ${labels[last]}: each day of DSO is worth revenue / ${days} of receivables, each day of DIO or DPO is worth COGS / ${days}; the cash release is one-off, at current activity levels.`,
    );
  }

  // Steps (latest period) ----------------------------------------------------------------------
  const d = derived[last]!;
  t.step('totalAssets', `${labels[last]}: total assets`, d.totalAssets, 'TA = CA + NCA');
  t.step('balance', `${labels[last]}: assets − (liabilities + equity)`, d.balanceDifference);
  t.step('ebitda', `${labels[last]}: EBITDA`, d.ebitda, 'EBITDA = Revenue - COGS - OpEx');
  t.step('ebit', `${labels[last]}: EBIT`, d.ebit, 'EBIT = EBITDA - D\\&A');
  t.step(
    'netIncome',
    `${labels[last]}: net income`,
    d.netIncome,
    'NI = EBIT - Interest + Other - Tax',
  );
  for (const row of ratios) {
    const x = row.values[last];
    if (x !== null && x !== undefined) t.step(row.id, `${labels[last]}: ${row.label}`, x);
  }
  const dp = dupont[last]!;
  if (dp.roe !== null) {
    t.step(
      'dupont3',
      'DuPont 3-step product',
      (dp.netMargin ?? NaN) * (dp.assetTurnover ?? NaN) * (dp.equityMultiplier ?? NaN),
      'ROE = \\frac{NI}{Rev} \\cdot \\frac{Rev}{\\bar{A}} \\cdot \\frac{\\bar{A}}{\\bar{E}}',
    );
  }
  const z = altman[last]!;
  if (z.score !== null)
    t.step(
      'altman',
      `Altman Z (${model})`,
      z.score,
      `Z = ${z.components.map((c) => `${c.weight}${c.id}`).join(' + ')}`,
    );
  if (whatIf)
    t.step(
      'whatIf',
      'Cash released by the what-if',
      whatIf.totalCashReleased,
      '-\\Delta DSO \\frac{Rev}{days} - \\Delta DIO \\frac{COGS}{days} + \\Delta DPO \\frac{COGS}{days}',
    );

  return t.ok({ periods: labels, basis, derived, ratios, dupont, altman, diagnostics, whatIf });
}

function mul(a: number | null, b: number): number | null {
  return a === null ? null : a * b;
}
