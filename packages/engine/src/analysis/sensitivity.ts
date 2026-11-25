import { Trace, type Result } from '../core/result.js';
import { requireFiniteArray, requireRateAboveMinusOne } from '../core/validate.js';
import { npvRaw } from '../cashflow/cashflow.js';

export interface NpvSensitivityInput {
  rate: number;
  cashFlows: number[];
  /** Relative shocks to cash flows t ≥ 1, e.g. [-0.2, -0.1, 0, 0.1, 0.2]. */
  cashFlowShocks: number[];
  /** Relative shocks to the discount rate: r' = r · (1 + s). */
  rateShocks: number[];
  firstPeriod?: 0 | 1;
}

export interface NpvSensitivityOutput {
  baseNpv: number;
  /** npv[i][j]: cash-flow shock i, rate shock j. */
  npv: number[][];
  rates: number[];
  cashFlowShocks: number[];
  rateShocks: number[];
  /** Share of grid cells with NPV > 0. */
  positiveShare: number;
}

/** Two-way NPV sensitivity: scale future cash flows and the discount rate together. */
export function npvSensitivity(input: NpvSensitivityInput): Result<NpvSensitivityOutput> {
  const t = new Trace('analysis.npvSensitivity');
  const fp = input.firstPeriod ?? 0;
  requireRateAboveMinusOne(t, 'rate', input.rate);
  requireFiniteArray(t, 'cashFlows', input.cashFlows, 2);
  requireFiniteArray(t, 'cashFlowShocks', input.cashFlowShocks, 1);
  requireFiniteArray(t, 'rateShocks', input.rateShocks, 1);
  if (t.hasErrors) return t.fail();

  const rates = input.rateShocks.map((s) => input.rate * (1 + s));
  const bad = rates.findIndex((r) => r <= -1);
  if (bad >= 0) {
    return t.fail({
      code: 'RATE_OUT_OF_DOMAIN',
      message: 'A shocked rate falls at or below -100%.',
      field: 'rateShocks',
    });
  }

  t.assume(
    'cashFlowShock',
    'Cash-flow shocks scale every cash flow after the first (t ≥ 1); the initial flow is held fixed.',
  );
  t.assume('rateShock', 'Rate shocks are relative: a +20% shock on 10% gives 12%, not 30%.');
  t.assume('oneAtATime', 'All future cash flows move together by the same percentage.');

  const [c0, ...rest] = input.cashFlows as [number, ...number[]];
  const npv = input.cashFlowShocks.map((s) =>
    rates.map((r) => npvRaw(r, [c0, ...rest.map((c) => c * (1 + s))], fp)),
  );
  const baseNpv = npvRaw(input.rate, input.cashFlows, fp);
  const cells = npv.flat();
  const positiveShare = cells.filter((v) => v > 0).length / cells.length;
  t.step('baseNpv', 'NPV with no shocks', baseNpv);
  t.step('range', 'Lowest NPV in the grid', Math.min(...cells));
  t.step('rangeHigh', 'Highest NPV in the grid', Math.max(...cells));
  t.step('positiveShare', 'Share of scenarios with NPV > 0', positiveShare);
  return t.ok({
    baseNpv,
    npv,
    rates,
    cashFlowShocks: [...input.cashFlowShocks],
    rateShocks: [...input.rateShocks],
    positiveShare,
  });
}

/** Symmetric shock list, e.g. symmetricShocks(0.2, 5) → [-0.2, -0.1, 0, 0.1, 0.2]. */
export function symmetricShocks(range: number, steps: number): number[] {
  const n = Math.max(2, Math.floor(steps));
  return Array.from({ length: n }, (_, i) =>
    Number((-range + (2 * range * i) / (n - 1)).toFixed(12)),
  );
}
