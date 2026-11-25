import * as E from '@fincore/engine';
import { HyperFormula } from 'hyperformula';
import { describe, expect, it } from 'vitest';
import { toHyperFormulaSheets, type XBook } from '../src/io/xlsx';
import * as W from '../src/io/workbooks';

/**
 * Evaluates every formula of an exported workbook with HyperFormula (an Excel-compatible
 * engine) and checks it against the cached engine value stored in the same cell.
 */
function verify(book: XBook, tol = 1e-7): number {
  const hf = HyperFormula.buildFromSheets(toHyperFormulaSheets(book), {
    licenseKey: 'gpl-v3',
    useArrayArithmetic: true,
  });
  let checked = 0;
  for (const sheet of book.sheets) {
    const id = hf.getSheetId(sheet.name)!;
    sheet.rows.forEach((row, r) =>
      row.forEach((cell, c) => {
        if (!cell || typeof cell !== 'object' || !('f' in cell) || typeof cell.v !== 'number')
          return;
        const got = hf.getCellValue({ sheet: id, row: r, col: c });
        const where = `${sheet.name}!R${r + 1}C${c + 1} =${cell.f}`;
        expect(typeof got, `${where} -> ${JSON.stringify(got)}`).toBe('number');
        const scale = Math.max(1, Math.abs(cell.v));
        expect(Math.abs((got as number) - cell.v) / scale, where).toBeLessThan(tol);
        checked++;
      }),
    );
  }
  hf.destroy();
  return checked;
}

const FLOWS = [-70000, 12000, 15000, 18000, 21000, 26000];

describe('Excel exports reproduce engine results', () => {
  it('NPV (t = 0 and Excel conventions) with the sensitivity grid', () => {
    for (const firstPeriod of [0, 1] as const) {
      const shocks = E.symmetricShocks(0.2, 9);
      const sensitivity = E.npvSensitivity({
        rate: 0.1,
        cashFlows: FLOWS,
        cashFlowShocks: shocks,
        rateShocks: shocks,
        firstPeriod,
      }).value!;
      const n = verify(W.npvBook({ rate: 0.1, cashFlows: FLOWS, firstPeriod, sensitivity }));
      expect(n).toBeGreaterThan(81 + 9);
    }
  });

  it('IRR, including one formula per root when there are several', () => {
    expect(verify(W.irrBook(FLOWS))).toBe(1);
    expect(verify(W.irrBook([-1, 5, -6]))).toBe(2);
  });

  it('MIRR', () =>
    expect(verify(W.mirrBook([-120000, 39000, 30000, 21000, 37000, 46000], 0.1, 0.12))).toBe(1));

  it('XNPV and XIRR with real dates', () => {
    const flows = [
      { date: '2008-01-01', amount: -10000 },
      { date: '2008-03-01', amount: 2750 },
      { date: '2008-10-30', amount: 4250 },
      { date: '2009-02-15', amount: 3250 },
      { date: '2009-04-01', amount: 2750 },
    ];
    expect(verify(W.xirrBook(0.09, flows), 1e-6)).toBe(2);
  });

  it('WACC from CAPM', () => {
    const input = {
      riskFree: 0.04,
      beta: 1.2,
      marketRiskPremium: 0.055,
      equityValue: 600,
      debtValue: 400,
      preTaxCostOfDebt: 0.06,
      taxRate: 0.25,
    };
    expect(verify(W.waccBook(input, E.waccFromCapm(input).value!))).toBe(5);
  });

  it('TVM for every solve-for variable', () => {
    const base = {
      annualRate: 0.08,
      ppy: 12,
      nper: 36,
      pv: 10000,
      pmt: -300,
      fv: -1000,
      timing: 'begin' as const,
    };
    const rate = base.annualRate / base.ppy;
    const results: Record<W.SolveFor, number> = {
      fv: E.fv({ rate, nper: base.nper, pmt: base.pmt, pv: base.pv, timing: base.timing }).value!,
      pv: E.pv({ rate, nper: base.nper, pmt: base.pmt, fv: base.fv, timing: base.timing }).value!,
      pmt: E.pmt({ rate, nper: base.nper, pv: base.pv, fv: base.fv, timing: base.timing }).value!,
      nper: E.nper({ rate, pmt: base.pmt, pv: base.pv, fv: base.fv, timing: base.timing }).value!,
      rate: 0,
    };
    const rr = E.rate({ nper: 36, pmt: -350, pv: 10000, fv: 0, timing: 'begin' }).value!.rate!;
    for (const s of ['fv', 'pv', 'pmt', 'nper'] as const) {
      expect(verify(W.tvmBook({ ...base, solveFor: s, result: results[s] }))).toBeGreaterThan(0);
    }
    expect(verify(W.tvmBook({ ...base, pmt: -350, fv: 0, solveFor: 'rate', result: rr }))).toBe(2);
  });

  it('amortization schedule (cents and yen)', () => {
    for (const currency of ['TRY', 'JPY'] as const) {
      const input = { principal: 250000, annualRate: 0.36, periodsPerYear: 12, nper: 24, currency };
      const out = E.amortizationSchedule(input).value!;
      expect(verify(W.amortizationBook(input, out), 1e-9)).toBe(3 + out.rows.length * 5);
    }
  });

  it('project comparison with the Fisher rate', () => {
    const a = [-100000, 70000, 40000, 20000, 10000];
    const b = [-100000, 10000, 30000, 50000, 85000];
    const out = E.compareProjects({ rate: 0.05, projectA: a, projectB: b }).value!;
    expect(verify(W.compareBook(0.05, a, b, out))).toBe(5 + 5);
  });

  it('Monte Carlo deterministic check column', () => {
    const flows: E.Distribution[] = [
      { type: 'fixed', value: -100000 },
      { type: 'triangular', min: 15000, mode: 25000, max: 35000 },
      { type: 'normal', mean: 30000, sd: 8000 },
      { type: 'uniform', min: 10000, max: 30000 },
    ];
    const out = E.monteCarloNpv({ rate: 0.1, cashFlows: flows, iterations: 1000 }).value!;
    expect(verify(W.monteCarloBook({ type: 'fixed', value: 0.1 }, flows, out))).toBe(5);
  });

  it('day count formulas match the engine, including the end-of-February cases', () => {
    const pairs: [string, string][] = [
      ['2012-01-01', '2012-07-30'],
      ['2020-02-29', '2021-03-31'], // Excel YEARFRAC basis 0 gives 391 days here; bond basis 390
      ['2022-02-28', '2024-07-31'],
      ['2021-02-28', '2021-02-28'],
      ['2019-02-28', '2020-02-29'],
      ['2020-01-31', '2020-03-31'],
      ['2020-03-30', '2020-05-31'],
      ['2020-03-15', '2020-05-31'],
    ];
    for (const [s, e] of pairs) expect(verify(W.dayCountBook(s, e), 1e-10)).toBe(4);
  });
});
