export interface RootResult {
  root: number;
  iterations: number;
  converged: boolean;
  /** f(root) at termination. */
  residual: number;
}

export interface BrentOptions {
  /** Absolute x tolerance. Default 1e-12. */
  xtol?: number;
  /** Relative x tolerance. Default 4 * machine epsilon. */
  rtol?: number;
  maxIter?: number;
}

/**
 * Brent's method (Brent 1973, "Algorithms for Minimization without Derivatives", ch. 4) for a
 * root of f in [a, b]. Requires f(a) and f(b) to have opposite signs (or one to be zero).
 * Returns null if the interval does not bracket a root or f is not finite at the endpoints.
 */
export function brent(
  f: (x: number) => number,
  a: number,
  b: number,
  opts: BrentOptions = {},
): RootResult | null {
  const xtol = opts.xtol ?? 1e-12;
  const rtol = opts.rtol ?? 4 * Number.EPSILON;
  const maxIter = opts.maxIter ?? 200;

  let fa = f(a);
  let fb = f(b);
  if (!Number.isFinite(fa) || !Number.isFinite(fb)) return null;
  if (fa === 0) return { root: a, iterations: 0, converged: true, residual: 0 };
  if (fb === 0) return { root: b, iterations: 0, converged: true, residual: 0 };
  if (Math.sign(fa) === Math.sign(fb)) return null;

  let c = a;
  let fc = fa;
  let d = b - a;
  let e = d;

  for (let iter = 1; iter <= maxIter; iter++) {
    if (Math.sign(fb) === Math.sign(fc)) {
      c = a;
      fc = fa;
      d = b - a;
      e = d;
    }
    if (Math.abs(fc) < Math.abs(fb)) {
      a = b;
      b = c;
      c = a;
      fa = fb;
      fb = fc;
      fc = fa;
    }
    const tol = 2 * rtol * Math.abs(b) + 0.5 * xtol;
    const m = 0.5 * (c - b);
    if (Math.abs(m) <= tol || fb === 0) {
      return { root: b, iterations: iter, converged: true, residual: fb };
    }
    if (Math.abs(e) >= tol && Math.abs(fa) > Math.abs(fb)) {
      // Attempt inverse quadratic interpolation (or secant when a === c).
      const s = fb / fa;
      let p: number;
      let q: number;
      if (a === c) {
        p = 2 * m * s;
        q = 1 - s;
      } else {
        const qq = fa / fc;
        const r = fb / fc;
        p = s * (2 * m * qq * (qq - r) - (b - a) * (r - 1));
        q = (qq - 1) * (r - 1) * (s - 1);
      }
      if (p > 0) q = -q;
      else p = -p;
      if (2 * p < Math.min(3 * m * q - Math.abs(tol * q), Math.abs(e * q))) {
        e = d;
        d = p / q;
      } else {
        d = m;
        e = m;
      }
    } else {
      d = m;
      e = m;
    }
    a = b;
    fa = fb;
    b += Math.abs(d) > tol ? d : m > 0 ? tol : -tol;
    fb = f(b);
    if (!Number.isFinite(fb)) return null;
  }
  return { root: b, iterations: maxIter, converged: false, residual: fb };
}
