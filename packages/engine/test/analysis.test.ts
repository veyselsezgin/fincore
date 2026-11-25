import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import * as E from '../src/index.js';

describe('normCdf', () => {
  // Reference values: standard normal table / scipy.stats.norm.cdf.
  const cases: [number, number][] = [
    [0, 0.5],
    [1, 0.8413447460685429],
    [-1.96, 0.024997895148220435],
    [2.5, 0.9937903346742238],
    [-3, 0.0013498980316301035],
  ];
  for (const [x, p] of cases) {
    it(`Φ(${x}) = ${p}`, () => expect(Math.abs(E.normCdf(x) - p)).toBeLessThan(1e-13));
  }
  it('is symmetric', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -10, max: 10, noNaN: true }),
        (x) => Math.abs(E.normCdf(x) + E.normCdf(-x) - 1) < 1e-14,
      ),
    );
  });
});

describe('percentileSorted (Excel PERCENTILE.INC)', () => {
  it('interpolates linearly', () => {
    expect(E.percentileSorted([1, 2, 3, 4], 0.25)).toBeCloseTo(1.75, 14);
    expect(E.percentileSorted([1, 2, 3, 4], 0.5)).toBeCloseTo(2.5, 14);
    expect(E.percentileSorted([10], 0.9)).toBe(10);
  });
});

describe('Rng', () => {
  it('is reproducible for a seed and differs across seeds', () => {
    const a = new E.Rng(42);
    const b = new E.Rng(42);
    const c = new E.Rng(43);
    const xs = Array.from({ length: 5 }, () => a.uniform());
    expect(Array.from({ length: 5 }, () => b.uniform())).toEqual(xs);
    expect(Array.from({ length: 5 }, () => c.uniform())).not.toEqual(xs);
  });
  it('produces standard normals with mean 0 and variance 1', () => {
    const r = new E.Rng(7);
    const n = 200_000;
    let s = 0;
    let s2 = 0;
    for (let i = 0; i < n; i++) {
      const z = r.normal();
      s += z;
      s2 += z * z;
    }
    expect(Math.abs(s / n)).toBeLessThan(4 / Math.sqrt(n));
    expect(Math.abs(s2 / n - 1)).toBeLessThan(0.015);
  });
});

describe('CAPM and WACC', () => {
  it('CAPM: 4% + 1.2 × 5.5% = 10.6%', () => {
    expect(E.capm({ riskFree: 0.04, beta: 1.2, marketRiskPremium: 0.055 }).value).toBeCloseTo(
      0.106,
      14,
    );
  });
  it('WACC: 60/40 split, Re 10.6%, Rd 6%, tax 25% gives 8.16%', () => {
    const r = E.waccFromCapm({
      riskFree: 0.04,
      beta: 1.2,
      marketRiskPremium: 0.055,
      equityValue: 600,
      debtValue: 400,
      preTaxCostOfDebt: 0.06,
      taxRate: 0.25,
    });
    expect(r.status).toBe('ok');
    expect(r.value!.wacc).toBeCloseTo(0.0816, 14);
    expect(r.steps.map((s) => s.id)).toContain('capm.costOfEquity');
    expect(r.steps.map((s) => s.id)).toContain('wacc.wacc');
  });
  it('rejects a 100% tax rate and zero capital', () => {
    const base = { costOfEquity: 0.1, preTaxCostOfDebt: 0.05 };
    expect(E.wacc({ ...base, equityValue: 1, debtValue: 1, taxRate: 1 }).errors[0]!.code).toBe(
      'TAX_OUT_OF_RANGE',
    );
    expect(E.wacc({ ...base, equityValue: 0, debtValue: 0, taxRate: 0.2 }).errors[0]!.code).toBe(
      'ZERO_CAPITAL',
    );
  });
});

describe('npvSensitivity', () => {
  const cf = [-100000, 30000, 35000, 40000, 45000];
  const shocks = E.symmetricShocks(0.2, 5);
  const r = E.npvSensitivity({
    rate: 0.1,
    cashFlows: cf,
    cashFlowShocks: shocks,
    rateShocks: shocks,
  }).value!;

  it('builds symmetric shocks', () => expect(shocks).toEqual([-0.2, -0.1, 0, 0.1, 0.2]));
  it('centre cell equals the base NPV', () => {
    expect(r.npv[2]![2]).toBeCloseTo(E.npvRaw(0.1, cf), 9);
    expect(r.baseNpv).toBeCloseTo(E.npvRaw(0.1, cf), 9);
  });
  it('NPV rises with cash flows and falls with the rate', () => {
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 4; j++) expect(r.npv[i]![j]!).toBeGreaterThan(r.npv[i]![j + 1]!);
    }
    for (let j = 0; j < 5; j++) {
      for (let i = 0; i < 4; i++) expect(r.npv[i + 1]![j]!).toBeGreaterThan(r.npv[i]![j]!);
    }
  });
  it('applies rate shocks relatively', () => expect(r.rates[4]).toBeCloseTo(0.12, 14));
});

describe('monteCarloNpv', () => {
  it('is reproducible for the same seed', () => {
    const input = {
      rate: 0.1,
      cashFlows: [
        { type: 'fixed', value: -1000 },
        { type: 'triangular', min: 200, mode: 400, max: 700 },
        { type: 'normal', mean: 500, sd: 150 },
      ] as E.Distribution[],
      iterations: 5000,
      seed: 99,
    };
    expect(E.monteCarloNpv(input).value).toEqual(E.monteCarloNpv(input).value);
    expect(E.monteCarloNpv({ ...input, seed: 100 }).value!.mean).not.toBe(
      E.monteCarloNpv(input).value!.mean,
    );
  });

  it('collapses to the deterministic NPV when everything is fixed', () => {
    const r = E.monteCarloNpv({
      rate: 0.1,
      cashFlows: [
        { type: 'fixed', value: -100 },
        { type: 'fixed', value: 121 },
      ],
      iterations: 1000,
    }).value!;
    expect(r.sd).toBe(0);
    expect(r.mean).toBeCloseTo(10, 10);
    expect(r.probabilityPositive).toBe(1);
  });

  it('matches the analytic normal answer for normally distributed flows', () => {
    // With a fixed rate, NPV is a sum of independent normals: NPV ~ N(mu, sigma²).
    const rate = 0.08;
    const means = [-100000, 25000, 30000, 30000, 35000];
    const sds = [0, 8000, 9000, 10000, 12000];
    const N = 100_000;
    const r = E.monteCarloNpv({
      rate,
      cashFlows: means.map((m, i) => ({ type: 'normal', mean: m, sd: sds[i]! })),
      iterations: N,
      seed: 2024,
    }).value!;
    const mu = means.reduce((s, m, i) => s + m / (1 + rate) ** i, 0);
    const sigma = Math.sqrt(sds.reduce((s, sd, i) => s + (sd / (1 + rate) ** i) ** 2, 0));
    const pAnalytic = E.normCdf(mu / sigma);

    expect(Math.abs(r.mean - mu)).toBeLessThan((4 * sigma) / Math.sqrt(N));
    expect(Math.abs(r.sd - sigma) / sigma).toBeLessThan(0.02);
    expect(Math.abs(r.probabilityPositive - pAnalytic)).toBeLessThan(
      4 * r.probabilityStdError + 1e-3,
    );
    expect(r.npvAtMeans).toBeCloseTo(mu, 6);
    expect(r.histogram.reduce((s, b) => s + b.count, 0)).toBe(N);
  });

  it('keeps triangular draws inside their bounds', () => {
    const r = E.monteCarloNpv({
      rate: 0,
      cashFlows: [
        { type: 'fixed', value: 0 },
        { type: 'triangular', min: 10, mode: 20, max: 50 },
      ],
      iterations: 20_000,
      seed: 5,
    }).value!;
    expect(r.min).toBeGreaterThanOrEqual(10);
    expect(r.max).toBeLessThanOrEqual(50);
    expect(Math.abs(r.mean - 80 / 3)).toBeLessThan(0.15);
  });

  it('reports invalid distributions with the period index', () => {
    const r = E.monteCarloNpv({
      rate: 0.1,
      cashFlows: [
        { type: 'fixed', value: -1 },
        { type: 'triangular', min: 5, mode: 1, max: 9 },
      ],
    });
    expect(r.errors[0]!.code).toBe('INVALID_DISTRIBUTION');
    expect(r.errors[0]!.params).toEqual({ index: 1 });
  });
});

describe('compareProjects', () => {
  // A: front-loaded, higher IRR (21.8%). B: back-loaded, higher NPV at low rates. Cross at ~17.1%.
  const A = [-100000, 70000, 40000, 20000, 10000];
  const B = [-100000, 10000, 30000, 50000, 85000];

  it('finds the Fisher rate where the NPV profiles cross', () => {
    const r = E.compareProjects({ rate: 0.05, projectA: A, projectB: B }).value!;
    expect(r.crossoverRates).toHaveLength(1);
    const x = r.crossoverRates[0]!;
    expect(Math.abs(E.npvRaw(x, A) - E.npvRaw(x, B))).toBeLessThan(1e-6);
  });

  it('flags the NPV/IRR conflict below the crossover and not above it', () => {
    const below = E.compareProjects({ rate: 0.05, projectA: A, projectB: B });
    const x = below.value!.crossoverRates[0]!;
    expect(below.value!.conflict).toBe(true);
    expect(below.warnings.map((w) => w.code)).toContain('NPV_IRR_CONFLICT');
    const above = E.compareProjects({ rate: x + 0.02, projectA: A, projectB: B });
    expect(above.value!.conflict).toBe(false);
  });

  it('pads unequal lives and warns', () => {
    const r = E.compareProjects({ rate: 0.1, projectA: [-10, 12], projectB: [-10, 5, 7] });
    expect(r.value!.incremental).toEqual([0, 7, -7]);
    expect(r.warnings.map((w) => w.code)).toContain('UNEQUAL_LIVES');
  });
});
