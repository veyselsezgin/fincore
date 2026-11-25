import { Trace, type Result } from '../core/result.js';
import { requireFinite } from '../core/validate.js';

export interface CapmInput {
  /** Risk-free rate, e.g. 0.04. */
  riskFree: number;
  beta: number;
  /** Equity (market) risk premium E[Rm] − Rf, e.g. 0.055. */
  marketRiskPremium: number;
}

/** Cost of equity by CAPM: Re = Rf + β · ERP. */
export function capm(input: CapmInput): Result<number> {
  const t = new Trace('valuation.capm');
  requireFinite(t, 'riskFree', input.riskFree);
  requireFinite(t, 'beta', input.beta);
  requireFinite(t, 'marketRiskPremium', input.marketRiskPremium);
  if (t.hasErrors) return t.fail();
  const { riskFree: rf, beta, marketRiskPremium: erp } = input;

  t.assume(
    'capm',
    'Cost of equity follows the single-factor CAPM; beta and premium are your inputs, not market data.',
  );
  if (beta < 0) {
    t.warn({
      code: 'NEGATIVE_BETA',
      message: 'Beta is negative: the asset is expected to move against the market.',
      field: 'beta',
    });
  }
  if (erp < 0) {
    t.warn({
      code: 'NEGATIVE_PREMIUM',
      message: 'The market risk premium is negative, which is unusual.',
      field: 'marketRiskPremium',
    });
  }
  const re = rf + beta * erp;
  t.step('riskPremium', 'Equity risk premium for this stock', beta * erp, '\\beta \\cdot ERP');
  t.step('costOfEquity', 'Cost of equity', re, 'R_e = R_f + \\beta \\cdot ERP');
  return t.ok(re);
}

export interface WaccInput {
  /** Market value of equity. */
  equityValue: number;
  /** Market value of debt. */
  debtValue: number;
  costOfEquity: number;
  /** Pre-tax cost of debt (yield on debt). */
  preTaxCostOfDebt: number;
  /** Marginal corporate tax rate, e.g. 0.25. */
  taxRate: number;
}

export interface WaccOutput {
  wacc: number;
  weightEquity: number;
  weightDebt: number;
  afterTaxCostOfDebt: number;
  costOfEquity: number;
}

/** WACC = E/V · Re + D/V · Rd · (1 − T). */
export function wacc(input: WaccInput): Result<WaccOutput> {
  const t = new Trace('valuation.wacc');
  const ok = [
    requireFinite(t, 'equityValue', input.equityValue),
    requireFinite(t, 'debtValue', input.debtValue),
    requireFinite(t, 'costOfEquity', input.costOfEquity),
    requireFinite(t, 'preTaxCostOfDebt', input.preTaxCostOfDebt),
    requireFinite(t, 'taxRate', input.taxRate),
  ].every(Boolean);
  if (!ok) return t.fail();
  const {
    equityValue: E,
    debtValue: D,
    costOfEquity: re,
    preTaxCostOfDebt: rd,
    taxRate: tax,
  } = input;
  if (E < 0)
    t.error({
      code: 'NEGATIVE_VALUE',
      message: 'Equity value cannot be negative.',
      field: 'equityValue',
    });
  if (D < 0)
    t.error({
      code: 'NEGATIVE_VALUE',
      message: 'Debt value cannot be negative.',
      field: 'debtValue',
    });
  if (tax < 0 || tax >= 1)
    t.error({
      code: 'TAX_OUT_OF_RANGE',
      message: 'Tax rate must be from 0% to below 100%.',
      field: 'taxRate',
    });
  if (!t.hasErrors && E + D === 0)
    t.error({
      code: 'ZERO_CAPITAL',
      message: 'Equity plus debt must be greater than zero.',
      field: 'equityValue',
    });
  if (t.hasErrors) return t.fail();

  t.assume('weights', 'Weights use the market values you entered for equity and debt.');
  t.assume('taxShield', 'Interest is tax-deductible at the marginal tax rate.');
  const V = E + D;
  const we = E / V;
  const wd = D / V;
  const rdAfter = rd * (1 - tax);
  t.step('value', 'Total capital', V, 'V = E + D');
  t.step('weightEquity', 'Equity weight', we, 'w_E = E / V');
  t.step('weightDebt', 'Debt weight', wd, 'w_D = D / V');
  t.step('afterTaxCostOfDebt', 'After-tax cost of debt', rdAfter, 'R_d(1-T)');
  const w = we * re + wd * rdAfter;
  t.step('wacc', 'WACC', w, 'WACC = w_E R_e + w_D R_d (1-T)');
  if (rd > re) {
    t.warn({
      code: 'DEBT_COSTLIER_THAN_EQUITY',
      message: 'The cost of debt is above the cost of equity, which is unusual. Check the inputs.',
    });
  }
  return t.ok({
    wacc: w,
    weightEquity: we,
    weightDebt: wd,
    afterTaxCostOfDebt: rdAfter,
    costOfEquity: re,
  });
}

export type WaccFromCapmInput = CapmInput & Omit<WaccInput, 'costOfEquity'>;

/** CAPM cost of equity fed into WACC, as one traced calculation. */
export function waccFromCapm(input: WaccFromCapmInput): Result<WaccOutput> {
  const t = new Trace('valuation.waccFromCapm');
  const re = t.include('capm', capm(input));
  if (re === null) return t.fail();
  const w = t.include('wacc', wacc({ ...input, costOfEquity: re }));
  if (w === null) return t.fail();
  return t.ok(w);
}
