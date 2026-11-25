import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import * as E from '../src/index.js';

const close = (a: number, b: number, tol: number) =>
  expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);

describe('bonds: Excel documentation examples', () => {
  it('PRICE(2008-02-15, 2017-11-15, 5.75%, 6.5%, 100, 2, 0) = 94.63436', () => {
    const r = E.bondAnalytics({
      settlement: '2008-02-15',
      maturity: '2017-11-15',
      couponRate: 0.0575,
      yield: 0.065,
      frequency: 2,
      basis: '30/360-US',
    });
    close(r.value!.cleanPrice, 94.63436, 5e-6);
  });
  it('YIELD(2008-02-15, 2016-11-15, 5.75%, 95.04287, 100, 2, 0) = 6.5%', () => {
    const r = E.bondAnalytics({
      settlement: '2008-02-15',
      maturity: '2016-11-15',
      couponRate: 0.0575,
      cleanPrice: 95.04287,
      frequency: 2,
      basis: '30/360-US',
    });
    close(r.value!.yield, 0.065, 1e-7);
  });
  it('DURATION = 5.993775 and MDURATION = 5.73567 (2008-01-01 → 2016-01-01, 8%, 9%, semiannual, ACT/ACT)', () => {
    const r = E.bondAnalytics({
      settlement: '2008-01-01',
      maturity: '2016-01-01',
      couponRate: 0.08,
      yield: 0.09,
      frequency: 2,
      basis: 'ACT/ACT',
    }).value!;
    close(r.macaulayDuration, 5.993775, 5e-7);
    close(r.modifiedDuration, 5.73567, 5e-6);
  });
  it('price ↔ yield round trip, effective ≈ modified duration, and clean = dirty − accrued', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 3000 }),
        fc.integer({ min: 200, max: 10000 }),
        fc.double({ min: 0, max: 0.12, noNaN: true }),
        fc.double({ min: 0.001, max: 0.15, noNaN: true }),
        fc.constantFrom<E.Frequency>(1, 2, 4),
        fc.constantFrom<E.BondBasis>(...E.BOND_BASES),
        (s0, life, cpn, y, f, basis) => {
          const settle = E.formatISODate(E.fromSerial(E.toSerial({ y: 2015, m: 1, d: 1 }) + s0));
          const maturity = E.formatISODate(
            E.fromSerial(E.toSerial({ y: 2015, m: 1, d: 1 }) + s0 + life),
          );
          const a = E.bondAnalytics({
            settlement: settle,
            maturity,
            couponRate: cpn,
            yield: y,
            frequency: f,
            basis,
          }).value!;
          const b = E.bondAnalytics({
            settlement: settle,
            maturity,
            couponRate: cpn,
            cleanPrice: a.cleanPrice,
            frequency: f,
            basis,
          }).value!;
          close(b.yield, y, 1e-9);
          close(a.dirtyPrice - a.accruedInterest, a.cleanPrice, 1e-9);
          if (a.schedule.couponsRemaining > 1)
            close(a.effectiveDuration, a.modifiedDuration, 1e-4 * Math.max(1, a.modifiedDuration));
        },
      ),
      { numRuns: 300 },
    );
  });
  it('rejects maturity before settlement and both yield and price', () => {
    expect(
      E.bondAnalytics({
        settlement: '2020-01-01',
        maturity: '2019-01-01',
        couponRate: 0.05,
        yield: 0.05,
        frequency: 2,
        basis: 'ACT/ACT',
      }).errors[0]!.code,
    ).toBe('MATURITY_BEFORE_SETTLEMENT');
    expect(
      E.bondAnalytics({
        settlement: '2020-01-01',
        maturity: '2029-01-01',
        couponRate: 0.05,
        yield: 0.05,
        cleanPrice: 99,
        frequency: 2,
        basis: 'ACT/ACT',
      }).errors[0]!.code,
    ).toBe('YIELD_OR_PRICE');
  });
});

describe('normInv (standard normal quantiles)', () => {
  const cases: [number, number][] = [
    [0.95, 1.6448536269514722],
    [0.99, 2.3263478740408408],
    [0.975, 1.959963984540054],
    [0.001, -3.090232306167813],
    [0.5, 0],
  ];
  for (const [p, z] of cases) it(`Φ⁻¹(${p}) = ${z}`, () => close(E.normInv(p), z, 1e-12));
  it('inverts normCdf', () =>
    fc.assert(
      fc.property(
        fc.double({ min: 1e-10, max: 1 - 1e-10, noNaN: true }),
        (p) => Math.abs(E.normCdf(E.normInv(p)) - p) < 1e-13,
      ),
    ));
});

describe('capital budgeting KPIs', () => {
  it('payback interpolates; discounted payback may never occur; PI = PV(t≥1)/|CF0|', () => {
    const r = E.paybackAnalysis({ rate: 0.1, cashFlows: [-1000, 300, 400, 500] }).value!;
    close(r.payback!, 2.6, 1e-12);
    expect(r.discountedPayback).toBeNull();
    close(r.profitabilityIndex!, (300 / 1.1 + 400 / 1.21 + 500 / 1.331) / 1000, 1e-12);
  });
  it('PI > 1 exactly when NPV > 0', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 0.5, noNaN: true }),
        fc.array(fc.double({ min: 0, max: 1000, noNaN: true }), { minLength: 1, maxLength: 10 }),
        (rate, flows) => {
          const cf = [-1000, ...flows];
          const pi = E.paybackAnalysis({ rate, cashFlows: cf }).value!.profitabilityIndex!;
          const npv = E.npvRaw(rate, cf);
          if (Math.abs(npv) > 1e-6) expect(pi > 1).toBe(npv > 0);
        },
      ),
    );
  });
  it('Fisher: 3% real with 5% inflation = 8.15% nominal, and back', () => {
    close(E.fisherConvert({ rate: 0.03, inflation: 0.05, from: 'real' }).value!, 0.0815, 1e-15);
    close(E.fisherConvert({ rate: 0.0815, inflation: 0.05, from: 'nominal' }).value!, 0.03, 1e-15);
  });
  it('NPV is invariant to discounting real flows at the real rate vs nominal flows at the nominal rate', () => {
    const real = [-1000, 300, 400, 500];
    const nominal = E.inflateCashFlows(real, 0.05, 'toNominal');
    const rn = E.fisherConvert({ rate: 0.07, inflation: 0.05, from: 'real' }).value!;
    close(E.npvRaw(0.07, real), E.npvRaw(rn, nominal), 1e-9);
  });
  it('Hamada unlever / re-lever', () => {
    const h = E.hamadaBeta({
      peerBeta: 1.2,
      peerDebtToEquity: 0.5,
      peerTaxRate: 0.25,
      targetDebtToEquity: 1,
      targetTaxRate: 0.25,
    }).value!;
    close(h.unleveredBeta, 1.2 / 1.375, 1e-15);
    close(h.releveredBeta, (1.2 / 1.375) * 1.75, 1e-15);
  });
  it('bottom-up FCF: hand-computed single year', () => {
    const r = E.projectFcf({
      years: 1,
      revenue: 1000,
      revenueGrowth: 0,
      cogsPct: 0.6,
      ebitdaMargin: 0.3,
      daPct: 0.05,
      capexPct: 0.05,
      taxRate: 0.25,
      dso: 36.5,
      dio: 36.5,
      dpo: 36.5,
      initialInvestment: 500,
      terminalGrowth: null,
      discountRate: 0.1,
    }).value!;
    // EBIT 250, NOPAT 187.5, +D&A 50 − CapEx 50 − ΔNWC 100 (AR 100 + Inv 60 − AP 60) = 87.5
    close(r.rows[0]!.fcf, 87.5, 1e-12);
    expect(r.cashFlows).toEqual([-500, r.rows[0]!.fcf]);
  });
  it('bottom-up FCF terminal value and validation', () => {
    const base = {
      years: 3,
      revenue: 1000,
      revenueGrowth: 0.05,
      cogsPct: 0.6,
      ebitdaMargin: 0.3,
      daPct: 0.05,
      capexPct: 0.05,
      taxRate: 0.25,
      dso: 30,
      dio: 40,
      dpo: 35,
      initialInvestment: 1500,
      discountRate: 0.1,
    };
    const r = E.projectFcf({ ...base, terminalGrowth: 0.02 }).value!;
    close(r.terminalValue, (r.rows[2]!.fcf * 1.02) / 0.08, 1e-9);
    expect(E.projectFcf({ ...base, terminalGrowth: 0.1 }).errors[0]!.code).toBe(
      'GROWTH_NOT_BELOW_RATE',
    );
  });
});

describe('leverage and EBIT-EPS', () => {
  it('DOL 2.5, DFL 1.6, DTL 4, break-evens 6,000 and 7,500 units', () => {
    const r = E.leverage({
      units: 10000,
      price: 50,
      variableCost: 30,
      fixedCosts: 120000,
      interest: 30000,
      taxRate: 0.25,
      shares: 10000,
    }).value!;
    close(r.dol!, 2.5, 1e-12);
    close(r.dfl!, 1.6, 1e-12);
    close(r.dcl!, 4, 1e-12);
    close(r.operatingBreakeven!, 6000, 1e-9);
    close(r.breakeven!, 7500, 1e-9);
    close(r.eps, 3.75, 1e-12);
  });
  it('EBIT-EPS indifference at 800,000 with EPS 0.60', () => {
    const r = E.ebitEps({
      planA: { name: 'Equity', interest: 0, shares: 1_000_000 },
      planB: { name: 'Debt', interest: 400_000, shares: 500_000 },
      taxRate: 0.25,
      expectedEbit: 1_000_000,
    }).value!;
    close(r.indifferenceEbit!, 800_000, 1e-6);
    close(r.indifferenceEps!, 0.6, 1e-12);
    expect(r.preferredAtExpected).toBe('B');
  });
});

describe('working capital models', () => {
  it('EOQ = √(2DS/H), and it minimises total cost on the curve', () => {
    const r = E.eoq({
      annualDemand: 1000,
      orderCost: 50,
      holdingCost: 2,
      leadTimeDays: 7.3,
      safetyStock: 10,
    }).value!;
    close(r.eoq, Math.sqrt(50000), 1e-12);
    close(r.orderingCost, r.holdingCostTotal, 1e-9); // at the optimum both costs are equal
    close(r.reorderPoint, 30, 1e-12);
    expect(Math.min(...r.curve.map((c) => c.total))).toBeGreaterThanOrEqual(r.totalCost - 1e-9);
  });
  it('Baumol and Miller–Orr', () => {
    close(
      E.baumol({ annualCashNeed: 1_000_000, transactionCost: 100, interestRate: 0.05 }).value!
        .optimalCash,
      Math.sqrt(4e9),
      1e-6,
    );
    const m = E.millerOrr({
      lowerLimit: 10000,
      transactionCost: 50,
      dailyVariance: 4_000_000,
      dailyRate: 0.0002,
    }).value!;
    const spreadThird = Math.cbrt((3 * 50 * 4_000_000) / (4 * 0.0002));
    close(m.returnPoint, 10000 + spreadThird, 1e-6);
    close(m.upperLimit, 10000 + 3 * spreadThird, 1e-6);
  });
});

describe('equity valuation', () => {
  it('Gordon: D0 2, g 5%, r 10% → 42', () =>
    close(E.gordonGrowth({ dividend: 2, requiredReturn: 0.1, growth: 0.05 }).value!, 42, 1e-12));
  it('multi-stage with one stage equals the explicit sum', () => {
    const r = E.multiStageDdm({
      dividend: 1,
      requiredReturn: 0.12,
      stages: [{ growth: 0.2, years: 3 }],
      terminalGrowth: 0.05,
    }).value!;
    const d = [1.2, 1.44, 1.728];
    const manual =
      d.reduce((s, x, i) => s + x / 1.12 ** (i + 1), 0) + (1.728 * 1.05) / 0.07 / 1.12 ** 3;
    close(r.value, manual, 1e-12);
  });
  it('FCFF DCF: hand-computed', () => {
    const r = E.dcfValuation({
      kind: 'FCFF',
      cashFlows: [100, 110, 121],
      discountRate: 0.1,
      terminalGrowth: 0.03,
      netDebt: 200,
      shares: 10,
    }).value!;
    close(r.pvForecast, 300 / 1.1, 1e-9);
    close(r.terminalValue, (121 * 1.03) / 0.07, 1e-9);
    close(r.valuePerShare, (r.presentValue - 200) / 10, 1e-12);
  });
});

describe('portfolio and VaR', () => {
  const base = {
    weights: [0.6, 0.4],
    expectedReturns: [0.1, 0.06],
    volatilities: [0.2, 0.1],
    correlations: [
      [1, 0.3],
      [0.3, 1],
    ],
    betas: [1.2, 0.6],
    riskFree: 0.03,
    marketReturn: 0.08,
  };
  it('two-asset metrics (hand-computed)', () => {
    const r = E.portfolioMetrics(base).value!;
    close(r.variance, 0.01888, 1e-15);
    close(r.expectedReturn, 0.084, 1e-15);
    close(r.sharpe!, 0.054 / Math.sqrt(0.01888), 1e-12);
    close(r.treynor!, 0.054 / 0.96, 1e-12);
    close(r.jensensAlpha, 0.006, 1e-12);
    close(r.riskContribution[0]! + r.riskContribution[1]!, 1, 1e-12);
  });
  it('rejects an impossible (non-PSD) correlation matrix', () => {
    const r = E.portfolioMetrics({
      ...base,
      weights: [0.3, 0.3, 0.4],
      expectedReturns: [0.1, 0.1, 0.1],
      volatilities: [0.2, 0.2, 0.2],
      betas: [1, 1, 1],
      correlations: [
        [1, 0.9, 0.9],
        [0.9, 1, -0.9],
        [0.9, -0.9, 1],
      ],
    });
    expect(r.errors[0]!.code).toBe('NOT_PSD');
  });
  it('1-day 95% VaR on 1,000,000 at 20% vol = 1.6449 × 0.2/√252 × 1e6', () => {
    const r = E.parametricVar({
      portfolioValue: 1e6,
      expectedReturn: 0,
      volatility: 0.2,
      horizonDays: 1,
      confidence: [0.95, 0.99],
    }).value!;
    close(r.rows[0]!.valueAtRisk, 1.6448536269514722 * (0.2 / Math.sqrt(252)) * 1e6, 1e-6);
    expect(r.rows[1]!.valueAtRisk).toBeGreaterThan(r.rows[0]!.valueAtRisk);
    expect(r.rows[0]!.expectedShortfall).toBeGreaterThan(r.rows[0]!.valueAtRisk);
  });
});

describe('statement analysis: covenants and effective tax rate', () => {
  const p: E.StatementPeriod = {
    label: 'FY',
    cash: 100,
    shortTermInvestments: 50,
    receivables: 200,
    inventory: 150,
    otherCurrentAssets: 0,
    nonCurrentAssets: 500,
    payables: 100,
    shortTermDebt: 50,
    otherCurrentLiabilities: 50,
    longTermDebt: 300,
    otherNonCurrentLiabilities: 0,
    equity: 500,
    retainedEarnings: 300,
    revenue: 2000,
    cogs: 1200,
    operatingExpenses: 400,
    depreciation: 100,
    interestExpense: 30,
    otherIncome: 0,
    taxExpense: 67.5,
    principalRepayment: 50,
    operatingCashFlow: null,
    marketCap: null,
  };
  it('reports the historical effective tax rate', () =>
    close(E.analyzeStatements({ periods: [p] }).value!.derived[0]!.effectiveTaxRate!, 0.25, 1e-15));
  it('flags covenant breaches as critical (DSCR 5×, TIE 10× here)', () => {
    const codes = (c: NonNullable<E.StatementAnalysisInput['covenants']>) =>
      E.analyzeStatements({ periods: [p], covenants: c }).value!.diagnostics.map((d) => d.code);
    expect(codes({ minDscr: 6, minInterestCoverage: 12 })).toEqual(
      expect.arrayContaining(['COVENANT_BREACH_DSCR', 'COVENANT_BREACH_TIE']),
    );
    expect(codes({ minDscr: 4, minInterestCoverage: 9 })).not.toContain('COVENANT_BREACH_DSCR');
    expect(E.analyzeStatements({ periods: [p], covenants: { minDscr: -1 } }).errors[0]!.code).toBe(
      'INVALID_COVENANT',
    );
  });
});
