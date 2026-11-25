# ADR 0001: Calculation engine is an isolated, pure TypeScript package

- Status: Accepted
- Date: 2026-11-25

## Context

FinCore will expose the same formulas through calculator pages, models, the AI assistant, exports
and reports. If any of these re-implements a formula, results drift ("two NPVs").

## Decision

- All financial math lives in `packages/engine` (`@fincore/engine`).
- The engine has no dependency on React, Next.js, the database, the network or the file system.
  ESLint enforces this (`no-restricted-imports`, `no-console` on `packages/engine/src`).
- Its only runtime dependency is `decimal.js` (see ADR 0003).
- Every other part of the system calls the engine. Nothing else computes financial results.

## Consequences

- The engine can run in the browser, in Web Workers, on the server and in tests unchanged.
- Calculators work without login: the UI can call the engine directly.
- Any new formula needs engine code, golden fixtures and property tests before it gets a UI.
