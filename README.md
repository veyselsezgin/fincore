# FinCore

Financial calculation platform: Calculate → Understand → Analyze → Decide → Report.

## Layout

```
packages/engine   @fincore/engine: pure TypeScript calculation engine (no UI/DB/IO)
apps/web          @fincore/web: React + Vite calculator UI, generated from a registry
docs/adr          architecture decisions: read these before changing the engine
```

## Commands

```
npm install
npm run dev         # open the platform at http://localhost:5173
npm run ci          # lint + format check + typecheck + tests
npm test            # all workspace tests
npm run build
```

## Engine status

| Area            | Functions                                                                                           |
| --------------- | --------------------------------------------------------------------------------------------------- |
| Core            | `Result` contract and `Trace` builder (ADR 0002), `normCdf`, seeded `Rng`                           |
| Solvers         | `brent`, `findRoots` (multi-root), `isIndeterminate`                                                |
| Day count       | 30/360-US, 30E/360, ACT/360, ACT/365F, ACT/ACT-ISDA                                                 |
| TVM             | `fv`, `pv`, `pmt`, `nper`, `rate`                                                                   |
| Cash flow       | `npv`, `irr` (all roots), `mirr`, `xnpv`, `xirr`                                                    |
| Cost of capital | `capm`, `wacc`, `waccFromCapm`                                                                      |
| Analysis        | `npvSensitivity` (2-D grid), `monteCarloNpv` (seeded), `compareProjects` (Fisher rate)              |
| Statements      | `analyzeStatements`: 20 ratios, DuPont 3/5-step, Altman Z/Z′/Z″, red flags, working-capital what-if |
| Money           | Currency-tagged `Money`, decimal `amortizationSchedule`                                             |

Tests: golden fixtures with sources (`packages/engine/test/fixtures/golden.json`), unit edge cases,
property-based tests (fast-check), and Monte Carlo checked against closed-form normal results.

## Web app

Calculators are descriptors in [apps/web/src/registry.ts](apps/web/src/registry.ts); the form,
results, charts, hand-off actions (e.g. WACC → NPV), Excel workbook and PDF report are generated
from them.

- **Import:** paste from Excel or load CSV into any cash-flow list. Handles `1,234.56` and
  `1.234,56`, accounting negatives `(1,000)`, currency marks, header rows, `DD.MM.YYYY` dates.
- **Excel export:** live formulas (`=NPV`, `=IRR`, `=MIRR`, `=XNPV`, `=XIRR`, `=PMT`, `SUMPRODUCT`
  sensitivity grid…). `apps/web/test/workbooks.test.ts` evaluates every exported formula with
  HyperFormula and checks it against the engine.
- **PDF:** feasibility report with inputs, results, charts, heatmap, steps and assumptions.

## Adding a formula

1. Implement it in `packages/engine/src`, returning `Result<T>` via `Trace`.
2. Add golden cases with a citable `source`, and at least one property test.
3. Document any convention in ADR 0004.
4. Bump `ENGINE_VERSION` if existing outputs can change.
