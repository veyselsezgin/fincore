/** (1 + r)^n computed via exp/log1p for accuracy near r = 0. Requires r > -1. */
export function growth(r: number, n: number): number {
  return Math.exp(n * Math.log1p(r));
}

/**
 * Annuity factor ((1 + r)^n - 1) / r, with the exact limit n at r = 0.
 * Uses expm1/log1p so small rates do not lose precision to cancellation.
 */
export function annuityFactor(r: number, n: number): number {
  if (r === 0) return n;
  return Math.expm1(n * Math.log1p(r)) / r;
}

/** Number of sign changes in a sequence, ignoring zeros (Descartes' rule of signs). */
export function signChanges(values: readonly number[]): number {
  let changes = 0;
  let prev = 0;
  for (const v of values) {
    if (v === 0) continue;
    const s = Math.sign(v);
    if (prev !== 0 && s !== prev) changes++;
    prev = s;
  }
  return changes;
}
