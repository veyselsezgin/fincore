import { Trace, type Result } from '../core/result.js';
import { requireFinite } from '../core/validate.js';

/**
 * Operating / financial leverage and break-even (CFA Corporate Issuers definitions).
 * Fixed operating costs include depreciation; fixed financial cost = interest.
 */
export interface LeverageInput {
  units: number;
  price: number;
  variableCost: number;
  fixedCosts: number;
  interest: number;
  taxRate: number;
  shares: number;
}

export interface LeverageOutput {
  contributionMargin: number;
  ebit: number;
  netIncome: number;
  eps: number;
  dol: number | null;
  dfl: number | null;
  dcl: number | null;
  operatingBreakeven: number | null;
  breakeven: number | null;
}

export function leverage(input: LeverageInput): Result<LeverageOutput> {
  const t = new Trace('corporate.leverage');
  for (const k of [
    'units',
    'price',
    'variableCost',
    'fixedCosts',
    'interest',
    'taxRate',
    'shares',
  ] as const)
    requireFinite(t, k, input[k]);
  if (t.hasErrors) return t.fail();
  const {
    units: Q,
    price: P,
    variableCost: V,
    fixedCosts: F,
    interest: C,
    taxRate: T,
    shares,
  } = input;
  if (Q < 0)
    t.error({ code: 'NEGATIVE_UNITS', message: 'Units cannot be negative.', field: 'units' });
  if (F < 0 || C < 0)
    t.error({
      code: 'NEGATIVE_COST',
      message: 'Fixed costs and interest cannot be negative.',
      field: F < 0 ? 'fixedCosts' : 'interest',
    });
  if (T < 0 || T >= 1)
    t.error({
      code: 'TAX_OUT_OF_RANGE',
      message: 'Tax rate must be from 0% to below 100%.',
      field: 'taxRate',
    });
  if (shares <= 0)
    t.error({
      code: 'SHARES_NOT_POSITIVE',
      message: 'Shares outstanding must be positive.',
      field: 'shares',
    });
  if (t.hasErrors) return t.fail();

  t.assume(
    'costs',
    'Fixed operating costs include depreciation; interest is the only fixed financial cost.',
  );
  t.assume('point', 'DOL, DFL and DCL are point elasticities at the entered sales volume.');
  const cmUnit = P - V;
  const contributionMargin = Q * cmUnit;
  const ebit = contributionMargin - F;
  const netIncome = (ebit - C) * (1 - T);
  const eps = netIncome / shares;
  const dol = ebit === 0 ? null : contributionMargin / ebit;
  const dfl = ebit - C === 0 ? null : ebit / (ebit - C);
  const dcl = dol === null || dfl === null ? null : dol * dfl;
  const operatingBreakeven = cmUnit > 0 ? F / cmUnit : null;
  const breakeven = cmUnit > 0 ? (F + C) / cmUnit : null;
  if (cmUnit <= 0)
    t.warn({
      code: 'NO_CONTRIBUTION',
      message: 'Price does not exceed variable cost per unit: no break-even exists.',
    });
  if (ebit <= 0)
    t.warn({
      code: 'BELOW_OPERATING_BREAKEVEN',
      message:
        'Sales are at or below operating break-even: DOL is negative or undefined and loses its usual meaning.',
    });
  t.step('cm', 'Contribution margin', contributionMargin, 'Q(P - V)');
  t.step('ebit', 'EBIT', ebit, 'Q(P - V) - F');
  if (dol !== null)
    t.step('dol', 'Degree of operating leverage', dol, 'DOL = \\frac{Q(P-V)}{Q(P-V)-F}');
  if (dfl !== null)
    t.step('dfl', 'Degree of financial leverage', dfl, 'DFL = \\frac{EBIT}{EBIT - C}');
  if (dcl !== null) t.step('dcl', 'Degree of total leverage', dcl, 'DTL = DOL \\times DFL');
  if (operatingBreakeven !== null)
    t.step('obe', 'Operating break-even (units)', operatingBreakeven, 'Q_{OBE} = \\frac{F}{P-V}');
  if (breakeven !== null)
    t.step('be', 'Break-even incl. interest (units)', breakeven, 'Q_{BE} = \\frac{F + C}{P-V}');
  return t.ok({
    contributionMargin,
    ebit,
    netIncome,
    eps,
    dol,
    dfl,
    dcl,
    operatingBreakeven,
    breakeven,
  });
}

export interface FinancingPlan {
  name: string;
  interest: number;
  shares: number;
}

export interface EbitEpsInput {
  planA: FinancingPlan;
  planB: FinancingPlan;
  taxRate: number;
  /** EBIT at which to compare the plans. */
  expectedEbit: number;
}

export interface EbitEpsOutput {
  indifferenceEbit: number | null;
  indifferenceEps: number | null;
  epsA: number;
  epsB: number;
  preferredAtExpected: 'A' | 'B' | 'tie';
}

export const epsAt = (ebit: number, plan: FinancingPlan, tax: number) =>
  ((ebit - plan.interest) * (1 - tax)) / plan.shares;

/** EBIT-EPS indifference: (EBIT − I_A)(1 − T)/N_A = (EBIT − I_B)(1 − T)/N_B. */
export function ebitEps(input: EbitEpsInput): Result<EbitEpsOutput> {
  const t = new Trace('corporate.ebitEps');
  const { planA: A, planB: B, taxRate: T, expectedEbit } = input;
  for (const [k, v] of [
    ['planA.interest', A?.interest],
    ['planA.shares', A?.shares],
    ['planB.interest', B?.interest],
    ['planB.shares', B?.shares],
    ['taxRate', T],
    ['expectedEbit', expectedEbit],
  ] as const)
    requireFinite(t, k, v);
  if (t.hasErrors) return t.fail();
  if (A.shares <= 0 || B.shares <= 0)
    t.error({
      code: 'SHARES_NOT_POSITIVE',
      message: 'Shares must be positive in both plans.',
      field: 'planA.shares',
    });
  if (T < 0 || T >= 1)
    t.error({
      code: 'TAX_OUT_OF_RANGE',
      message: 'Tax rate must be from 0% to below 100%.',
      field: 'taxRate',
    });
  if (t.hasErrors) return t.fail();
  t.assume('eps', 'EPS = (EBIT − interest)(1 − T) / shares; no preferred dividends.');
  const epsA = epsAt(expectedEbit, A, T);
  const epsB = epsAt(expectedEbit, B, T);
  let indifferenceEbit: number | null = null;
  if (A.shares !== B.shares)
    indifferenceEbit = (B.shares * A.interest - A.shares * B.interest) / (B.shares - A.shares);
  else
    t.warn({
      code: 'PARALLEL_PLANS',
      message: 'Both plans have the same share count: the EPS lines are parallel and never cross.',
    });
  const indifferenceEps = indifferenceEbit === null ? null : epsAt(indifferenceEbit, A, T);
  if (indifferenceEbit !== null)
    t.step(
      'ebitStar',
      'Indifference EBIT',
      indifferenceEbit,
      'EBIT^* = \\frac{N_B I_A - N_A I_B}{N_B - N_A}',
    );
  if (indifferenceEps !== null) t.step('epsStar', 'EPS at indifference', indifferenceEps);
  t.step('epsA', `EPS at expected EBIT: ${A.name}`, epsA);
  t.step('epsB', `EPS at expected EBIT: ${B.name}`, epsB);
  const preferredAtExpected = Math.abs(epsA - epsB) < 1e-12 ? 'tie' : epsA > epsB ? 'A' : 'B';
  return t.ok({ indifferenceEbit, indifferenceEps, epsA, epsB, preferredAtExpected });
}
