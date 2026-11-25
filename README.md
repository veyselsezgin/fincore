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

## Engine status (v0.4.0)

| Area                        | Functions                                                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Core                        | `Result` / `Trace` contract (ADR 0002), `normCdf`, `normInv`, seeded `Rng`                                                      |
| Solvers & dates             | Brent, multi-root scan; 30/360-US, 30E/360, ACT/360, ACT/365F, ACT/ACT-ISDA                                                     |
| TVM & cash flows            | FV/PV/PMT/NPER/RATE; NPV, IRR (all roots), MIRR, XNPV, XIRR; payback, discounted payback, PI; Fisher; bottom-up project FCF     |
| Cost of capital & structure | CAPM, WACC, Hamada unlever/re-lever; DOL/DFL/DTL, break-even, EBIT-EPS indifference                                             |
| Working capital             | EOQ, Baumol, Miller–Orr                                                                                                         |
| Fixed income                | Bond price/yield, accrued, current yield, Macaulay/modified/effective duration, convexity (Excel PRICE/YIELD/DURATION parity)   |
| Equity valuation            | Gordon, multi-stage DDM, FCFF/FCFE DCF                                                                                          |
| Portfolio & risk            | Mean–variance metrics (PSD-checked), Sharpe, Treynor, Jensen; parametric VaR/ES; Monte Carlo NPV; sensitivity; Fisher crossover |
| Statements                  | 20 ratios, DuPont 3/5-step, Altman Z/Z′/Z″, red flags, covenants, effective tax rate, working-capital what-if                   |
| Money                       | Currency-tagged `Money`, decimal amortization                                                                                   |

Tests: golden fixtures with sources, Excel documentation examples, property-based tests (fast-check),
and Monte Carlo checked against closed-form results.

## Web app

20 calculators are descriptors in [apps/web/src/registry.ts](apps/web/src/registry.ts) and
[apps/web/src/calculators/](apps/web/src/calculators/); forms, results, charts, hand-offs (WACC → NPV,
statements → WACC tax rate, portfolio → VaR), Excel, CSV and PDF exports are generated from them.

- **Inputs:** both number conventions (`1,234.56` / `1.234,56`), paste from Excel, CSV and `.xlsx`
  upload (values only; macro files and fake files refused).
- **Sessions:** inputs persist in the browser; shareable scenario links; named cases with
  side-by-side comparison.
- **Excel export:** live formulas, each verified against the engine with HyperFormula.
- **Themes:** dark terminal (default) and light.

## Adding a formula

1. Implement it in `packages/engine/src`, returning `Result<T>` via `Trace`.
2. Add golden cases with a citable `source`, and at least one property test.
3. Document any convention in ADR 0004.
4. Bump `ENGINE_VERSION` if existing outputs can change.
