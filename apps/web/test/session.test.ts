import { describe, expect, it } from 'vitest';
import { fmtTrace, fullPrecision } from '../src/format';
import { CALCULATORS, defaults, type StatementGrid } from '../src/registry';
import {
  decodeScenario,
  encodeScenario,
  sanitizeValues,
  scenarioUrl,
  SCENARIO_PARAM,
} from '../src/session';

const calc = (id: string) => CALCULATORS.find((c) => c.id === id)!;

describe('scenario links', () => {
  it('round-trips every calculator’s inputs, including Turkish characters', () => {
    for (const c of CALCULATORS) {
      const v = defaults(c);
      if (c.id === 'statements') (v.statements as StatementGrid).periods[0] = 'Dönem 2023 ş';
      const back = decodeScenario(encodeScenario(c.id, v), CALCULATORS);
      expect(back?.calcId).toBe(c.id);
      expect(back?.values).toEqual(v);
    }
  });

  it('builds a URL with the query parameter and hash route', () => {
    const url = scenarioUrl('npv', defaults(calc('npv')), {
      origin: 'http://localhost:5173',
      pathname: '/',
    });
    expect(url).toMatch(
      new RegExp(`^http://localhost:5173/\\?${SCENARIO_PARAM}=[A-Za-z0-9_-]+#/npv$`),
    );
  });

  it('rejects garbage, unknown calculators and wrong versions', () => {
    expect(decodeScenario('not-base64!!', CALCULATORS)).toBeNull();
    const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    expect(decodeScenario(enc({ v: 1, c: 'nope', i: {} }), CALCULATORS)).toBeNull();
    expect(decodeScenario(enc({ v: 2, c: 'npv', i: { rate: '5' } }), CALCULATORS)).toBeNull();
  });
});

describe('sanitizeValues (untrusted input from storage or links)', () => {
  it('keeps valid fields and drops wrong shapes, unknown keys and invalid options', () => {
    const v = sanitizeValues(calc('npv'), {
      rate: '7,5',
      cashFlows: ['-100', { evil: true }], // wrong element type: whole field dropped
      firstPeriod: 'DROP TABLE', // not an option
      __proto__: { polluted: true },
      extra: 'ignored',
    });
    expect(v).toEqual({ rate: '7,5' });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('validates the statement grid: period count, item keys and row lengths', () => {
    const c = calc('statements');
    expect(
      sanitizeValues(c, { statements: { periods: ['a', 'b', 'c', 'd'], values: {} } }),
    ).toBeNull();
    const v = sanitizeValues(c, {
      statements: { periods: ['FY1', 'FY2'], values: { revenue: ['10'], hacker: ['1', '2'] } },
    })!;
    expect(v.statements).toEqual({ periods: ['FY1', 'FY2'], values: { revenue: ['10', ''] } });
  });

  it('caps string length', () => {
    expect(sanitizeValues(calc('npv'), { rate: 'x'.repeat(5000) })).toBeNull();
  });
});

describe('trace formatting', () => {
  it('shows 4 decimals, integers grouped, tiny values in scientific notation', () => {
    expect(fmtTrace(1.727272727)).toBe('1.7273');
    expect(fmtTrace(0.5)).toBe('0.5000');
    expect(fmtTrace(-2683.3149)).toBe('-2,683.3149');
    expect(fmtTrace(36)).toBe('36');
    expect(fmtTrace(1250000)).toBe('1,250,000');
    expect(fmtTrace(3.2e-12)).toBe('3.2000e-12');
    expect(fmtTrace('B')).toBe('B');
  });
  it('keeps full precision for the tooltip', () => {
    expect(fullPrecision(0.1 + 0.2)).toBe('0.30000000000000004 (full precision)');
  });
});

describe('out-of-balance guard', () => {
  it('raises an alert with the exact variance and flags the affected period columns', () => {
    const c = calc('statements');
    const v = defaults(c);
    const g = v.statements as StatementGrid;
    g.values.cash = ['120', '90', '80']; // FY2025 assets +20 → out of balance
    const view = c.compute(v).view!;
    expect(view.alerts).toHaveLength(1);
    expect(view.alerts![0]!.title).toBe('Out of Balance');
    expect(view.alerts![0]!.items).toEqual([
      'FY2025: assets 2,970.00 vs liabilities + equity 2,950.00, variance 20.00',
    ]);
    const liquidity = view.tables!.find((t) => t.title === 'Liquidity')!;
    expect(liquidity.columns).toContain('FY2025 ⚠');
    expect(liquidity.note).toMatch(/FY2025: balance sheet out of balance/);
  });
  it('shows no alert for the balanced sample case', () => {
    const c = calc('statements');
    expect(c.compute(defaults(c)).view!.alerts).toEqual([]);
  });
});
