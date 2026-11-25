import { Trace, type Result } from '../core/result.js';
import { normCdf } from '../core/stats.js';
import { requireFinite, requireFiniteArray } from '../core/validate.js';

/**
 * Inverse standard normal CDF: Acklam's rational approximation refined by one Halley step on
 * the high-precision `normCdf`, giving ~1e-15 relative accuracy.
 */
export function normInv(p: number): number {
  if (!(p > 0 && p < 1)) return p === 0 ? -Infinity : p === 1 ? Infinity : Number.NaN;
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2,
    -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1,
    -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734,
    4.374664141464968, 2.938163982698783,
  ];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const plow = 0.02425;
  let x: number;
  if (p < plow) {
    const q = Math.sqrt(-2 * Math.log(p));
    x =
      (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  } else if (p <= 1 - plow) {
    const q = p - 0.5;
    const r = q * q;
    x =
      ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) /
      (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x =
      -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  const e = normCdf(x) - p;
  const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
  return x - u / (1 + (x * u) / 2);
}

export interface PortfolioInput {
  weights: number[];
  expectedReturns: number[];
  volatilities: number[];
  /** Full correlation matrix, n × n, symmetric with unit diagonal. */
  correlations: number[][];
  betas: number[];
  riskFree: number;
  marketReturn: number;
}

export interface PortfolioOutput {
  expectedReturn: number;
  variance: number;
  volatility: number;
  beta: number;
  sharpe: number | null;
  treynor: number | null;
  jensensAlpha: number;
  covariance: number[][];
  /** Each asset's share of portfolio variance (sums to 1). */
  riskContribution: number[];
}

/** Cholesky factorisation; returns false when the matrix is not positive semi-definite. */
function isPsd(m: number[][]): boolean {
  const n = m.length;
  const L = Array.from({ length: n }, () => Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = m[i]![j]!;
      for (let k = 0; k < j; k++) s -= L[i]![k]! * L[j]![k]!;
      if (i === j) {
        if (s < -1e-10) return false;
        L[i]![i] = Math.sqrt(Math.max(s, 0));
      } else {
        L[i]![j] = L[j]![j]! > 1e-14 ? s / L[j]![j]! : 0;
      }
    }
  }
  return true;
}

export function portfolioMetrics(input: PortfolioInput): Result<PortfolioOutput> {
  const t = new Trace('risk.portfolio');
  const n = input.weights?.length ?? 0;
  requireFiniteArray(t, 'weights', input.weights, 1);
  requireFiniteArray(t, 'expectedReturns', input.expectedReturns, 1);
  requireFiniteArray(t, 'volatilities', input.volatilities, 1);
  requireFiniteArray(t, 'betas', input.betas, 1);
  requireFinite(t, 'riskFree', input.riskFree);
  requireFinite(t, 'marketReturn', input.marketReturn);
  if (t.hasErrors) return t.fail();
  if ([input.expectedReturns, input.volatilities, input.betas].some((a) => a.length !== n)) {
    return t.fail({
      code: 'LENGTH_MISMATCH',
      message: 'Every asset needs a weight, expected return, volatility and beta.',
      field: 'weights',
    });
  }
  const C = input.correlations;
  if (
    !Array.isArray(C) ||
    C.length !== n ||
    C.some((row) => !Array.isArray(row) || row.length !== n || row.some((x) => !Number.isFinite(x)))
  ) {
    return t.fail({
      code: 'BAD_CORRELATION',
      message: `The correlation matrix must be ${n} × ${n} numbers.`,
      field: 'correlations',
    });
  }
  for (let i = 0; i < n; i++) {
    if (Math.abs(C[i]![i]! - 1) > 1e-9)
      return t.fail({
        code: 'BAD_CORRELATION',
        message: 'Correlation matrix diagonal must be 1.',
        field: 'correlations',
      });
    for (let j = 0; j < n; j++) {
      if (Math.abs(C[i]![j]! - C[j]![i]!) > 1e-9)
        return t.fail({
          code: 'BAD_CORRELATION',
          message: 'Correlation matrix must be symmetric.',
          field: 'correlations',
        });
      if (Math.abs(C[i]![j]!) > 1)
        return t.fail({
          code: 'BAD_CORRELATION',
          message: 'Correlations must lie between −1 and 1.',
          field: 'correlations',
        });
    }
  }
  if (input.volatilities.some((s) => s < 0))
    return t.fail({
      code: 'NEGATIVE_VOLATILITY',
      message: 'Volatilities cannot be negative.',
      field: 'volatilities',
    });
  if (!isPsd(C))
    return t.fail({
      code: 'NOT_PSD',
      message:
        'The correlation matrix is not positive semi-definite: these correlations cannot occur together.',
      field: 'correlations',
    });

  const sumW = input.weights.reduce((a, b) => a + b, 0);
  if (Math.abs(sumW - 1) > 1e-6)
    t.warn({
      code: 'WEIGHTS_NOT_100',
      message: `Weights sum to ${(sumW * 100).toFixed(2)}%, not 100%.`,
    });
  if (input.weights.some((w) => w < 0))
    t.warn({
      code: 'SHORT_POSITIONS',
      message: 'Negative weights are treated as short positions.',
    });
  t.assume(
    'mpt',
    'Single-period mean–variance model; inputs are annual expectations you supply (no market data).',
  );
  t.assume(
    'capm',
    'Treynor and Jensen’s alpha use the portfolio beta = Σ wᵢβᵢ and the CAPM security market line.',
  );

  const w = input.weights;
  const s = input.volatilities;
  const covariance = C.map((row, i) => row.map((rho, j) => rho * s[i]! * s[j]!));
  const er = w.reduce((acc, wi, i) => acc + wi * input.expectedReturns[i]!, 0);
  const marginal = covariance.map((row) => row.reduce((acc, c, j) => acc + c * w[j]!, 0));
  const variance = w.reduce((acc, wi, i) => acc + wi * marginal[i]!, 0);
  const volatility = Math.sqrt(Math.max(0, variance));
  const beta = w.reduce((acc, wi, i) => acc + wi * input.betas[i]!, 0);
  const excess = er - input.riskFree;
  const sharpe = volatility > 0 ? excess / volatility : null;
  const treynor = beta !== 0 ? excess / beta : null;
  const jensensAlpha = er - (input.riskFree + beta * (input.marketReturn - input.riskFree));
  const riskContribution = w.map((wi, i) => (variance > 0 ? (wi * marginal[i]!) / variance : 0));
  t.step('er', 'Expected portfolio return', er, 'E[R_p] = \\sum w_i E[R_i]');
  t.step('var', 'Portfolio variance', variance, '\\sigma_p^2 = w^\\top \\Sigma w');
  t.step('vol', 'Portfolio volatility', volatility);
  t.step('beta', 'Portfolio beta', beta, '\\beta_p = \\sum w_i \\beta_i');
  if (sharpe !== null) t.step('sharpe', 'Sharpe ratio', sharpe, '\\frac{E[R_p] - R_f}{\\sigma_p}');
  if (treynor !== null)
    t.step('treynor', 'Treynor ratio', treynor, '\\frac{E[R_p] - R_f}{\\beta_p}');
  t.step('alpha', "Jensen's alpha", jensensAlpha, '\\alpha = E[R_p] - [R_f + \\beta_p(R_m - R_f)]');
  return t.ok({
    expectedReturn: er,
    variance,
    volatility,
    beta,
    sharpe,
    treynor,
    jensensAlpha,
    covariance,
    riskContribution,
  });
}

export interface ParametricVarInput {
  portfolioValue: number;
  /** Annual expected return and volatility. */
  expectedReturn: number;
  volatility: number;
  horizonDays: number;
  tradingDays?: number;
  confidence: number[];
}

export interface VarRow {
  confidence: number;
  z: number;
  /** Loss not exceeded with the given confidence (positive number = loss). */
  valueAtRisk: number;
  /** Expected shortfall (CVaR): mean loss beyond VaR. */
  expectedShortfall: number;
}

/** Parametric (variance–covariance) VaR under normal returns, scaled by √t. */
export function parametricVar(
  input: ParametricVarInput,
): Result<{ horizonMean: number; horizonVolatility: number; rows: VarRow[] }> {
  const t = new Trace('risk.parametricVar');
  requireFinite(t, 'portfolioValue', input.portfolioValue);
  requireFinite(t, 'expectedReturn', input.expectedReturn);
  requireFinite(t, 'volatility', input.volatility);
  requireFinite(t, 'horizonDays', input.horizonDays);
  requireFiniteArray(t, 'confidence', input.confidence, 1);
  if (t.hasErrors) return t.fail();
  const td = input.tradingDays ?? 252;
  if (input.portfolioValue <= 0)
    t.error({
      code: 'VALUE_NOT_POSITIVE',
      message: 'Portfolio value must be positive.',
      field: 'portfolioValue',
    });
  if (input.volatility < 0)
    t.error({
      code: 'NEGATIVE_VOLATILITY',
      message: 'Volatility cannot be negative.',
      field: 'volatility',
    });
  if (input.horizonDays <= 0)
    t.error({
      code: 'HORIZON_NOT_POSITIVE',
      message: 'Horizon must be positive.',
      field: 'horizonDays',
    });
  if (input.confidence.some((c) => !(c > 0.5 && c < 1)))
    t.error({
      code: 'BAD_CONFIDENCE',
      message: 'Confidence levels must be between 50% and 100%.',
      field: 'confidence',
    });
  if (t.hasErrors) return t.fail();
  t.assume(
    'normal',
    'Returns are normally distributed; fat tails are not captured (historical or Monte Carlo VaR would be needed).',
  );
  t.assume(
    'scaling',
    `Horizon scaling: mean × h/${td}, volatility × √(h/${td}) (i.i.d. returns, ${td} trading days a year).`,
  );
  const h = input.horizonDays / td;
  const mu = input.expectedReturn * h;
  const sigma = input.volatility * Math.sqrt(h);
  const V = input.portfolioValue;
  const rows = input.confidence.map((c) => {
    const z = normInv(c);
    const phi = Math.exp((-z * z) / 2) / Math.sqrt(2 * Math.PI);
    return {
      confidence: c,
      z,
      valueAtRisk: V * (z * sigma - mu),
      expectedShortfall: V * ((sigma * phi) / (1 - c) - mu),
    };
  });
  t.step('mu', 'Horizon expected return', mu);
  t.step('sigma', 'Horizon volatility', sigma, '\\sigma_h = \\sigma\\sqrt{h/T}');
  for (const r of rows) {
    t.step(
      `var${r.confidence}`,
      `VaR ${(r.confidence * 100).toFixed(1)}% (z = ${r.z.toFixed(4)})`,
      r.valueAtRisk,
      'VaR = V(z\\sigma_h - \\mu_h)',
    );
    t.step(
      `es${r.confidence}`,
      `Expected shortfall ${(r.confidence * 100).toFixed(1)}%`,
      r.expectedShortfall,
      'ES = V\\left(\\frac{\\sigma_h\\,\\phi(z)}{1-c} - \\mu_h\\right)',
    );
  }
  return t.ok({ horizonMean: mu, horizonVolatility: sigma, rows });
}
