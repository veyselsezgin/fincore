// Presentation-boundary rounding only (ADR 0003): the engine never rounds float outputs.

const money = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const fmtMoney = (x: number) => (Number.isFinite(x) ? money.format(x) : String(x));

export const fmtPct = (x: number, digits = 4) =>
  Number.isFinite(x)
    ? new Intl.NumberFormat('en-US', {
        minimumFractionDigits: Math.min(2, digits),
        maximumFractionDigits: digits,
      }).format(x * 100) + '%'
    : String(x);

export const fmtNum = (x: number, digits = 6) =>
  Number.isFinite(x)
    ? new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(x)
    : String(x);

const TRACE4 = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});
const TRACE_INT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/**
 * Calculation-trace display: integers grouped, other values to 4 decimals (1.7273); magnitudes
 * that 4 decimals cannot show (|x| < 0.0001, solver residuals) in scientific notation. Display
 * only: the engine value is untouched and `fullPrecision` gives it for the tooltip.
 */
export function fmtTrace(v: unknown): string {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return String(v);
    if (Number.isInteger(v) && Math.abs(v) < 1e15) return TRACE_INT.format(v);
    const a = Math.abs(v);
    if (a < 1e-4 || a >= 1e15) return v.toExponential(4);
    return TRACE4.format(v);
  }
  return String(v);
}

/** Full float64 precision (shortest round-trip representation), for tooltips and audits. */
export function fullPrecision(v: unknown): string {
  return typeof v === 'number' ? `${v} (full precision)` : String(v);
}
