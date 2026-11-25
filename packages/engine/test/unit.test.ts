import { describe, expect, it } from 'vitest';
import * as E from '../src/index.js';

const codes = (r: { errors: { code: string }[]; warnings: { code: string }[] }) => ({
  errors: r.errors.map((e) => e.code),
  warnings: r.warnings.map((w) => w.code),
});

describe('result contract', () => {
  it('returns an error result (never throws) for invalid inputs', () => {
    const r = E.pmt({ rate: Number.NaN, nper: 0 });
    expect(r.status).toBe('error');
    expect(r.value).toBeNull();
    expect(codes(r).errors).toEqual(['INPUT_NOT_FINITE', 'NPER_NOT_POSITIVE']);
    expect(r.errors[0]!.field).toBe('rate');
  });

  it('rejects rates at or below -100%', () => {
    expect(codes(E.npv({ rate: -1, cashFlows: [1] })).errors).toEqual(['RATE_OUT_OF_DOMAIN']);
  });

  it('records steps and assumptions for transparency', () => {
    const r = E.fv({ rate: 0.05, nper: 10, pv: -100 });
    expect(r.formulaId).toBe('tvm.fv');
    expect(r.steps.map((s) => s.id)).toEqual(['growth', 'annuityFactor', 'fv']);
    expect(r.assumptions.map((a) => a.id)).toContain('timing');
  });
});

describe('brent', () => {
  it('finds the cube root of 2', () => {
    const r = E.brent((x) => x ** 3 - 2, 0, 2)!;
    expect(r.converged).toBe(true);
    expect(r.root).toBeCloseTo(Math.cbrt(2), 12);
  });
  it('returns null when the interval does not bracket a root', () => {
    expect(E.brent((x) => x * x + 1, -1, 1)).toBeNull();
  });
});

describe('irr', () => {
  it('returns all roots and no primary IRR when there are several', () => {
    // -1 + 5x - 6x^2 = 0 with x = 1/(1+r)  ->  r = 100% and r = 200%
    const r = E.irr({ cashFlows: [-1, 5, -6] });
    expect(r.status).toBe('warning');
    expect(r.value!.irr).toBeNull();
    expect(r.value!.roots).toHaveLength(2);
    expect(r.value!.roots[0]).toBeCloseTo(1, 10);
    expect(r.value!.roots[1]).toBeCloseTo(2, 10);
    expect(codes(r).warnings).toEqual(['MULTIPLE_IRR']);
  });
  it('fails when the cash flows never change sign', () => {
    expect(codes(E.irr({ cashFlows: [100, 200] })).errors).toEqual(['NO_SIGN_CHANGE']);
  });
  it('fails when there are sign changes but no real root', () => {
    // 1 - 3x + 3x^2 has negative discriminant.
    expect(codes(E.irr({ cashFlows: [1, -3, 3] })).errors).toEqual(['NO_IRR']);
  });
  it('handles an IRR of exactly zero', () => {
    expect(E.irr({ cashFlows: [-100, 50, 50] }).value!.irr).toBe(0);
  });
});

describe('npv', () => {
  it('t=0 convention equals Excel NPV times (1+r)', () => {
    const cf = [-10000, 3000, 4200, 6800];
    const a = E.npv({ rate: 0.1, cashFlows: cf }).value!.npv;
    const b = E.npv({ rate: 0.1, cashFlows: cf, firstPeriod: 1 }).value!.npv;
    expect(a).toBeCloseTo(b * 1.1, 9);
  });
});

describe('xnpv / xirr', () => {
  it('rejects a flow dated before the first flow', () => {
    const r = E.xirr({
      flows: [
        { date: '2024-06-01', amount: -100 },
        { date: '2024-01-01', amount: 110 },
      ],
    });
    expect(codes(r).errors).toEqual(['DATE_BEFORE_FIRST']);
  });
  it('rejects impossible dates', () => {
    const r = E.xnpv({ rate: 0.1, flows: [{ date: '2023-02-29', amount: 1 }] });
    expect(codes(r).errors).toEqual(['INVALID_DATE']);
  });
  it('one year at 10% gives XIRR of 10% on a 365-day year', () => {
    const r = E.xirr({
      flows: [
        { date: '2023-01-01', amount: -100 },
        { date: '2024-01-01', amount: 110 },
      ],
    });
    expect(r.value!.xirr).toBeCloseTo(0.1, 12);
  });
});

describe('tvm', () => {
  it('rate solves a pure growth problem in closed form', () => {
    const r = E.rate({ nper: 10, pv: -1000, fv: 2000 });
    expect(r.value!.rate).toBeCloseTo(2 ** 0.1 - 1, 12);
  });
  it('zero rate uses the linear limit', () => {
    expect(E.pmt({ rate: 0, nper: 4, pv: 1000 }).value).toBe(-250);
    expect(E.fv({ rate: 0, nper: 4, pmt: -10, pv: -100 }).value).toBe(140);
    expect(E.nper({ rate: 0, pmt: -250, pv: 1000 }).value).toBe(4);
  });
  it('rate reports an indeterminate problem instead of thousands of roots', () => {
    // n = 1, end-of-period payment, no PV: the rate cancels out of the equation.
    expect(codes(E.rate({ nper: 1, pmt: -1, fv: 1 })).errors).toEqual(['RATE_INDETERMINATE']);
    const r = E.xirr({
      flows: [
        { date: '2024-01-01', amount: -5 },
        { date: '2024-01-01', amount: 5 },
      ],
    });
    expect(codes(r).errors).toEqual(['RATE_INDETERMINATE']);
  });
  it('nper reports impossible goals as errors', () => {
    // Withdrawing 100/period from 1000 at 1% can never grow to 10000.
    expect(codes(E.nper({ rate: 0.01, pmt: 100, pv: -1000, fv: 10000 })).errors).toEqual([
      'NO_SOLUTION',
    ]);
  });
});

describe('day count', () => {
  const yf = (start: string, end: string, dayCount: E.DayCount) =>
    E.yearFraction({ start, end, dayCount }).value!;

  it('ACT/ACT ISDA across a year boundary (ISDA 2006 example)', () => {
    expect(yf('2003-11-01', '2004-05-01', 'ACT/ACT-ISDA').yearFraction).toBeCloseTo(
      61 / 365 + 121 / 366,
      14,
    );
  });
  it('30/360 US and 30E/360 differ on end-of-February starts', () => {
    expect(yf('2020-02-29', '2020-03-31', '30/360-US').days).toBe(30);
    expect(yf('2020-02-29', '2020-03-31', '30E/360').days).toBe(31);
    expect(yf('2020-01-31', '2020-03-31', '30/360-US').days).toBe(60);
  });
  it('rejects end before start and bad conventions', () => {
    expect(
      codes(E.yearFraction({ start: '2024-02-01', end: '2024-01-01', dayCount: 'ACT/360' })).errors,
    ).toEqual(['END_BEFORE_START']);
    expect(
      codes(E.yearFraction({ start: '2024-01-01', end: '2024-02-01', dayCount: 'X' as E.DayCount }))
        .errors,
    ).toEqual(['UNKNOWN_DAY_COUNT']);
  });
});

describe('amortization', () => {
  it('matches PMT and closes at exactly zero', () => {
    const r = E.amortizationSchedule({
      principal: 10000,
      annualRate: 0.08,
      periodsPerYear: 12,
      nper: 10,
      currency: 'USD',
    });
    expect(r.status).toBe('ok');
    expect(r.value!.payment).toBe('1037.03');
    expect(r.value!.rows.at(-1)!.closingBalance).toBe('0.00');
    expect(r.value!.rows).toHaveLength(10);
  });
  it('respects currencies without minor units', () => {
    const r = E.amortizationSchedule({
      principal: 1_000_000,
      annualRate: 0.02,
      periodsPerYear: 12,
      nper: 12,
      currency: 'JPY',
    });
    expect(r.value!.payment).toMatch(/^\d+$/);
  });
});

describe('money', () => {
  it('refuses to add different currencies', () => {
    expect(() => E.addMoney(E.money(1, 'USD'), E.money(1, 'TRY'))).toThrow(E.CurrencyMismatchError);
  });
  it('adds exactly in decimal', () => {
    expect(E.addMoney(E.money('0.1', 'USD'), E.money('0.2', 'USD')).amount).toBe('0.3');
  });
});
