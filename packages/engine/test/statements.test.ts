import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import * as E from '../src/index.js';

/**
 * Hand-computed case (all values worked out on paper, see comments):
 * CA = 100+50+200+150+0 = 500, TA = 1000; CL = 100+50+50 = 200, TL = 500, E = 500 (balances).
 * GP = 2000−1200 = 800, EBITDA = 400, EBIT = 300, EBT = 270, tax 67.5, NI = 202.5.
 */
const base: E.StatementPeriod = {
  label: 'FY2024',
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
  marketCap: 800,
};

const ratio = (a: E.StatementAnalysis, id: E.RatioId, i = 0) =>
  a.ratios.find((r) => r.id === id)!.values[i]!;

describe('analyzeStatements: hand-computed single period', () => {
  const r = E.analyzeStatements({ periods: [base], altmanModel: 'public' });
  const a = r.value!;
  const cases: [E.RatioId, number][] = [
    ['currentRatio', 2.5],
    ['quickRatio', 1.75], // (100+50+200)/200
    ['cashRatio', 0.75],
    ['netWorkingCapital', 300],
    ['inventoryTurnover', 8], // 1200/150
    ['dio', 45.625], // 150/1200×365
    ['dso', 36.5], // 200/2000×365
    ['dpo', (100 / 1200) * 365],
    ['assetTurnover', 2],
    ['ccc', 45.625 + 36.5 - (100 / 1200) * 365],
    ['debtToAssets', 0.35], // (50+300)/1000
    ['debtToEquity', 0.7],
    ['interestCoverage', 10], // 300/30
    ['dscr', 5], // 400/(30+50)
    ['grossMargin', 0.4],
    ['ebitdaMargin', 0.2],
    ['netMargin', 0.10125],
    ['roa', 0.2025],
    ['roe', 0.405],
    ['roic', 225 / 850], // 300×(1−0.25) / (350+500)
  ];
  for (const [id, expected] of cases)
    it(`${id} = ${expected}`, () => expect(ratio(a, id)).toBeCloseTo(expected, 12));

  it('balances and has no data red flag', () => {
    expect(a.derived[0]!.balanceDifference).toBe(0);
    expect(a.diagnostics.map((d) => d.code)).not.toContain('BALANCE_SHEET_MISMATCH');
    expect(a.basis).toEqual(['ending']);
  });
  it('DuPont 3- and 5-step factors', () => {
    const d = a.dupont[0]!;
    expect(d.netMargin).toBeCloseTo(0.10125, 12);
    expect(d.assetTurnover).toBeCloseTo(2, 12);
    expect(d.equityMultiplier).toBeCloseTo(2, 12);
    expect(d.taxBurden).toBeCloseTo(0.75, 12);
    expect(d.interestBurden).toBeCloseTo(0.9, 12);
    expect(d.ebitMargin).toBeCloseTo(0.15, 12);
  });
  it('Altman Z for all three models (X = .3, .3, .3, X4, 2)', () => {
    expect(a.altman[0]!.score).toBeCloseTo(1.2 * 0.3 + 1.4 * 0.3 + 3.3 * 0.3 + 0.6 * 1.6 + 2, 12); // 4.73
    expect(a.altman[0]!.zone).toBe('safe');
    const priv = E.analyzeStatements({ periods: [base], altmanModel: 'private' }).value!.altman[0]!;
    expect(priv.score).toBeCloseTo(
      0.717 * 0.3 + 0.847 * 0.3 + 3.107 * 0.3 + 0.42 * 1 + 0.998 * 2,
      12,
    );
    const nm = E.analyzeStatements({ periods: [base], altmanModel: 'nonManufacturing' }).value!
      .altman[0]!;
    expect(nm.score).toBeCloseTo(6.56 * 0.3 + 3.26 * 0.3 + 6.72 * 0.3 + 1.05 * 1, 12);
    expect(nm.components).toHaveLength(4);
  });
});

describe('analyzeStatements: multi-period behaviour', () => {
  const p2: E.StatementPeriod = {
    ...base,
    label: 'FY2025',
    receivables: 300,
    nonCurrentAssets: 400, // keeps the balance sheet balanced
    revenue: 2100,
    cogs: 1300,
    taxExpense: 50,
  };

  it('uses average balances for the later period', () => {
    const a = E.analyzeStatements({ periods: [base, p2] }).value!;
    expect(a.basis).toEqual(['ending', 'average']);
    expect(ratio(a, 'dso', 1)).toBeCloseTo((250 / 2100) * 365, 12); // avg AR (200+300)/2
  });

  it('flags receivables growing faster than revenue, and DSO rising', () => {
    const codes = E.analyzeStatements({ periods: [base, p2] }).value!.diagnostics.map(
      (d) => d.code,
    );
    expect(codes).toContain('RECEIVABLES_OUTPACE_SALES');
    expect(codes).toContain('DSO_RISING');
  });

  it('flags a balance sheet that does not balance, loudly', () => {
    const r = E.analyzeStatements({ periods: [{ ...base, cash: 120 }] });
    expect(r.value!.diagnostics[0]!.code).toBe('BALANCE_SHEET_MISMATCH');
    expect(r.warnings.map((w) => w.code)).toContain('RED_FLAGS');
  });

  it('flags weak coverage and distress as critical', () => {
    // Revenue 1000, COGS 700, OpEx 400, D&A 100: EBIT = -200, coverage = -200/30.
    // Z = 1.2(.3) + 1.4(-.2) + 3.3(-.2) + 0.6(.1) + 1.0(1) = 0.48 -> distress.
    const weak = {
      ...base,
      revenue: 1000,
      cogs: 700,
      operatingExpenses: 400,
      taxExpense: 0,
      retainedEarnings: -200,
      marketCap: 50,
    };
    const a = E.analyzeStatements({ periods: [weak], altmanModel: 'public' }).value!;
    const sev = Object.fromEntries(a.diagnostics.map((d) => [d.code, d.severity]));
    expect(sev.LOW_INTEREST_COVERAGE).toBe('critical');
    expect(sev.OPERATING_LOSS).toBe('critical');
    expect(sev.ALTMAN_DISTRESS).toBe('critical');
    expect(a.altman[0]!.score).toBeCloseTo(0.48, 12);
  });

  it('computes the working-capital what-if', () => {
    const a = E.analyzeStatements({
      periods: [base],
      whatIf: { deltaDso: -10, deltaDio: -5, deltaDpo: 5 },
    }).value!;
    const w = a.whatIf!;
    expect(w.cashFromReceivables).toBeCloseTo((10 * 2000) / 365, 9);
    expect(w.cashFromInventory).toBeCloseTo((5 * 1200) / 365, 9);
    expect(w.cashFromPayables).toBeCloseTo((5 * 1200) / 365, 9);
    expect(w.newCcc! - w.currentCcc!).toBeCloseTo(-20, 12);
  });

  it('compares the latest period with benchmarks', () => {
    const a = E.analyzeStatements({
      periods: [base],
      benchmarks: { currentRatio: 1.5, debtToEquity: 0.5, roe: 0.4 },
    }).value!;
    const st = Object.fromEntries(a.ratios.map((r) => [r.id, r.status]));
    expect(st.currentRatio).toBe('better');
    expect(st.debtToEquity).toBe('worse');
    expect(st.roe).toBe('inline');
  });

  it('rejects missing and negative items with the period and item', () => {
    const r = E.analyzeStatements({ periods: [{ ...base, inventory: -1, revenue: null }] });
    expect(r.status).toBe('error');
    expect(r.errors.map((e) => e.code).sort()).toEqual(['MISSING_ITEM', 'NEGATIVE_ITEM']);
  });
});

describe('analyzeStatements: identities (property-based)', () => {
  const pos = (max = 1e6) => fc.double({ min: 1, max, noNaN: true });
  const period = fc
    .record({
      cash: pos(),
      shortTermInvestments: pos(),
      receivables: pos(),
      inventory: pos(),
      otherCurrentAssets: pos(),
      nonCurrentAssets: pos(),
      payables: pos(),
      shortTermDebt: pos(),
      otherCurrentLiabilities: pos(),
      longTermDebt: pos(),
      revenue: pos(1e7),
      cogsShare: fc.double({ min: 0.1, max: 0.8, noNaN: true }),
      opexShare: fc.double({ min: 0.01, max: 0.1, noNaN: true }),
      depreciation: pos(1e4),
      interestExpense: pos(1e4),
      equityShare: fc.double({ min: 0.1, max: 0.9, noNaN: true }),
    })
    .map((x): E.StatementPeriod => {
      const ta =
        x.cash +
        x.shortTermInvestments +
        x.receivables +
        x.inventory +
        x.otherCurrentAssets +
        x.nonCurrentAssets;
      const equity = ta * x.equityShare;
      const known = x.payables + x.shortTermDebt + x.otherCurrentLiabilities + x.longTermDebt;
      return {
        label: 'P',
        cash: x.cash,
        shortTermInvestments: x.shortTermInvestments,
        receivables: x.receivables,
        inventory: x.inventory,
        otherCurrentAssets: x.otherCurrentAssets,
        nonCurrentAssets: x.nonCurrentAssets + Math.max(0, known + equity - ta),
        payables: x.payables,
        shortTermDebt: x.shortTermDebt,
        otherCurrentLiabilities: x.otherCurrentLiabilities,
        longTermDebt: x.longTermDebt,
        otherNonCurrentLiabilities: Math.max(0, ta - known - equity),
        equity,
        retainedEarnings: equity / 2,
        revenue: x.revenue,
        cogs: x.revenue * x.cogsShare,
        operatingExpenses: x.revenue * x.opexShare,
        depreciation: x.depreciation,
        interestExpense: x.interestExpense,
        otherIncome: 0,
        taxExpense: 0,
        principalRepayment: 0,
        operatingCashFlow: null,
        marketCap: null,
      };
    });

  it('DuPont 3-step and 5-step products equal ROE; CCC = DIO + DSO − DPO; quick ≤ current', () => {
    fc.assert(
      fc.property(fc.array(period, { minLength: 1, maxLength: 3 }), (ps) => {
        const a = E.analyzeStatements({ periods: ps }).value!;
        ps.forEach((_, i) => {
          const d = a.dupont[i]!;
          if (d.roe === null) return;
          expect(d.netMargin! * d.assetTurnover! * d.equityMultiplier!).toBeCloseTo(d.roe, 10);
          expect(
            d.taxBurden! *
              d.interestBurden! *
              d.ebitMargin! *
              d.assetTurnover! *
              d.equityMultiplier!,
          ).toBeCloseTo(d.roe, 10);
          expect(ratio(a, 'ccc', i)).toBeCloseTo(
            ratio(a, 'dio', i) + ratio(a, 'dso', i) - ratio(a, 'dpo', i),
            8,
          );
          expect(ratio(a, 'quickRatio', i)).toBeLessThanOrEqual(ratio(a, 'currentRatio', i));
          expect(Math.abs(a.derived[i]!.balanceDifference)).toBeLessThan(
            1e-6 * a.derived[i]!.totalAssets,
          );
        });
      }),
      { numRuns: 200 },
    );
  });
});
