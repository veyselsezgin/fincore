import { ENGINE_VERSION } from './version.js';

export type Status = 'ok' | 'warning' | 'error';

/** Scalar values that may appear in a trace. Kept serialisable (JSON) on purpose. */
export type TraceValue = number | string | boolean | null;

/** One human-readable step of a calculation, used for step-by-step display, PDFs and AI narration. */
export interface Step {
  /** Stable key, usable as an i18n key suffix: `steps.<formulaId>.<id>`. */
  id: string;
  /** English default label. */
  label: string;
  /** Formula in LaTeX-ish notation, e.g. `FV = PV(1+r)^n`. */
  expression?: string;
  value?: TraceValue;
}

/** A convention or assumption the result depends on (timing, compounding, day count, currency...). */
export interface Assumption {
  id: string;
  text: string;
}

/**
 * Machine-readable issue. `code` is stable and drives i18n; `message` is an English default;
 * `params` hold the values interpolated into translated messages.
 */
export interface Issue {
  code: string;
  message: string;
  params?: Record<string, TraceValue>;
  /** Input field the issue refers to, so the UI can highlight it. */
  field?: string;
}

export interface Result<T> {
  status: Status;
  /** `null` exactly when `status === 'error'`. */
  value: T | null;
  steps: Step[];
  assumptions: Assumption[];
  warnings: Issue[];
  errors: Issue[];
  formulaId: string;
  engineVersion: string;
}

export type OkResult<T> = Result<T> & { status: 'ok' | 'warning'; value: T };

export function isOk<T>(r: Result<T>): r is OkResult<T> {
  return r.status !== 'error';
}

/**
 * Accumulates steps, assumptions and warnings while a calculation runs, then seals them into a
 * `Result`. Domain problems are reported through `fail()`; engine functions never throw for
 * invalid user input.
 */
export class Trace {
  readonly steps: Step[] = [];
  readonly assumptions: Assumption[] = [];
  readonly warnings: Issue[] = [];
  readonly errors: Issue[] = [];

  constructor(readonly formulaId: string) {}

  step(id: string, label: string, value?: TraceValue, expression?: string): this {
    const s: Step = { id, label };
    if (expression !== undefined) s.expression = expression;
    if (value !== undefined) s.value = value;
    this.steps.push(s);
    return this;
  }

  assume(id: string, text: string): this {
    this.assumptions.push({ id, text });
    return this;
  }

  warn(issue: Issue): this {
    this.warnings.push(issue);
    return this;
  }

  error(issue: Issue): this {
    this.errors.push(issue);
    return this;
  }

  get hasErrors(): boolean {
    return this.errors.length > 0;
  }

  /**
   * Folds a sub-calculation into this trace (composite calculators such as WACC-from-CAPM).
   * Step ids are prefixed; assumptions are de-duplicated by id. Returns the sub-result's value.
   */
  include<T>(prefix: string, r: Result<T>): T | null {
    for (const s of r.steps) this.steps.push({ ...s, id: `${prefix}.${s.id}` });
    for (const a of r.assumptions) {
      if (!this.assumptions.some((x) => x.id === a.id)) this.assumptions.push(a);
    }
    this.warnings.push(...r.warnings);
    this.errors.push(...r.errors);
    return r.value;
  }

  fail<T = never>(issue?: Issue): Result<T> {
    if (issue) this.errors.push(issue);
    return this.seal<T>('error', null);
  }

  ok<T>(value: T): OkResult<T> {
    if (this.errors.length > 0) {
      throw new Error(`Trace(${this.formulaId}).ok() called with recorded errors`);
    }
    return this.seal(this.warnings.length > 0 ? 'warning' : 'ok', value) as OkResult<T>;
  }

  private seal<T>(status: Status, value: T | null): Result<T> {
    return {
      status,
      value,
      steps: this.steps,
      assumptions: this.assumptions,
      warnings: this.warnings,
      errors: this.errors,
      formulaId: this.formulaId,
      engineVersion: ENGINE_VERSION,
    };
  }
}
