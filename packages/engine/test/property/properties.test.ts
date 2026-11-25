import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import * as E from '../../src/index.js';
import { npvRaw, tvmResidual } from '../../src/index.js';

const relClose = (a: number, b: number, rel: number) =>
  Math.abs(a - b) <= rel * Math.max(1, Math.abs(a), Math.abs(b));

/** Conventional project: one outflow, then non-negative inflows totalling k × the outflow. */
const conventionalProject = fc
  .record({
    outflow: fc.double({ min: 1, max: 1e7, noNaN: true }),
    weights: fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 1, maxLength: 40 }),
    k: fc.double({ min: 0.2, max: 20, noNaN: true }),
  })
  .filter(({ weights }) => weights.reduce((a, b) => a + b, 0) > 1e-6)
  .map(({ outflow, weights, k }) => {
    const s = weights.reduce((a, b) => a + b, 0);
    return [-outflow, ...weights.map((w) => (w / s) * k * outflow)];
  });

describe('properties: cash flows', () => {
  it('conventional projects have exactly one IRR and NPV(IRR) ≈ 0', () => {
    fc.assert(
      fc.property(conventionalProject, (cf) => {
        const r = E.irr({ cashFlows: cf });
        expect(r.status).toBe('ok');
        const scale = cf.reduce((a, b) => a + Math.abs(b), 0);
        expect(Math.abs(npvRaw(r.value!.irr!, cf))).toBeLessThan(1e-9 * scale);
      }),
    );
  });

  it('NPV is decreasing in the rate for conventional projects', () => {
    fc.assert(
      fc.property(
        conventionalProject,
        fc.double({ min: -0.5, max: 2, noNaN: true }),
        fc.double({ min: 0.001, max: 1, noNaN: true }),
        (cf, r, dr) => npvRaw(r, cf) > npvRaw(r + dr, cf),
      ),
    );
  });

  it('XIRR on yearly-spaced flows (365-day years) equals IRR', () => {
    fc.assert(
      fc.property(conventionalProject, (cf) => {
        const flows = cf.map((amount, i) => ({
          date: E.formatISODate(E.fromSerial(E.toSerial({ y: 2001, m: 1, d: 1 }) + 365 * i)),
          amount,
        }));
        const a = E.irr({ cashFlows: cf }).value!.irr!;
        const b = E.xirr({ flows }).value!.xirr!;
        expect(relClose(a, b, 1e-9)).toBe(true);
      }),
    );
  });
});

describe('properties: TVM round trips', () => {
  const tvmCase = fc.record({
    rate: fc.double({ min: -0.05, max: 0.3, noNaN: true }),
    nper: fc.integer({ min: 1, max: 480 }),
    pmt: fc.double({ min: -1e5, max: 1e5, noNaN: true }),
    pv: fc.double({ min: -1e6, max: 1e6, noNaN: true }),
    timing: fc.constantFrom<E.PaymentTiming>('end', 'begin'),
  });

  it('fv/pv/pmt are mutually consistent', () => {
    fc.assert(
      fc.property(tvmCase, ({ rate, nper, pmt, pv, timing }) => {
        const fv = E.fv({ rate, nper, pmt, pv, timing }).value!;
        const scale = Math.abs(pv) + Math.abs(pmt) * nper + Math.abs(fv) + 1;
        expect(Math.abs(tvmResidual(rate, nper, pmt, pv, fv, timing))).toBeLessThan(1e-9 * scale);
        expect(Math.abs(E.pv({ rate, nper, pmt, fv, timing }).value! - pv)).toBeLessThan(
          1e-7 * scale,
        );
        expect(Math.abs(E.pmt({ rate, nper, pv, fv, timing }).value! - pmt)).toBeLessThan(
          1e-7 * scale,
        );
      }),
    );
  });

  it('nper and rate recover the generating inputs for a savings plan', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.0005, max: 0.2, noNaN: true }),
        fc.integer({ min: 1, max: 240 }),
        // initial > 0 or n > 1, otherwise the rate is indeterminate (covered by a unit test).
        fc.double({ min: 1, max: 1e5, noNaN: true }),
        fc.double({ min: 1, max: 1e6, noNaN: true }),
        (rate, n, deposit, initial) => {
          const fv = E.fv({ rate, nper: n, pmt: -deposit, pv: -initial }).value!;
          expect(E.nper({ rate, pmt: -deposit, pv: -initial, fv }).value!).toBeCloseTo(n, 6);
          const r = E.rate({ nper: n, pmt: -deposit, pv: -initial, fv }).value!;
          expect(r.roots).toHaveLength(1);
          expect(relClose(r.rate!, rate, 1e-8)).toBe(true);
        },
      ),
    );
  });
});

describe('properties: amortization (decimal)', () => {
  it('principal repaid equals the loan exactly and the balance never increases', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 10_000, max: 1_000_000_000 }), // cents
        fc.double({ min: 0, max: 0.3, noNaN: true }),
        fc.constantFrom(1, 4, 12, 52),
        fc.integer({ min: 1, max: 360 }),
        (cents, annualRate, periodsPerYear, nper) => {
          const principal = (cents / 100).toFixed(2);
          const r = E.amortizationSchedule({
            principal,
            annualRate,
            periodsPerYear,
            nper,
            currency: 'TRY',
          });
          expect(r.status).not.toBe('error');
          const { rows } = r.value!;
          const repaid = rows.reduce((s, row) => s.plus(row.principal), new E.Dec(0));
          expect(repaid.toFixed(2)).toBe(principal);
          expect(rows.at(-1)!.closingBalance).toBe('0.00');
          for (const row of rows) {
            expect(new E.Dec(row.closingBalance).lte(row.openingBalance)).toBe(true);
            expect(new E.Dec(row.interest).plus(row.principal).toFixed(2)).toBe(row.payment);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('properties: day counts', () => {
  const date = fc
    .integer({
      min: E.toSerial({ y: 1950, m: 1, d: 1 }),
      max: E.toSerial({ y: 2150, m: 12, d: 31 }),
    })
    .map((s) => E.formatISODate(E.fromSerial(s)));

  it('actual-day conventions are additive over adjacent intervals', () => {
    fc.assert(
      fc.property(
        fc.array(date, { minLength: 3, maxLength: 3 }),
        fc.constantFrom<E.DayCount>('ACT/360', 'ACT/365F', 'ACT/ACT-ISDA'),
        (ds, dc) => {
          const [a, b, c] = [...ds].sort();
          const yf = (s: string, e: string) =>
            E.yearFraction({ start: s, end: e, dayCount: dc }).value!.yearFraction;
          expect(yf(a!, b!) + yf(b!, c!)).toBeCloseTo(yf(a!, c!), 10);
        },
      ),
    );
  });

  it('ISO dates round-trip through serial numbers', () => {
    fc.assert(fc.property(date, (d) => E.formatISODate(E.parseISODate(d)!) === d));
  });
});

describe('properties: robustness', () => {
  const fns = [
    E.fv,
    E.pv,
    E.pmt,
    E.nper,
    E.rate,
    E.npv,
    E.irr,
    E.mirr,
    E.xnpv,
    E.xirr,
    E.yearFraction,
    E.amortizationSchedule,
  ];
  it('no public calculator throws on arbitrary input objects', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...fns),
        fc.dictionary(fc.string(), fc.anything()),
        (fn, input) => {
          const r = (fn as (x: unknown) => E.Result<unknown>)(input);
          expect(['ok', 'warning', 'error']).toContain(r.status);
          if (r.status === 'error') expect(r.value).toBeNull();
        },
      ),
      { numRuns: 500 },
    );
  });
});
