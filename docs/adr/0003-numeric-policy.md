# ADR 0003: Numeric policy (decimal vs. float64)

- Status: Accepted
- Date: 2026-11-25

## Context

"Use decimals" conflicts with numerical methods that need `exp`, `ln`, root finding and Monte Carlo.

## Decision

| Use                                                                 | Arithmetic                                   |
| ------------------------------------------------------------------- | -------------------------------------------- |
| Money-facing outputs: schedules, balances, ledgers, rounded amounts | `decimal.js` (`Dec`, precision 40)           |
| Solvers (IRR, YTM, implied vol), TVM, statistics, Monte Carlo       | IEEE-754 float64 with `log1p`/`expm1` near 0 |
| Display                                                             | Round only at the presentation boundary      |

- Money rounding: to the ISO 4217 minor unit, half away from zero (Excel `ROUND`).
- `Money` is `{ amount: string; currency }`. Decimal strings avoid float drift through JSON and
  the database. Adding two currencies throws, and FX conversion must be an explicit step with a
  stated rate.
- Root finding: grid scan in `(1+r)`-geometric space over (-99.99%, 10 000%], then Brent's
  method (x tolerance 1e-12). Known limitation: tangent (even-multiplicity) roots are not detected.
- Indeterminate problems (the rate cancels out of the equation) return `RATE_INDETERMINATE`
  instead of a list of meaningless roots.

## Tolerances verified by tests

- Solvers: `|NPV(IRR)| < 1e-9 · Σ|CF|`. Rate round-trips agree to a relative 1e-8.
- TVM identities: residual `< 1e-9 ·` scale.
- Amortization: principal repaid equals the loan amount exactly, and the final balance is exactly 0.
