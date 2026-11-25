import { growth, signChanges } from '../core/math.js';
import { Trace, type Result } from '../core/result.js';
import { requireFiniteArray, requireRateAboveMinusOne } from '../core/validate.js';
import { actualDays, parseISODate, toSerial, type CivilDate } from '../daycount/date.js';
import { DEFAULT_RATE_GRID, findRoots, isIndeterminate } from '../solvers/findRoots.js';
import { formatPcts } from '../tvm/tvm.js';

/**
 * Periodic cash-flow analysis.
 *
 * Timing convention (default `firstPeriod: 0`): `cashFlows[i]` occurs at the END of period i,
 * so `cashFlows[0]` is at t = 0 and is not discounted. This is the textbook/CFA convention.
 * `firstPeriod: 1` reproduces Excel's NPV(), which discounts the first value by one period.
 */
export interface NpvInput {
  rate: number;
  cashFlows: number[];
  firstPeriod?: 0 | 1;
}

export interface NpvOutput {
  npv: number;
  presentValues: number[];
}

export function npvRaw(rate: number, cashFlows: readonly number[], firstPeriod: 0 | 1 = 0): number {
  let s = 0;
  for (let i = 0; i < cashFlows.length; i++) s += cashFlows[i]! / growth(rate, i + firstPeriod);
  return s;
}

function checkFirstPeriod(t: Trace, fp: unknown): void {
  if (fp !== undefined && fp !== 0 && fp !== 1) {
    t.error({
      code: 'INVALID_FIRST_PERIOD',
      message: 'firstPeriod must be 0 or 1.',
      field: 'firstPeriod',
    });
  }
}

function assumeTiming(t: Trace, firstPeriod: 0 | 1): void {
  t.assume(
    'timing',
    firstPeriod === 0
      ? 'The first cash flow occurs today (t = 0); each following flow is one period later.'
      : 'The first cash flow occurs one period from now (Excel NPV convention).',
  );
  t.assume('rateUnit', 'The discount rate is per period, matching the spacing of cash flows.');
}

export function npv(input: NpvInput): Result<NpvOutput> {
  const t = new Trace('cashflow.npv');
  const firstPeriod = input.firstPeriod ?? 0;
  requireRateAboveMinusOne(t, 'rate', input.rate);
  requireFiniteArray(t, 'cashFlows', input.cashFlows, 1);
  checkFirstPeriod(t, input.firstPeriod);
  if (t.hasErrors) return t.fail();

  assumeTiming(t, firstPeriod);
  const presentValues = input.cashFlows.map((cf, i) => cf / growth(input.rate, i + firstPeriod));
  presentValues.forEach((p, i) =>
    t.step(`pv${i}`, `PV of cash flow ${i}`, p, `\\frac{CF_{${i}}}{(1+r)^{${i + firstPeriod}}}`),
  );
  const total = presentValues.reduce((a, b) => a + b, 0);
  t.step('npv', 'Net present value', total, 'NPV = \\sum_t \\frac{CF_t}{(1+r)^t}');
  return t.ok({ npv: total, presentValues });
}

// ---------------------------------------------------------------------------------------------

export interface IrrInput {
  cashFlows: number[];
}

export interface IrrOutput {
  /** The unique IRR, or null when the cash flows have several (see `roots`). */
  irr: number | null;
  /** Every IRR found in (-99.99%, 10 000%], ascending. */
  roots: number[];
  /** Descartes' rule: an upper bound on the number of IRRs. */
  signChanges: number;
}

/**
 * Internal rate of return. Scans a rate grid for sign changes of NPV(r), refines each with
 * Brent's method, and returns every root. Never silently picks one of several IRRs.
 */
export function irr(input: IrrInput): Result<IrrOutput> {
  const t = new Trace('cashflow.irr');
  if (!requireFiniteArray(t, 'cashFlows', input.cashFlows, 2)) return t.fail();
  const cf = input.cashFlows;
  assumeTiming(t, 0);
  t.assume(
    'solver',
    "IRR found numerically: grid scan for sign changes, refined with Brent's method.",
  );

  const sc = signChanges(cf);
  t.step('signChanges', 'Sign changes in cash flows (max. number of IRRs)', sc);
  if (sc === 0) {
    return t.fail({
      code: 'NO_SIGN_CHANGE',
      message: 'Cash flows need at least one positive and one negative value to have an IRR.',
      field: 'cashFlows',
    });
  }

  const { roots, unconverged } = findRoots((r) => npvRaw(r, cf), { grid: DEFAULT_RATE_GRID });
  if (unconverged.length > 0) {
    t.warn({
      code: 'SOLVER_NOT_CONVERGED',
      message: 'The solver did not converge in one or more intervals.',
    });
  }
  if (roots.length === 0) {
    return t.fail({
      code: 'NO_IRR',
      message:
        'No rate between -99.99% and 10 000% makes the NPV zero; these cash flows have no valid IRR.',
    });
  }
  roots.forEach((r, i) => t.step(`root${i}`, `IRR ${i + 1}`, r));
  if (roots.length > 1) {
    t.warn({
      code: 'MULTIPLE_IRR',
      message: `These cash flows have ${roots.length} IRRs (${formatPcts(roots)}). IRR is ambiguous; use NPV or MIRR instead.`,
      params: { count: roots.length },
    });
    return t.ok({ irr: null, roots, signChanges: sc });
  }
  return t.ok({ irr: roots[0]!, roots, signChanges: sc });
}

// ---------------------------------------------------------------------------------------------

export interface MirrInput {
  cashFlows: number[];
  /** Rate at which negative flows are financed (discounted to t = 0). */
  financeRate: number;
  /** Rate at which positive flows are reinvested (compounded to the final period). */
  reinvestRate: number;
}

/** Modified IRR; matches Excel MIRR(). */
export function mirr(input: MirrInput): Result<number> {
  const t = new Trace('cashflow.mirr');
  requireFiniteArray(t, 'cashFlows', input.cashFlows, 2);
  requireRateAboveMinusOne(t, 'financeRate', input.financeRate);
  requireRateAboveMinusOne(t, 'reinvestRate', input.reinvestRate);
  if (t.hasErrors) return t.fail();
  const { cashFlows: cf, financeRate: fr, reinvestRate: rr } = input;
  assumeTiming(t, 0);

  const n = cf.length - 1;
  let pvNeg = 0;
  let fvPos = 0;
  cf.forEach((c, i) => {
    if (c < 0) pvNeg += c / growth(fr, i);
    else fvPos += c * growth(rr, n - i);
  });
  t.step(
    'pvNegative',
    'PV of negative flows at the finance rate',
    pvNeg,
    '\\sum_{CF_t<0} \\frac{CF_t}{(1+f)^t}',
  );
  t.step(
    'fvPositive',
    'FV of positive flows at the reinvestment rate',
    fvPos,
    '\\sum_{CF_t>0} CF_t(1+r)^{n-t}',
  );
  if (pvNeg === 0 || fvPos === 0) {
    return t.fail({
      code: 'NO_SIGN_CHANGE',
      message: 'MIRR needs at least one positive and one negative cash flow.',
      field: 'cashFlows',
    });
  }
  const value = Math.pow(fvPos / -pvNeg, 1 / n) - 1;
  t.step('mirr', 'Modified IRR', value, 'MIRR = \\left(\\frac{FV^+}{-PV^-}\\right)^{1/n} - 1');
  return t.ok(value);
}

// ---------------------------------------------------------------------------------------------

export interface DatedCashFlow {
  /** ISO date, YYYY-MM-DD. */
  date: string;
  amount: number;
}

export interface XnpvInput {
  rate: number;
  flows: DatedCashFlow[];
}

interface ParsedFlows {
  times: number[];
  amounts: number[];
}

/**
 * Parses dated flows into year fractions from the first flow's date (ACT/365F, Excel XNPV/XIRR
 * convention). Records errors on the trace and returns null on invalid input.
 */
function parseFlows(t: Trace, flows: unknown, minLength: number): ParsedFlows | null {
  if (!Array.isArray(flows) || flows.length < minLength) {
    t.error({
      code: 'TOO_FEW_VALUES',
      message: `At least ${minLength} dated cash flows are required.`,
      params: { min: minLength },
      field: 'flows',
    });
    return null;
  }
  const dates: CivilDate[] = [];
  const amounts: number[] = [];
  flows.forEach((f: Partial<DatedCashFlow>, i) => {
    const d = typeof f?.date === 'string' ? parseISODate(f.date) : null;
    if (!d) {
      t.error({
        code: 'INVALID_DATE',
        message: `Flow ${i}: date must be YYYY-MM-DD.`,
        params: { index: i },
        field: 'flows',
      });
    } else dates.push(d);
    if (typeof f?.amount !== 'number' || !Number.isFinite(f.amount)) {
      t.error({
        code: 'INPUT_NOT_FINITE',
        message: `Flow ${i}: amount must be a finite number.`,
        params: { index: i },
        field: 'flows',
      });
    } else amounts.push(f.amount);
  });
  if (t.hasErrors) return null;

  const d0 = dates[0]!;
  const s0 = toSerial(d0);
  const early = dates.findIndex((d) => toSerial(d) < s0);
  if (early >= 0) {
    t.error({
      code: 'DATE_BEFORE_FIRST',
      message: `Flow ${early} is dated before the first flow; the first flow sets the valuation date.`,
      params: { index: early },
      field: 'flows',
    });
    return null;
  }
  t.assume(
    'dayCount',
    'Time is measured in years of 365 days from the first cash flow date (ACT/365F, as in Excel).',
  );
  return { times: dates.map((d) => actualDays(d0, d) / 365), amounts };
}

function xnpvRaw(r: number, p: ParsedFlows): number {
  let s = 0;
  for (let i = 0; i < p.amounts.length; i++) s += p.amounts[i]! / growth(r, p.times[i]!);
  return s;
}

/** NPV of irregularly dated flows, discounted to the first flow's date. Matches Excel XNPV(). */
export function xnpv(input: XnpvInput): Result<number> {
  const t = new Trace('cashflow.xnpv');
  requireRateAboveMinusOne(t, 'rate', input.rate);
  const p = parseFlows(t, input.flows, 1);
  if (!p || t.hasErrors) return t.fail();
  t.assume('rateUnit', 'The discount rate is an annual effective rate.');
  p.amounts.forEach((a, i) =>
    t.step(
      `pv${i}`,
      `PV of flow ${i} (t = ${p.times[i]!.toFixed(6)} y)`,
      a / growth(input.rate, p.times[i]!),
    ),
  );
  const value = xnpvRaw(input.rate, p);
  t.step('xnpv', 'Net present value', value, 'XNPV = \\sum_i \\frac{CF_i}{(1+r)^{(d_i-d_0)/365}}');
  return t.ok(value);
}

export interface XirrInput {
  flows: DatedCashFlow[];
}

export interface XirrOutput {
  xirr: number | null;
  roots: number[];
}

/** Annual IRR of irregularly dated flows. Matches Excel XIRR() when the IRR is unique. */
export function xirr(input: XirrInput): Result<XirrOutput> {
  const t = new Trace('cashflow.xirr');
  const p = parseFlows(t, input.flows, 2);
  if (!p) return t.fail();
  t.assume(
    'solver',
    "XIRR found numerically: grid scan for sign changes, refined with Brent's method.",
  );

  if (!p.amounts.some((a) => a > 0) || !p.amounts.some((a) => a < 0)) {
    return t.fail({
      code: 'NO_SIGN_CHANGE',
      message: 'Cash flows need at least one positive and one negative value to have an XIRR.',
      field: 'flows',
    });
  }
  const f = (r: number) => xnpvRaw(r, p);
  if (
    isIndeterminate(
      f,
      p.amounts.reduce((s, a) => s + Math.abs(a), 0),
    )
  ) {
    return t.fail({
      code: 'RATE_INDETERMINATE',
      message:
        'All cash flows fall on the same date and net to zero, so the rate cannot be solved for.',
    });
  }
  const { roots, unconverged } = findRoots(f, { grid: DEFAULT_RATE_GRID });
  if (unconverged.length > 0) {
    t.warn({
      code: 'SOLVER_NOT_CONVERGED',
      message: 'The solver did not converge in one or more intervals.',
    });
  }
  if (roots.length === 0) {
    return t.fail({
      code: 'NO_IRR',
      message: 'No annual rate between -99.99% and 10 000% makes the XNPV zero.',
    });
  }
  roots.forEach((r, i) => t.step(`root${i}`, `XIRR ${i + 1}`, r));
  if (roots.length > 1) {
    t.warn({
      code: 'MULTIPLE_IRR',
      message: `These cash flows have ${roots.length} IRRs (${formatPcts(roots)}). Use XNPV instead.`,
      params: { count: roots.length },
    });
    return t.ok({ xirr: null, roots });
  }
  return t.ok({ xirr: roots[0]!, roots });
}
