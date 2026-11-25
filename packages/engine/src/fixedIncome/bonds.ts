import { Trace, type Result } from '../core/result.js';
import { requireFinite } from '../core/validate.js';
import {
  actualDays,
  daysInMonth,
  formatISODate,
  parseISODate,
  toSerial,
  type CivilDate,
} from '../daycount/date.js';
import { days30360 } from '../daycount/conventions.js';
import { brent } from '../solvers/brent.js';

/**
 * Fixed-rate bullet bond analytics with Excel parity (PRICE / YIELD / DURATION / MDURATION /
 * ACCRINT conventions). Prices are per 100 of face value.
 *
 * Coupon dates are generated backwards from maturity in steps of 12/f months; if maturity is the
 * last day of its month, every coupon date is a month end (end-of-month rule).
 */
export type BondBasis = '30/360-US' | 'ACT/ACT' | 'ACT/360' | 'ACT/365F' | '30E/360';
export const BOND_BASES: readonly BondBasis[] = [
  '30/360-US',
  'ACT/ACT',
  'ACT/360',
  'ACT/365F',
  '30E/360',
];
export type Frequency = 1 | 2 | 4 | 12;

export interface BondInput {
  settlement: string;
  maturity: string;
  /** Annual coupon rate, e.g. 0.0575. */
  couponRate: number;
  frequency: Frequency;
  basis: BondBasis;
  /** Redemption per 100 face. Default 100. */
  redemption?: number;
  /** Provide exactly one: annual yield (bond-equivalent, compounded f times) or clean price. */
  yield?: number;
  cleanPrice?: number;
}

export interface BondSchedule {
  previousCoupon: string;
  nextCoupon: string;
  couponsRemaining: number;
  /** Days from previous coupon to settlement. */
  accruedDays: number;
  /** Days in the coupon period. */
  periodDays: number;
  /** Days from settlement to next coupon. */
  daysToNext: number;
}

export interface BondOutput {
  schedule: BondSchedule;
  yield: number;
  cleanPrice: number;
  dirtyPrice: number;
  accruedInterest: number;
  currentYield: number;
  macaulayDuration: number;
  modifiedDuration: number;
  convexity: number;
  effectiveDuration: number;
  effectiveConvexity: number;
  /** Clean price at yields around the solution, for the price-yield chart. */
  priceYieldCurve: { yield: number; cleanPrice: number }[];
}

function addMonths(c: CivilDate, months: number, eom: boolean): CivilDate {
  const idx = c.y * 12 + (c.m - 1) + months;
  const y = Math.floor(idx / 12);
  const m = (idx % 12) + 1;
  const last = daysInMonth(y, m);
  return { y, m, d: eom ? last : Math.min(c.d, last) };
}

export function couponSchedule(
  settle: CivilDate,
  maturity: CivilDate,
  f: Frequency,
  basis: BondBasis,
): BondSchedule {
  const step = 12 / f;
  const eom = maturity.d === daysInMonth(maturity.y, maturity.m);
  let k = 0;
  let next = maturity;
  let prev = maturity;
  const s = toSerial(settle);
  while (toSerial(prev) > s) {
    next = prev;
    k++;
    prev = addMonths(maturity, -step * k, eom);
  }
  const accruedActual = actualDays(prev, settle);
  let accruedDays: number;
  let periodDays: number;
  let daysToNext: number;
  switch (basis) {
    case '30/360-US':
    case '30E/360':
      accruedDays = days30360(prev, settle, basis);
      periodDays = 360 / f;
      daysToNext = periodDays - accruedDays;
      break;
    case 'ACT/ACT':
      accruedDays = accruedActual;
      periodDays = actualDays(prev, next);
      daysToNext = actualDays(settle, next);
      break;
    case 'ACT/360':
      accruedDays = accruedActual;
      periodDays = 360 / f;
      daysToNext = actualDays(settle, next);
      break;
    case 'ACT/365F':
      accruedDays = accruedActual;
      periodDays = 365 / f;
      daysToNext = actualDays(settle, next);
      break;
  }
  return {
    previousCoupon: formatISODate(prev),
    nextCoupon: formatISODate(next),
    couponsRemaining: k,
    accruedDays,
    periodDays,
    daysToNext,
  };
}

/** Dirty price per 100 at annual yield y (Excel PRICE algorithm, before subtracting accrued). */
export function dirtyPriceAt(
  y: number,
  sc: BondSchedule,
  couponRate: number,
  f: number,
  redemption: number,
): number {
  const c = (100 * couponRate) / f;
  const N = sc.couponsRemaining;
  const dsc = sc.daysToNext / sc.periodDays;
  if (N === 1) {
    // Last coupon period: money-market (simple interest) discounting, as in Excel.
    return (redemption + c) / (1 + (dsc * y) / f);
  }
  const v = 1 + y / f;
  let p = redemption / Math.pow(v, N - 1 + dsc);
  for (let k = 1; k <= N; k++) p += c / Math.pow(v, k - 1 + dsc);
  return p;
}

export function bondAnalytics(input: BondInput): Result<BondOutput> {
  const t = new Trace('fixedIncome.bond');
  const settle = typeof input.settlement === 'string' ? parseISODate(input.settlement) : null;
  const mat = typeof input.maturity === 'string' ? parseISODate(input.maturity) : null;
  if (!settle)
    t.error({
      code: 'INVALID_DATE',
      message: 'Settlement must be a valid YYYY-MM-DD date.',
      field: 'settlement',
    });
  if (!mat)
    t.error({
      code: 'INVALID_DATE',
      message: 'Maturity must be a valid YYYY-MM-DD date.',
      field: 'maturity',
    });
  requireFinite(t, 'couponRate', input.couponRate);
  if (![1, 2, 4, 12].includes(input.frequency))
    t.error({
      code: 'INVALID_FREQUENCY',
      message: 'Frequency must be 1, 2, 4 or 12.',
      field: 'frequency',
    });
  if (!BOND_BASES.includes(input.basis))
    t.error({ code: 'UNKNOWN_BASIS', message: 'Unknown day-count basis.', field: 'basis' });
  const redemption = input.redemption ?? 100;
  requireFinite(t, 'redemption', redemption);
  const hasY = input.yield !== undefined;
  const hasP = input.cleanPrice !== undefined;
  if (hasY === hasP)
    t.error({
      code: 'YIELD_OR_PRICE',
      message: 'Provide either the yield or the clean price, not both.',
      field: 'yield',
    });
  if (hasY) requireFinite(t, 'yield', input.yield);
  if (hasP && requireFinite(t, 'cleanPrice', input.cleanPrice) && input.cleanPrice! <= 0)
    t.error({
      code: 'PRICE_NOT_POSITIVE',
      message: 'Price must be positive.',
      field: 'cleanPrice',
    });
  if (t.hasErrors || !settle || !mat) return t.fail();
  if (toSerial(mat) <= toSerial(settle))
    return t.fail({
      code: 'MATURITY_BEFORE_SETTLEMENT',
      message: 'Maturity must be after settlement.',
      field: 'maturity',
    });
  if (input.couponRate < 0)
    return t.fail({
      code: 'NEGATIVE_COUPON',
      message: 'Coupon rate cannot be negative.',
      field: 'couponRate',
    });
  if (redemption <= 0)
    return t.fail({
      code: 'REDEMPTION_NOT_POSITIVE',
      message: 'Redemption must be positive.',
      field: 'redemption',
    });

  const f = input.frequency;
  const sc = couponSchedule(settle, mat, f, input.basis);
  const accruedInterest = ((100 * input.couponRate) / f) * (sc.accruedDays / sc.periodDays);
  t.assume(
    'quote',
    'Prices per 100 face; yields are annual, compounded at the coupon frequency (bond-equivalent).',
  );
  t.assume(
    'schedule',
    'Coupon dates step back from maturity by 12/f months (end-of-month rule when maturity is a month end).',
  );
  t.assume(
    'excel',
    `Day count ${input.basis}; formulas follow Excel PRICE / YIELD / DURATION, including simple-interest discounting in the final coupon period.`,
  );
  t.step(
    'pcd',
    `Previous coupon ${sc.previousCoupon}, next ${sc.nextCoupon}`,
    sc.couponsRemaining,
    'N = coupons remaining',
  );
  t.step(
    'accrued',
    'Accrued interest',
    accruedInterest,
    'AI = \\frac{100c}{f} \\cdot \\frac{A}{E}',
  );

  const priceAt = (y: number) =>
    dirtyPriceAt(y, sc, input.couponRate, f, redemption) - accruedInterest;
  let y: number;
  if (hasY) {
    y = input.yield!;
    if (y <= -f)
      return t.fail({
        code: 'RATE_OUT_OF_DOMAIN',
        message: 'Yield is out of range.',
        field: 'yield',
      });
  } else {
    const target = input.cleanPrice!;
    const g = (x: number) => priceAt(x) - target;
    // Price is strictly decreasing in yield: bracket by expanding outwards from the coupon rate.
    let lo = -0.5;
    let hi = 1;
    while (g(hi) > 0 && hi < 100) hi *= 2;
    while (g(lo) < 0 && lo > -0.99 * f) lo = (lo - f) / 2;
    const root = brent(g, lo, hi, { xtol: 1e-14 });
    if (!root || !root.converged)
      return t.fail({
        code: 'NO_SOLUTION',
        message: 'No yield reproduces this price.',
        field: 'cleanPrice',
      });
    y = root.root;
    t.assume(
      'solver',
      "Yield solved with Brent's method on the price–yield function (tolerance 1e-14).",
    );
  }
  const dirty = dirtyPriceAt(y, sc, input.couponRate, f, redemption);
  const clean = dirty - accruedInterest;

  // Duration and convexity from the cash-flow schedule (dirty-price weights).
  const c = (100 * input.couponRate) / f;
  const dsc = sc.daysToNext / sc.periodDays;
  const v = 1 + y / f;
  let wt = 0;
  let conv = 0;
  let pv = 0;
  for (let k = 1; k <= sc.couponsRemaining; k++) {
    const n = k - 1 + dsc; // periods to the cash flow
    const cf = c + (k === sc.couponsRemaining ? redemption : 0);
    const disc = cf / Math.pow(v, n);
    pv += disc;
    wt += (n / f) * disc;
    conv += (cf * n * (n + 1)) / Math.pow(v, n + 2);
  }
  const macaulayDuration = wt / pv;
  const modifiedDuration = macaulayDuration / v;
  const convexity = conv / (pv * f * f);
  const dy = 0.0001;
  const pUp = dirtyPriceAt(y + dy, sc, input.couponRate, f, redemption);
  const pDn = dirtyPriceAt(y - dy, sc, input.couponRate, f, redemption);
  const effectiveDuration = (pDn - pUp) / (2 * dirty * dy);
  const effectiveConvexity = (pDn + pUp - 2 * dirty) / (dirty * dy * dy);
  const currentYield = (100 * input.couponRate) / clean;
  const priceYieldCurve = Array.from({ length: 61 }, (_, i) => {
    const yy = Math.max(-0.5, y - 0.03 + (i * 0.06) / 60);
    return {
      yield: yy,
      cleanPrice: dirtyPriceAt(yy, sc, input.couponRate, f, redemption) - accruedInterest,
    };
  });

  t.step('yield', 'Yield to maturity', y);
  t.step(
    'dirty',
    'Dirty (full) price',
    dirty,
    'P_{dirty} = \\sum_k \\frac{CF_k}{(1+y/f)^{k-1+DSC/E}}',
  );
  t.step('clean', 'Clean (quoted) price', clean, 'P_{clean} = P_{dirty} - AI');
  t.step(
    'mac',
    'Macaulay duration (years)',
    macaulayDuration,
    'D = \\frac{1}{P}\\sum_k t_k\\,PV_k',
  );
  t.step('mod', 'Modified duration', modifiedDuration, 'D_{mod} = \\frac{D}{1+y/f}');
  t.step('convexity', 'Convexity', convexity);
  t.step(
    'effDur',
    'Effective duration (±1 bp)',
    effectiveDuration,
    '\\frac{P_- - P_+}{2P_0\\Delta y}',
  );
  if (sc.couponsRemaining === 1) {
    t.warn({
      code: 'FINAL_PERIOD',
      message:
        'Only one coupon remains: Excel prices it with simple interest; analytic duration uses compound discounting.',
    });
  }
  return t.ok({
    schedule: sc,
    yield: y,
    cleanPrice: clean,
    dirtyPrice: dirty,
    accruedInterest,
    currentYield,
    macaulayDuration,
    modifiedDuration,
    convexity,
    effectiveDuration,
    effectiveConvexity,
    priceYieldCurve,
  });
}
