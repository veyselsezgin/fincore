import { growth } from '../core/math.js';
import { Trace, type Result } from '../core/result.js';
import { requireFinite, requireFiniteArray, requireRateAboveMinusOne } from '../core/validate.js';

/**
 * Capital budgeting KPIs beyond NPV/IRR: payback, discounted payback and profitability index.
 * Convention: cashFlows[0] at t = 0, one period apart (as `npv`).
 */
export interface PaybackInput {
  rate: number;
  cashFlows: number[];
}

export interface PaybackOutput {
  /** Periods until cumulative undiscounted cash flow turns non-negative; null if never. */
  payback: number | null;
  /** Same on discounted cash flows; null if never recovered within the horizon. */
  discountedPayback: number | null;
  /** PV of flows t ≥ 1 divided by |CF0| (CFA definition); null when CF0 ≥ 0. */
  profitabilityIndex: number | null;
  cumulative: number[];
  cumulativeDiscounted: number[];
}

/** First period where the running total reaches zero, interpolated linearly inside the period. */
function crossing(cum: number[], flows: number[]): number | null {
  if (cum[0]! >= 0) return 0;
  for (let t = 1; t < cum.length; t++) {
    if (cum[t]! >= 0) {
      const f = flows[t]!;
      return f > 0 ? t - 1 + -cum[t - 1]! / f : t;
    }
  }
  return null;
}

export function paybackAnalysis(input: PaybackInput): Result<PaybackOutput> {
  const t = new Trace('cashflow.payback');
  requireRateAboveMinusOne(t, 'rate', input.rate);
  requireFiniteArray(t, 'cashFlows', input.cashFlows, 2);
  if (t.hasErrors) return t.fail();
  const cf = input.cashFlows;
  const disc = cf.map((c, i) => c / growth(input.rate, i));
  const cumulative: number[] = [];
  const cumulativeDiscounted: number[] = [];
  cf.forEach((c, i) => {
    cumulative.push((cumulative[i - 1] ?? 0) + c);
    cumulativeDiscounted.push((cumulativeDiscounted[i - 1] ?? 0) + disc[i]!);
  });
  t.assume(
    'interpolation',
    'Payback is interpolated linearly within the recovery period (cash assumed to arrive evenly).',
  );
  t.assume(
    'pi',
    'Profitability index = PV of cash flows from t = 1 / initial investment |CF0| (CFA). PI > 1 ⇔ NPV > 0.',
  );
  const payback = crossing(cumulative, cf);
  const discountedPayback = crossing(cumulativeDiscounted, disc);
  const pvFuture = disc.slice(1).reduce((a, b) => a + b, 0);
  const profitabilityIndex = cf[0]! < 0 ? pvFuture / -cf[0]! : null;
  if (payback === null)
    t.warn({
      code: 'NOT_RECOVERED',
      message: 'The investment is never recovered within the horizon (undiscounted).',
    });
  if (discountedPayback === null && payback !== null) {
    t.warn({
      code: 'NOT_RECOVERED_DISCOUNTED',
      message: 'The investment is not recovered on a discounted basis within the horizon.',
    });
  }
  if (cf.slice(1).some((c) => c < 0) && payback !== null) {
    t.warn({
      code: 'NON_CONVENTIONAL',
      message:
        'Later negative cash flows can make payback misleading; it reports the first recovery only.',
    });
  }
  if (profitabilityIndex === null)
    t.warn({ code: 'PI_UNDEFINED', message: 'PI needs a negative initial cash flow.' });
  if (payback !== null) t.step('payback', 'Payback period', payback);
  if (discountedPayback !== null)
    t.step('discountedPayback', 'Discounted payback period', discountedPayback);
  t.step('pvFuture', 'PV of cash flows t ≥ 1', pvFuture, '\\sum_{t\\ge1} \\frac{CF_t}{(1+r)^t}');
  if (profitabilityIndex !== null)
    t.step('pi', 'Profitability index', profitabilityIndex, 'PI = \\frac{PV(CF_{t\\ge1})}{|CF_0|}');
  return t.ok({ payback, discountedPayback, profitabilityIndex, cumulative, cumulativeDiscounted });
}

// --- Fisher equation ---------------------------------------------------------------------------

export interface FisherInput {
  rate: number;
  inflation: number;
  /** Which way to convert. */
  from: 'nominal' | 'real';
}

/** Exact Fisher relation: (1 + nominal) = (1 + real)(1 + inflation). */
export function fisherConvert(input: FisherInput): Result<number> {
  const t = new Trace('cashflow.fisher');
  requireRateAboveMinusOne(t, 'rate', input.rate);
  requireRateAboveMinusOne(t, 'inflation', input.inflation);
  if (input.from !== 'nominal' && input.from !== 'real')
    t.error({
      code: 'INVALID_DIRECTION',
      message: "from must be 'nominal' or 'real'.",
      field: 'from',
    });
  if (t.hasErrors) return t.fail();
  t.assume(
    'fisher',
    'Exact Fisher equation (1 + nominal) = (1 + real)(1 + inflation), not the additive approximation.',
  );
  const v =
    input.from === 'real'
      ? (1 + input.rate) * (1 + input.inflation) - 1
      : (1 + input.rate) / (1 + input.inflation) - 1;
  t.step(
    'converted',
    input.from === 'real' ? 'Nominal rate' : 'Real rate',
    v,
    input.from === 'real' ? 'r_n = (1+r_r)(1+\\pi) - 1' : 'r_r = \\frac{1+r_n}{1+\\pi} - 1',
  );
  return t.ok(v);
}

/** Real cash flows → nominal: CF_t × (1 + π)^t (and the reverse). Pure helper, no trace. */
export function inflateCashFlows(
  flows: readonly number[],
  inflation: number,
  direction: 'toNominal' | 'toReal',
): number[] {
  return flows.map((c, i) =>
    direction === 'toNominal' ? c * growth(inflation, i) : c / growth(inflation, i),
  );
}

// --- Hamada ------------------------------------------------------------------------------------

export interface HamadaInput {
  /** Peer (observed) levered beta. */
  peerBeta: number;
  peerDebtToEquity: number;
  peerTaxRate: number;
  targetDebtToEquity: number;
  targetTaxRate: number;
}

export interface HamadaOutput {
  unleveredBeta: number;
  releveredBeta: number;
}

/** Hamada: βU = βL / [1 + (1 − T) D/E]; re-lever βL = βU [1 + (1 − T) D/E] at the target structure. */
export function hamadaBeta(input: HamadaInput): Result<HamadaOutput> {
  const t = new Trace('valuation.hamada');
  for (const k of [
    'peerBeta',
    'peerDebtToEquity',
    'peerTaxRate',
    'targetDebtToEquity',
    'targetTaxRate',
  ] as const)
    requireFinite(t, k, input[k]);
  if (t.hasErrors) return t.fail();
  for (const k of ['peerDebtToEquity', 'targetDebtToEquity'] as const) {
    if (input[k] < 0)
      t.error({ code: 'NEGATIVE_LEVERAGE', message: 'D/E cannot be negative.', field: k });
  }
  for (const k of ['peerTaxRate', 'targetTaxRate'] as const) {
    if (input[k] < 0 || input[k] >= 1)
      t.error({
        code: 'TAX_OUT_OF_RANGE',
        message: 'Tax rate must be from 0% to below 100%.',
        field: k,
      });
  }
  if (t.hasErrors) return t.fail();
  t.assume(
    'hamada',
    'Hamada (1972): debt beta = 0, constant debt level, tax shield at the marginal rate.',
  );
  const factorPeer = 1 + (1 - input.peerTaxRate) * input.peerDebtToEquity;
  const unleveredBeta = input.peerBeta / factorPeer;
  const factorTarget = 1 + (1 - input.targetTaxRate) * input.targetDebtToEquity;
  const releveredBeta = unleveredBeta * factorTarget;
  t.step(
    'unlevered',
    'Unlevered (asset) beta',
    unleveredBeta,
    '\\beta_U = \\frac{\\beta_L}{1 + (1-T)\\,D/E}',
  );
  t.step(
    'relevered',
    'Re-levered beta at target D/E',
    releveredBeta,
    '\\beta_L^* = \\beta_U\\,[1 + (1-T^*)\\,(D/E)^*]',
  );
  return t.ok({ unleveredBeta, releveredBeta });
}

// --- Bottom-up project FCF -------------------------------------------------------------------

export interface ProjectFcfInput {
  years: number;
  /** Year-1 revenue. */
  revenue: number;
  revenueGrowth: number;
  /** COGS as a share of revenue (drives inventory and payables). */
  cogsPct: number;
  ebitdaMargin: number;
  /** D&A as a share of revenue. */
  daPct: number;
  capexPct: number;
  taxRate: number;
  dso: number;
  dio: number;
  dpo: number;
  initialInvestment: number;
  /** Perpetual growth after the last year; null = no terminal value. */
  terminalGrowth: number | null;
  /** Discount rate used for the Gordon terminal value. */
  discountRate: number;
  daysInYear?: number;
}

export interface ProjectFcfRow {
  year: number;
  revenue: number;
  ebitda: number;
  depreciation: number;
  ebit: number;
  taxes: number;
  nopat: number;
  capex: number;
  nwc: number;
  deltaNwc: number;
  fcf: number;
}

export interface ProjectFcfOutput {
  rows: ProjectFcfRow[];
  terminalValue: number;
  /** [−initialInvestment, FCF1, …, FCF_N + TV]: feeds NPV / IRR / Monte Carlo. */
  cashFlows: number[];
}

export function projectFcf(input: ProjectFcfInput): Result<ProjectFcfOutput> {
  const t = new Trace('cashflow.projectFcf');
  const days = input.daysInYear ?? 365;
  const keys = [
    'revenue',
    'revenueGrowth',
    'cogsPct',
    'ebitdaMargin',
    'daPct',
    'capexPct',
    'taxRate',
    'dso',
    'dio',
    'dpo',
    'initialInvestment',
    'discountRate',
  ] as const;
  for (const k of keys) requireFinite(t, k, input[k]);
  if (!Number.isInteger(input.years) || input.years < 1 || input.years > 30)
    t.error({
      code: 'INVALID_YEARS',
      message: 'Years must be a whole number from 1 to 30.',
      field: 'years',
    });
  if (input.terminalGrowth !== null) requireFinite(t, 'terminalGrowth', input.terminalGrowth);
  if (t.hasErrors) return t.fail();
  if (input.revenue < 0)
    t.error({ code: 'NEGATIVE_REVENUE', message: 'Revenue cannot be negative.', field: 'revenue' });
  if (input.taxRate < 0 || input.taxRate >= 1)
    t.error({
      code: 'TAX_OUT_OF_RANGE',
      message: 'Tax rate must be from 0% to below 100%.',
      field: 'taxRate',
    });
  for (const k of ['dso', 'dio', 'dpo', 'cogsPct', 'daPct', 'capexPct'] as const) {
    if (input[k] < 0)
      t.error({ code: 'NEGATIVE_DRIVER', message: `${k} cannot be negative.`, field: k });
  }
  if (input.discountRate <= -1)
    t.error({
      code: 'RATE_OUT_OF_DOMAIN',
      message: 'Discount rate must exceed -100%.',
      field: 'discountRate',
    });
  if (input.terminalGrowth !== null && input.terminalGrowth >= input.discountRate) {
    t.error({
      code: 'GROWTH_NOT_BELOW_RATE',
      message: 'Terminal growth must be below the discount rate (Gordon model).',
      field: 'terminalGrowth',
    });
  }
  if (t.hasErrors) return t.fail();

  t.assume(
    'timing',
    'Year-end cash flows; the initial investment is at t = 0 and the project starts with zero working capital.',
  );
  t.assume(
    'nwc',
    `Working capital = receivables (revenue × DSO/${days}) + inventory (COGS × DIO/${days}) − payables (COGS × DPO/${days}).`,
  );
  t.assume(
    'tax',
    'Taxes on EBIT (unlevered FCF): FCF = EBIT(1 − T) + D&A − CapEx − ΔNWC. A negative EBIT creates a tax credit (assumes other taxable profits).',
  );
  if (input.terminalGrowth !== null)
    t.assume(
      'tv',
      'Terminal value (Gordon): TV_N = FCF_N × (1 + g) / (r − g), added to the final year.',
    );

  const rows: ProjectFcfRow[] = [];
  let prevNwc = 0;
  for (let y = 1; y <= input.years; y++) {
    const revenue = input.revenue * growth(input.revenueGrowth, y - 1);
    const cogs = revenue * input.cogsPct;
    const ebitda = revenue * input.ebitdaMargin;
    const depreciation = revenue * input.daPct;
    const ebit = ebitda - depreciation;
    const taxes = ebit * input.taxRate;
    const nopat = ebit - taxes;
    const capex = revenue * input.capexPct;
    const nwc =
      (revenue * input.dso) / days + (cogs * input.dio) / days - (cogs * input.dpo) / days;
    const deltaNwc = nwc - prevNwc;
    prevNwc = nwc;
    rows.push({
      year: y,
      revenue,
      ebitda,
      depreciation,
      ebit,
      taxes,
      nopat,
      capex,
      nwc,
      deltaNwc,
      fcf: nopat + depreciation - capex - deltaNwc,
    });
  }
  const lastFcf = rows[rows.length - 1]!.fcf;
  const terminalValue =
    input.terminalGrowth === null
      ? 0
      : (lastFcf * (1 + input.terminalGrowth)) / (input.discountRate - input.terminalGrowth);
  const cashFlows = [
    -input.initialInvestment,
    ...rows.map((r, i) => r.fcf + (i === rows.length - 1 ? terminalValue : 0)),
  ];
  rows.forEach((r) =>
    t.step(
      `fcf${r.year}`,
      `Year ${r.year} free cash flow`,
      r.fcf,
      'FCF = EBIT(1-T) + D\\&A - CapEx - \\Delta NWC',
    ),
  );
  if (input.terminalGrowth !== null)
    t.step('tv', 'Terminal value at final year', terminalValue, 'TV = \\frac{FCF_N(1+g)}{r-g}');
  if (input.terminalGrowth !== null && terminalValue < 0)
    t.warn({
      code: 'NEGATIVE_TERMINAL_VALUE',
      message: 'The terminal value is negative because the final-year FCF is negative.',
    });
  return t.ok({ rows, terminalValue, cashFlows });
}
