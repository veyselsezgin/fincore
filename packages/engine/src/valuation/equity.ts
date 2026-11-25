import { growth } from '../core/math.js';
import { Trace, type Result } from '../core/result.js';
import { requireFinite, requireFiniteArray } from '../core/validate.js';

export interface GordonInput {
  /** Most recent dividend D0 (the next is D0 × (1 + g)). */
  dividend: number;
  requiredReturn: number;
  growth: number;
}

/** Gordon growth model: V0 = D1 / (r − g). */
export function gordonGrowth(input: GordonInput): Result<number> {
  const t = new Trace('valuation.gordon');
  requireFinite(t, 'dividend', input.dividend);
  requireFinite(t, 'requiredReturn', input.requiredReturn);
  requireFinite(t, 'growth', input.growth);
  if (t.hasErrors) return t.fail();
  if (input.requiredReturn <= input.growth) {
    return t.fail({
      code: 'GROWTH_NOT_BELOW_RATE',
      message: 'The required return must exceed the growth rate.',
      field: 'growth',
    });
  }
  t.assume('gordon', 'Dividends grow at a constant rate forever; D1 = D0 × (1 + g).');
  const d1 = input.dividend * (1 + input.growth);
  const v = d1 / (input.requiredReturn - input.growth);
  t.step('d1', 'Next dividend D1', d1, 'D_1 = D_0(1+g)');
  t.step('v0', 'Intrinsic value', v, 'V_0 = \\frac{D_1}{r - g}');
  return t.ok(v);
}

export interface MultiStageInput {
  dividend: number;
  requiredReturn: number;
  /** High-growth stages, applied in order: each grows dividends at `growth` for `years`. */
  stages: { growth: number; years: number }[];
  terminalGrowth: number;
}

export interface MultiStageOutput {
  value: number;
  pvExplicit: number;
  terminalValue: number;
  pvTerminal: number;
  dividends: { year: number; dividend: number; pv: number }[];
}

/** Multi-stage DDM: explicit dividends through the stages, then Gordon terminal value. */
export function multiStageDdm(input: MultiStageInput): Result<MultiStageOutput> {
  const t = new Trace('valuation.multiStageDdm');
  requireFinite(t, 'dividend', input.dividend);
  requireFinite(t, 'requiredReturn', input.requiredReturn);
  requireFinite(t, 'terminalGrowth', input.terminalGrowth);
  if (!Array.isArray(input.stages) || input.stages.length === 0)
    t.error({ code: 'NO_STAGES', message: 'Add at least one growth stage.', field: 'stages' });
  else
    input.stages.forEach((s, i) => {
      if (
        !Number.isFinite(s.growth) ||
        !Number.isInteger(s.years) ||
        s.years < 1 ||
        s.years > 100
      ) {
        t.error({
          code: 'INVALID_STAGE',
          message: `Stage ${i + 1}: growth must be a number and years a whole number from 1 to 100.`,
          field: 'stages',
        });
      }
    });
  if (t.hasErrors) return t.fail();
  const r = input.requiredReturn;
  if (r <= -1)
    return t.fail({
      code: 'RATE_OUT_OF_DOMAIN',
      message: 'Required return must exceed -100%.',
      field: 'requiredReturn',
    });
  if (r <= input.terminalGrowth)
    return t.fail({
      code: 'GROWTH_NOT_BELOW_RATE',
      message: 'Terminal growth must be below the required return.',
      field: 'terminalGrowth',
    });
  t.assume(
    'ddm',
    'Dividends paid at year end; after the final stage they grow at the terminal rate forever (Gordon).',
  );
  const dividends: MultiStageOutput['dividends'] = [];
  let d = input.dividend;
  let year = 0;
  for (const s of input.stages) {
    for (let k = 0; k < s.years; k++) {
      year++;
      d *= 1 + s.growth;
      dividends.push({ year, dividend: d, pv: d / growth(r, year) });
    }
  }
  const pvExplicit = dividends.reduce((s, x) => s + x.pv, 0);
  const terminalValue = (d * (1 + input.terminalGrowth)) / (r - input.terminalGrowth);
  const pvTerminal = terminalValue / growth(r, year);
  t.step('pvExplicit', 'PV of explicit dividends', pvExplicit);
  t.step('tv', `Terminal value at year ${year}`, terminalValue, 'TV_N = \\frac{D_N(1+g)}{r-g}');
  t.step('pvTv', 'PV of terminal value', pvTerminal);
  t.step('value', 'Intrinsic value', pvExplicit + pvTerminal);
  if (pvTerminal / (pvExplicit + pvTerminal) > 0.75)
    t.warn({
      code: 'TV_DOMINATES',
      message:
        'Over 75% of the value comes from the terminal value: the result is very sensitive to the terminal assumptions.',
    });
  return t.ok({ value: pvExplicit + pvTerminal, pvExplicit, terminalValue, pvTerminal, dividends });
}

export interface DcfValuationInput {
  kind: 'FCFF' | 'FCFE';
  /** Forecast free cash flows for years 1..N. */
  cashFlows: number[];
  /** WACC for FCFF, cost of equity for FCFE. */
  discountRate: number;
  terminalGrowth: number;
  /** FCFF only: debt minus cash, subtracted from firm value. */
  netDebt: number;
  shares: number;
}

export interface DcfValuationOutput {
  pvForecast: number;
  terminalValue: number;
  pvTerminal: number;
  /** Enterprise value (FCFF) or equity value (FCFE). */
  presentValue: number;
  equityValue: number;
  valuePerShare: number;
  terminalShare: number;
}

/** Free-cash-flow valuation (FCFF at WACC → enterprise value; FCFE at Re → equity value). */
export function dcfValuation(input: DcfValuationInput): Result<DcfValuationOutput> {
  const t = new Trace('valuation.dcf');
  requireFiniteArray(t, 'cashFlows', input.cashFlows, 1);
  requireFinite(t, 'discountRate', input.discountRate);
  requireFinite(t, 'terminalGrowth', input.terminalGrowth);
  requireFinite(t, 'netDebt', input.netDebt);
  requireFinite(t, 'shares', input.shares);
  if (input.kind !== 'FCFF' && input.kind !== 'FCFE')
    t.error({ code: 'INVALID_KIND', message: 'kind must be FCFF or FCFE.', field: 'kind' });
  if (t.hasErrors) return t.fail();
  const r = input.discountRate;
  if (r <= -1)
    return t.fail({
      code: 'RATE_OUT_OF_DOMAIN',
      message: 'Discount rate must exceed -100%.',
      field: 'discountRate',
    });
  if (r <= input.terminalGrowth)
    return t.fail({
      code: 'GROWTH_NOT_BELOW_RATE',
      message: 'Terminal growth must be below the discount rate.',
      field: 'terminalGrowth',
    });
  if (input.shares <= 0)
    return t.fail({
      code: 'SHARES_NOT_POSITIVE',
      message: 'Shares outstanding must be positive.',
      field: 'shares',
    });
  const fcff = input.kind === 'FCFF';
  t.assume(
    'dcf',
    fcff
      ? 'FCFF discounted at WACC gives enterprise value; equity = EV − net debt.'
      : 'FCFE discounted at the cost of equity gives equity value directly (net debt not subtracted).',
  );
  t.assume('tv', 'Year-end flows; terminal value by Gordon growth on the year N+1 cash flow.');
  const n = input.cashFlows.length;
  const pvForecast = input.cashFlows.reduce((s, c, i) => s + c / growth(r, i + 1), 0);
  const terminalValue =
    (input.cashFlows[n - 1]! * (1 + input.terminalGrowth)) / (r - input.terminalGrowth);
  const pvTerminal = terminalValue / growth(r, n);
  const presentValue = pvForecast + pvTerminal;
  const equityValue = fcff ? presentValue - input.netDebt : presentValue;
  t.step('pvForecast', 'PV of forecast cash flows', pvForecast);
  t.step('tv', 'Terminal value', terminalValue, 'TV_N = \\frac{CF_N(1+g)}{r-g}');
  t.step('pvTv', 'PV of terminal value', pvTerminal);
  t.step('pv', fcff ? 'Enterprise value' : 'Equity value', presentValue);
  if (fcff) t.step('equity', 'Equity value = EV − net debt', equityValue);
  t.step('perShare', 'Value per share', equityValue / input.shares);
  const terminalShare = pvTerminal / presentValue;
  if (terminalShare > 0.75)
    t.warn({
      code: 'TV_DOMINATES',
      message: `${(terminalShare * 100).toFixed(0)}% of the value is terminal value: test the growth and discount-rate assumptions.`,
    });
  if (equityValue < 0)
    t.warn({ code: 'NEGATIVE_EQUITY_VALUE', message: 'Net debt exceeds enterprise value.' });
  return t.ok({
    pvForecast,
    terminalValue,
    pvTerminal,
    presentValue,
    equityValue,
    valuePerShare: equityValue / input.shares,
    terminalShare,
  });
}
