import type { Trace } from './result.js';

/** Small input guards that record an error on the trace and return false when the check fails. */

export function requireFinite(t: Trace, field: string, v: unknown): v is number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    t.error({
      code: 'INPUT_NOT_FINITE',
      message: `${field} must be a finite number.`,
      field,
    });
    return false;
  }
  return true;
}

export function requireRateAboveMinusOne(t: Trace, field: string, v: unknown): v is number {
  if (!requireFinite(t, field, v)) return false;
  if (v <= -1) {
    t.error({
      code: 'RATE_OUT_OF_DOMAIN',
      message: `${field} must be greater than -100%.`,
      params: { value: v },
      field,
    });
    return false;
  }
  return true;
}

export function requireFiniteArray(
  t: Trace,
  field: string,
  v: unknown,
  minLength: number,
): v is number[] {
  if (!Array.isArray(v)) {
    t.error({ code: 'INPUT_NOT_ARRAY', message: `${field} must be a list of numbers.`, field });
    return false;
  }
  if (v.length < minLength) {
    t.error({
      code: 'TOO_FEW_VALUES',
      message: `${field} needs at least ${minLength} values.`,
      params: { min: minLength, got: v.length },
      field,
    });
    return false;
  }
  const bad = v.findIndex((x) => typeof x !== 'number' || !Number.isFinite(x));
  if (bad >= 0) {
    t.error({
      code: 'INPUT_NOT_FINITE',
      message: `${field}[${bad}] must be a finite number.`,
      params: { index: bad },
      field,
    });
    return false;
  }
  return true;
}
