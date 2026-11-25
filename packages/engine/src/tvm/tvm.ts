import { annuityFactor, growth } from '../core/math.js';
import { Trace, type Result } from '../core/result.js';
import { requireFinite, requireRateAboveMinusOne } from '../core/validate.js';
import { DEFAULT_RATE_GRID, findRoots, isIndeterminate } from '../solvers/findRoots.js';

/**
 * Time value of money, using the Excel/financial-calculator sign convention:
 * cash received is positive, cash paid is negative, and every solution satisfies
 *
 *   pv·(1+r)^n + pmt·(1 + r·k)·((1+r)^n − 1)/r + fv = 0,   k = 1 if payments at period start else 0
 *
 * `rate` is the rate per period and `nper` the number of periods (both in the same unit).
 */
export type PaymentTiming = 'end' | 'begin';

export interface TvmBase {
  timing?: PaymentTiming;
}

const k = (timing: PaymentTiming | undefined) => (timing === 'begin' ? 1 : 0);

function assumeConventions(t: Trace, timing: PaymentTiming | undefined): void {
  t.assume('signConvention', 'Cash received is positive, cash paid is negative.');
  t.assume('rateUnit', 'Rate is per period; number of periods uses the same period length.');
  t.assume(
    'timing',
    timing === 'begin'
      ? 'Payments occur at the beginning of each period (annuity due).'
      : 'Payments occur at the end of each period (ordinary annuity).',
  );
}

function checkTiming(t: Trace, timing: unknown): void {
  if (timing !== undefined && timing !== 'end' && timing !== 'begin') {
    t.error({
      code: 'INVALID_TIMING',
      message: "timing must be 'end' or 'begin'.",
      field: 'timing',
    });
  }
}

function checkNper(t: Trace, n: unknown): void {
  if (requireFinite(t, 'nper', n) && n <= 0) {
    t.error({
      code: 'NPER_NOT_POSITIVE',
      message: 'Number of periods must be greater than zero.',
      field: 'nper',
    });
  }
}

/** Residual of the TVM equation; zero at a consistent set of inputs. */
export function tvmResidual(
  r: number,
  n: number,
  p: number,
  pvv: number,
  fvv: number,
  timing?: PaymentTiming,
): number {
  return pvv * growth(r, n) + p * (1 + r * k(timing)) * annuityFactor(r, n) + fvv;
}

function factors(t: Trace, r: number, n: number, timing: PaymentTiming | undefined) {
  const g = growth(r, n);
  const af = annuityFactor(r, n) * (1 + r * k(timing));
  t.step('growth', 'Growth factor', g, '(1+r)^n');
  t.step('annuityFactor', 'Annuity factor', af, 'AF = (1+rk)\\frac{(1+r)^n-1}{r}');
  return { g, af };
}

// ---------------------------------------------------------------------------------------------

export interface FvInput extends TvmBase {
  rate: number;
  nper: number;
  pmt?: number;
  pv?: number;
}

export function fv(input: FvInput): Result<number> {
  const t = new Trace('tvm.fv');
  const { rate: r, nper: n, pmt: p = 0, pv: pvv = 0, timing } = input;
  requireRateAboveMinusOne(t, 'rate', r);
  checkNper(t, n);
  requireFinite(t, 'pmt', p);
  requireFinite(t, 'pv', pvv);
  checkTiming(t, timing);
  if (t.hasErrors) return t.fail();

  assumeConventions(t, timing);
  const { g, af } = factors(t, r, n, timing);
  const value = -(pvv * g + p * af);
  t.step('fv', 'Future value', value, 'FV = -(PV(1+r)^n + PMT \\cdot AF)');
  return t.ok(value);
}

export interface PvInput extends TvmBase {
  rate: number;
  nper: number;
  pmt?: number;
  fv?: number;
}

export function pv(input: PvInput): Result<number> {
  const t = new Trace('tvm.pv');
  const { rate: r, nper: n, pmt: p = 0, fv: fvv = 0, timing } = input;
  requireRateAboveMinusOne(t, 'rate', r);
  checkNper(t, n);
  requireFinite(t, 'pmt', p);
  requireFinite(t, 'fv', fvv);
  checkTiming(t, timing);
  if (t.hasErrors) return t.fail();

  assumeConventions(t, timing);
  const { g, af } = factors(t, r, n, timing);
  const value = -(fvv + p * af) / g;
  t.step('pv', 'Present value', value, 'PV = -\\frac{FV + PMT \\cdot AF}{(1+r)^n}');
  return t.ok(value);
}

export interface PmtInput extends TvmBase {
  rate: number;
  nper: number;
  pv?: number;
  fv?: number;
}

export function pmt(input: PmtInput): Result<number> {
  const t = new Trace('tvm.pmt');
  const { rate: r, nper: n, pv: pvv = 0, fv: fvv = 0, timing } = input;
  requireRateAboveMinusOne(t, 'rate', r);
  checkNper(t, n);
  requireFinite(t, 'pv', pvv);
  requireFinite(t, 'fv', fvv);
  checkTiming(t, timing);
  if (t.hasErrors) return t.fail();

  assumeConventions(t, timing);
  const { g, af } = factors(t, r, n, timing);
  const value = -(pvv * g + fvv) / af;
  t.step('pmt', 'Payment per period', value, 'PMT = -\\frac{PV(1+r)^n + FV}{AF}');
  return t.ok(value);
}

export interface NperInput extends TvmBase {
  rate: number;
  pmt?: number;
  pv?: number;
  fv?: number;
}

export function nper(input: NperInput): Result<number> {
  const t = new Trace('tvm.nper');
  const { rate: r, pmt: p = 0, pv: pvv = 0, fv: fvv = 0, timing } = input;
  requireRateAboveMinusOne(t, 'rate', r);
  requireFinite(t, 'pmt', p);
  requireFinite(t, 'pv', pvv);
  requireFinite(t, 'fv', fvv);
  checkTiming(t, timing);
  if (t.hasErrors) return t.fail();
  assumeConventions(t, timing);

  let value: number;
  if (r === 0) {
    if (p === 0) {
      return t.fail({
        code: 'NO_SOLUTION',
        message: 'With a zero rate and no payment, the number of periods is undefined.',
      });
    }
    value = -(pvv + fvv) / p;
    t.step('nper', 'Number of periods (zero rate)', value, 'n = -\\frac{PV + FV}{PMT}');
  } else {
    const a = (p * (1 + r * k(timing))) / r;
    const ratio = (a - fvv) / (pvv + a);
    t.step(
      'ratio',
      'Required growth (1+r)^n',
      ratio,
      '(1+r)^n = \\frac{A - FV}{PV + A},\\; A = \\frac{PMT(1+rk)}{r}',
    );
    if (!Number.isFinite(ratio) || ratio <= 0) {
      return t.fail({
        code: 'NO_SOLUTION',
        message: 'No number of periods satisfies these inputs (check the signs of PV, PMT and FV).',
      });
    }
    value = Math.log(ratio) / Math.log1p(r);
    t.step('nper', 'Number of periods', value, 'n = \\frac{\\ln(\\text{ratio})}{\\ln(1+r)}');
  }
  if (value < 0) {
    t.warn({
      code: 'NEGATIVE_NPER',
      message:
        'The solution has a negative number of periods: the inputs describe a target that was already passed.',
      params: { nper: value },
    });
  }
  return t.ok(value);
}

export interface RateInput extends TvmBase {
  nper: number;
  pmt?: number;
  pv?: number;
  fv?: number;
}

export interface RateOutput {
  /** The unique solution, or null when there are several (see `roots`). */
  rate: number | null;
  /** Every solution found in (-99.99%, 10 000%]. */
  roots: number[];
}

export function rate(input: RateInput): Result<RateOutput> {
  const t = new Trace('tvm.rate');
  const { nper: n, pmt: p = 0, pv: pvv = 0, fv: fvv = 0, timing } = input;
  checkNper(t, n);
  requireFinite(t, 'pmt', p);
  requireFinite(t, 'pv', pvv);
  requireFinite(t, 'fv', fvv);
  checkTiming(t, timing);
  if (t.hasErrors) return t.fail();
  assumeConventions(t, timing);
  t.assume(
    'solver',
    "Rate found numerically: grid scan for sign changes, refined with Brent's method.",
  );

  const f = (r: number) => tvmResidual(r, n, p, pvv, fvv, timing);
  if (isIndeterminate(f, Math.abs(pvv) + Math.abs(p) * n + Math.abs(fvv))) {
    return t.fail({
      code: 'RATE_INDETERMINATE',
      message:
        'The interest rate has no effect on these inputs (all cash flows fall at the same time), so it cannot be solved for.',
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
      code: 'NO_SOLUTION',
      message: 'No interest rate between -99.99% and 10 000% satisfies these inputs.',
    });
  }
  roots.forEach((x, i) => t.step(`root${i}`, `Solution ${i + 1}`, x));
  if (roots.length > 1) {
    t.warn({
      code: 'MULTIPLE_SOLUTIONS',
      message: `Several rates satisfy these inputs: ${formatPcts(roots)}.`,
      params: { count: roots.length },
    });
    return t.ok({ rate: null, roots });
  }
  return t.ok({ rate: roots[0]!, roots });
}

export function formatPcts(xs: readonly number[]): string {
  return xs.map((x) => (x * 100).toFixed(4) + '%').join(', ');
}
