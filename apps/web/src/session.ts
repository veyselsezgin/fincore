import type { Calculator, Field, FieldValue, Values } from './registry';

/**
 * Session persistence (localStorage) and shareable scenario links.
 *
 * Anything read back, from storage or from a URL someone sent, is untrusted: it is validated
 * field by field against the calculator's descriptor and dropped where it does not fit, so a
 * stale or tampered payload can never inject unexpected shapes into the inputs.
 */

export const STORAGE_KEY = 'fincore.session.v1';
export const SCENARIO_PARAM = 'scenario';
const MAX_TEXT = 200;
const MAX_ROWS = 600;

const isStr = (x: unknown): x is string => typeof x === 'string' && x.length <= MAX_TEXT;
const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

/** Returns the value if it matches the field's shape, otherwise undefined. */
export function sanitizeField(field: Field, raw: unknown): FieldValue | undefined {
  switch (field.kind) {
    case 'number':
    case 'date':
    case 'slider':
      return isStr(raw) ? raw : undefined;
    case 'select':
      return isStr(raw) && field.options.some((o) => o.value === raw) ? raw : undefined;
    case 'numberList':
      return Array.isArray(raw) && raw.length >= 1 && raw.length <= MAX_ROWS && raw.every(isStr)
        ? [...raw]
        : undefined;
    case 'datedFlows':
      return Array.isArray(raw) &&
        raw.length >= 1 &&
        raw.length <= MAX_ROWS &&
        raw.every((r) => isRecord(r) && isStr(r.date) && isStr(r.amount))
        ? raw.map((r) => ({ date: r.date as string, amount: r.amount as string }))
        : undefined;
    case 'distFlows': {
      const types = ['fixed', 'normal', 'triangular', 'uniform'];
      return Array.isArray(raw) &&
        raw.length >= 1 &&
        raw.length <= MAX_ROWS &&
        raw.every(
          (r) =>
            isRecord(r) &&
            types.includes(r.type as string) &&
            isStr(r.a) &&
            isStr(r.b) &&
            isStr(r.c),
        )
        ? raw.map((r) => ({ type: r.type, a: r.a, b: r.b, c: r.c }) as never)
        : undefined;
    }
    case 'statementGrid': {
      if (!isRecord(raw) || !Array.isArray(raw.periods) || !isRecord(raw.values)) return undefined;
      const periods = raw.periods;
      if (periods.length < 1 || periods.length > field.maxPeriods || !periods.every(isStr))
        return undefined;
      const allowed = new Set(Object.keys(field.default.values));
      const values: Record<string, string[]> = {};
      for (const [k, row] of Object.entries(raw.values)) {
        if (!allowed.has(k) || !Array.isArray(row) || !row.every(isStr)) continue;
        values[k] = periods.map((_, i) => (row[i] as string | undefined) ?? '');
      }
      return { periods: [...periods], values };
    }
    case 'benchmarks': {
      if (!isRecord(raw)) return undefined;
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(raw))
        if (/^[a-zA-Z]{2,40}$/.test(k) && isStr(v)) out[k] = v;
      return out;
    }
  }
}

/** Keeps only the fields the calculator knows, in valid shapes; missing ones fall back later. */
export function sanitizeValues(calc: Calculator, raw: unknown): Values | null {
  if (!isRecord(raw)) return null;
  const out: Values = {};
  for (const f of calc.fields) {
    const v = sanitizeField(f, raw[f.key]);
    if (v !== undefined) out[f.key] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

// --- localStorage ----------------------------------------------------------------------------

export function loadSession(calcs: Calculator[]): Record<string, Values> {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as unknown;
    if (!isRecord(raw) || raw.v !== 1 || !isRecord(raw.inputs)) return {};
    const out: Record<string, Values> = {};
    for (const c of calcs) {
      const v = sanitizeValues(c, raw.inputs[c.id]);
      if (v) out[c.id] = v;
    }
    return out;
  } catch {
    return {}; // private mode, blocked storage or corrupt JSON: start fresh
  }
}

export function saveSession(inputs: Record<string, Values>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, inputs }));
  } catch {
    // Storage unavailable or full: persistence is a convenience, never a requirement.
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

// --- shareable links -------------------------------------------------------------------------

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function encodeScenario(calcId: string, values: Values): string {
  return toBase64Url(JSON.stringify({ v: 1, c: calcId, i: values }));
}

export function decodeScenario(
  token: string,
  calcs: Calculator[],
): { calcId: string; values: Values } | null {
  try {
    if (token.length > 20_000) return null;
    const raw = JSON.parse(fromBase64Url(token)) as unknown;
    if (!isRecord(raw) || raw.v !== 1 || typeof raw.c !== 'string') return null;
    const calc = calcs.find((c) => c.id === raw.c);
    if (!calc) return null;
    const values = sanitizeValues(calc, raw.i);
    return values ? { calcId: calc.id, values } : null;
  } catch {
    return null;
  }
}

/** Link that reopens this calculator with these inputs (query parameter + hash route). */
export function scenarioUrl(
  calcId: string,
  values: Values,
  location: Pick<Location, 'origin' | 'pathname'>,
): string {
  return `${location.origin}${location.pathname}?${SCENARIO_PARAM}=${encodeScenario(calcId, values)}#/${calcId}`;
}
