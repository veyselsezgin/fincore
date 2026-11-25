import { Trace, type Result } from '../core/result.js';
import { requireFiniteArray, requireRateAboveMinusOne } from '../core/validate.js';
import { irr, npvRaw } from '../cashflow/cashflow.js';
import { DEFAULT_RATE_GRID, findRoots } from '../solvers/findRoots.js';
import { formatPcts } from '../tvm/tvm.js';

export interface CompareProjectsInput {
  rate: number;
  projectA: number[];
  projectB: number[];
}

export type Choice = 'A' | 'B' | 'tie' | 'undetermined';

export interface CompareProjectsOutput {
  npvA: number;
  npvB: number;
  irrA: number | null;
  irrB: number | null;
  /** Fisher (crossover) rates: where NPV_A = NPV_B, i.e. IRRs of A − B. */
  crossoverRates: number[];
  /** A − B per period, after padding the shorter project with zeros. */
  incremental: number[];
  choiceByNpv: Choice;
  choiceByIrr: Choice;
  /** True when NPV and IRR rank the projects differently at `rate`. */
  conflict: boolean;
}

/**
 * Mutually exclusive projects: NPV at the given rate, each IRR, and the Fisher crossover rate.
 * When the discount rate is below the crossover, NPV and IRR can rank the projects differently;
 * NPV is the value-maximising rule.
 */
export function compareProjects(input: CompareProjectsInput): Result<CompareProjectsOutput> {
  const t = new Trace('analysis.compareProjects');
  requireRateAboveMinusOne(t, 'rate', input.rate);
  requireFiniteArray(t, 'projectA', input.projectA, 2);
  requireFiniteArray(t, 'projectB', input.projectB, 2);
  if (t.hasErrors) return t.fail();

  const n = Math.max(input.projectA.length, input.projectB.length);
  const a = [...input.projectA, ...Array(n - input.projectA.length).fill(0)] as number[];
  const b = [...input.projectB, ...Array(n - input.projectB.length).fill(0)] as number[];
  t.assume('timing', 'Both projects start today (t = 0) and use the same discount rate.');
  t.assume('exclusive', 'The projects are mutually exclusive: only one can be chosen.');
  if (input.projectA.length !== input.projectB.length) {
    t.warn({
      code: 'UNEQUAL_LIVES',
      message:
        'The projects have different lives; the shorter one is padded with zero cash flows. Consider equivalent annual annuity for repeatable projects.',
    });
  }

  const npvA = npvRaw(input.rate, a);
  const npvB = npvRaw(input.rate, b);
  t.step('npvA', 'NPV of project A', npvA);
  t.step('npvB', 'NPV of project B', npvB);

  const ia = irr({ cashFlows: a });
  const ib = irr({ cashFlows: b });
  const irrA = ia.value?.irr ?? null;
  const irrB = ib.value?.irr ?? null;
  if (irrA === null)
    t.warn({
      code: 'IRR_UNAVAILABLE',
      message: `Project A has no unique IRR${ia.value ? ` (${formatPcts(ia.value.roots)})` : ''}.`,
    });
  if (irrB === null)
    t.warn({
      code: 'IRR_UNAVAILABLE',
      message: `Project B has no unique IRR${ib.value ? ` (${formatPcts(ib.value.roots)})` : ''}.`,
    });
  if (irrA !== null) t.step('irrA', 'IRR of project A', irrA);
  if (irrB !== null) t.step('irrB', 'IRR of project B', irrB);

  const incremental = a.map((x, i) => x - b[i]!);
  const crossoverRates = incremental.every((x) => x === 0)
    ? []
    : findRoots((r) => npvRaw(r, incremental), { grid: DEFAULT_RATE_GRID }).roots;
  if (crossoverRates.length === 0) {
    t.step('crossover', 'Crossover rate', 'none: one project has the higher NPV at every rate');
  } else {
    crossoverRates.forEach((r, i) =>
      t.step(`crossover${i}`, 'Fisher crossover rate (IRR of A − B)', r, 'NPV_A(r^*) = NPV_B(r^*)'),
    );
  }

  const rel = 1e-9 * Math.max(1, Math.abs(npvA), Math.abs(npvB));
  const choiceByNpv: Choice = Math.abs(npvA - npvB) <= rel ? 'tie' : npvA > npvB ? 'A' : 'B';
  const choiceByIrr: Choice =
    irrA === null || irrB === null
      ? 'undetermined'
      : Math.abs(irrA - irrB) < 1e-12
        ? 'tie'
        : irrA > irrB
          ? 'A'
          : 'B';
  const conflict =
    choiceByIrr !== 'undetermined' &&
    choiceByNpv !== 'tie' &&
    choiceByIrr !== 'tie' &&
    choiceByNpv !== choiceByIrr;
  t.step('choiceByNpv', 'Preferred by NPV', choiceByNpv);
  t.step('choiceByIrr', 'Preferred by IRR', choiceByIrr);
  if (conflict) {
    t.warn({
      code: 'NPV_IRR_CONFLICT',
      message: `NPV prefers project ${choiceByNpv} but IRR prefers project ${choiceByIrr}. The discount rate is on the other side of the crossover rate, so follow NPV: it measures the value added.`,
    });
  }
  return t.ok({
    npvA,
    npvB,
    irrA,
    irrB,
    crossoverRates,
    incremental,
    choiceByNpv,
    choiceByIrr,
    conflict,
  });
}
