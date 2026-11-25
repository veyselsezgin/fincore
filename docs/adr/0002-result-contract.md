# ADR 0002: Every calculation returns a traced `Result`, never a bare number

- Status: Accepted
- Date: 2026-11-25

## Context

The product promises calculation transparency, AI explanations grounded in real numbers,
reproducible saved results, and no misleading output.

## Decision

Every public engine function returns `Result<T>` (`packages/engine/src/core/result.ts`):

| Field           | Purpose                                                                    |
| --------------- | -------------------------------------------------------------------------- |
| `status`        | `ok`, `warning` (value valid but needs attention) or `error`               |
| `value`         | The output; `null` exactly when `status` is `error`                        |
| `steps`         | Ordered intermediate values with LaTeX expressions (UI, PDF, AI narration) |
| `assumptions`   | Conventions the result depends on (timing, day count, rounding...)         |
| `warnings`      | e.g. `MULTIPLE_IRR`, `NEGATIVE_NPER`, `SOLVER_NOT_CONVERGED`               |
| `errors`        | e.g. `NO_IRR`, `RATE_OUT_OF_DOMAIN`, `INVALID_DATE`                        |
| `formulaId`     | Stable id, e.g. `cashflow.irr`                                             |
| `engineVersion` | Stored with saved calculations for reproducibility                         |

Rules:

1. Invalid user input is reported as an error result. Public functions never throw for it.
   A property test feeds arbitrary objects to every calculator to enforce this.
2. Issues carry a stable `code`, an English default `message`, `params` for i18n, and an
   optional `field` for highlighting the input.
3. When a problem has several valid answers (several IRRs), the function returns all of them, sets
   the primary value to `null` and warns. It never picks one silently.
4. Programming errors (such as adding `Money` in two currencies) may throw. They are bugs, not
   user input.

## Consequences

- Result objects are JSON-serialisable and can be stored as JSONB.
- The AI layer narrates `steps` and checks that every number it mentions appears in the result.
- Bump `ENGINE_VERSION` whenever a change can alter a numeric output.
