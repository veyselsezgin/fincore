import { brent, type BrentOptions, type RootResult } from './brent.js';

export interface FindRootsOptions extends BrentOptions {
  /** Sorted grid of x values to scan for sign changes. */
  grid: readonly number[];
  /** Roots closer than this are treated as duplicates. Default 1e-9. */
  dedupeTol?: number;
}

export interface FindRootsResult {
  roots: number[];
  /** Brackets where Brent failed to converge within maxIter. */
  unconverged: RootResult[];
}

/**
 * Finds all roots of f that are detectable as sign changes between adjacent grid points (plus
 * exact zeros on the grid), refining each bracket with Brent's method.
 *
 * Limitation: an even-multiplicity root (f touches zero without crossing) or two roots inside one
 * grid cell are not detected. Callers should choose a grid dense enough for their domain.
 */
export function findRoots(f: (x: number) => number, opts: FindRootsOptions): FindRootsResult {
  const { grid } = opts;
  const dedupeTol = opts.dedupeTol ?? 1e-9;
  const roots: number[] = [];
  const unconverged: RootResult[] = [];

  const push = (x: number) => {
    const last = roots[roots.length - 1];
    if (last === undefined || Math.abs(x - last) > dedupeTol * Math.max(1, Math.abs(x))) {
      roots.push(x);
    }
  };

  let prevX: number | undefined;
  let prevF: number | undefined;
  for (const x of grid) {
    const fx = f(x);
    if (!Number.isFinite(fx)) {
      prevX = undefined;
      prevF = undefined;
      continue;
    }
    if (fx === 0) {
      push(x);
    } else if (
      prevX !== undefined &&
      prevF !== undefined &&
      prevF !== 0 &&
      Math.sign(prevF) !== Math.sign(fx)
    ) {
      const r = brent(f, prevX, x, opts);
      if (r) {
        if (r.converged) push(r.root);
        else unconverged.push(r);
      }
    }
    prevX = x;
    prevF = fx;
  }
  return { roots, unconverged };
}

/**
 * True when f is (numerically) zero at widely spread sample points, i.e. the equation does not
 * depend on x and every x is a "solution". Example: a TVM problem whose flows all fall on the
 * same date. `scale` is the magnitude of the inputs, used for a relative tolerance.
 */
export function isIndeterminate(
  f: (x: number) => number,
  scale: number,
  samples: readonly number[] = [-0.5, -0.1, 0.03, 0.25, 1, 4],
): boolean {
  const tol = 1e-12 * Math.max(1, scale);
  return samples.every((x) => Math.abs(f(x)) <= tol);
}

/**
 * Default rate grid for IRR-like problems: dense near typical rates, sparser further out,
 * spanning (-99.99%, 10 000%]. Spacing is geometric in (1 + r).
 */
export function rateGrid(): number[] {
  const out: number[] = [];
  const lo = Math.log(1e-4); // 1 + r = 0.0001  -> r = -99.99%
  const hi = Math.log(101); // 1 + r = 101     -> r = 10 000%
  const n = 4000;
  for (let i = 0; i <= n; i++) out.push(Math.exp(lo + ((hi - lo) * i) / n) - 1);
  // Make sure 0 is sampled exactly: projects with NPV(0) = 0 are common in tests.
  out.push(0);
  out.sort((a, b) => a - b);
  return out;
}

export const DEFAULT_RATE_GRID: readonly number[] = Object.freeze(rateGrid());
