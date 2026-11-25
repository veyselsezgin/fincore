import { describe, expect, it } from 'vitest';
import golden from './fixtures/golden.json' with { type: 'json' };
import * as E from '../src/index.js';
import type { Result } from '../src/index.js';

/** Maps a fixture `fn` to the engine call and the scalar to compare. */
const runners: Record<string, (input: never) => { result: Result<unknown>; value: number | null }> =
  {
    pmt: (i) => scalar(E.pmt(i)),
    fv: (i) => scalar(E.fv(i)),
    pv: (i) => scalar(E.pv(i)),
    nper: (i) => scalar(E.nper(i)),
    mirr: (i) => scalar(E.mirr(i)),
    xnpv: (i) => scalar(E.xnpv(i)),
    npv: (i) => {
      const r = E.npv(i);
      return { result: r, value: r.value?.npv ?? null };
    },
    irr: (i) => {
      const r = E.irr(i);
      return { result: r, value: r.value?.irr ?? null };
    },
    xirr: (i) => {
      const r = E.xirr(i);
      return { result: r, value: r.value?.xirr ?? null };
    },
    yearFraction: (i) => {
      const r = E.yearFraction(i);
      return { result: r, value: r.value?.yearFraction ?? null };
    },
  };

function scalar(r: Result<number>) {
  return { result: r, value: r.value };
}

describe('golden fixtures', () => {
  for (const c of golden.cases) {
    it(`${c.id} — ${c.source}`, () => {
      const run = runners[c.fn];
      expect(run, `no runner for ${c.fn}`).toBeDefined();
      const { result, value } = run!(c.input as never);
      expect(result.errors).toEqual([]);
      expect(value).not.toBeNull();
      expect(Math.abs(value! - c.expected)).toBeLessThanOrEqual(c.tol);
      if ('expectWarning' in c) {
        expect(result.warnings.map((w) => w.code)).toContain(c.expectWarning);
      } else {
        expect(result.status).toBe('ok');
      }
      expect(result.engineVersion).toBe(E.ENGINE_VERSION);
    });
  }
});
