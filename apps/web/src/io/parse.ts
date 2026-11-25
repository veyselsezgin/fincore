/**
 * Parses pasted spreadsheet ranges and CSV text into cash flows.
 *
 * Handles both number styles seen in practice:
 *   "1,234.56" (US/UK Excel)     "1.234,56" (Turkish/European Excel)
 * Ambiguous tokens are resolved by the `decimal` option ('auto' picks the style that makes
 * every token parse, preferring the one implied by unambiguous tokens) and reported.
 */

export type DecimalStyle = 'auto' | 'dot' | 'comma';

export interface ParseOptions {
  decimal?: DecimalStyle;
}

export interface ParseReport<T> {
  values: T[];
  /** Rows skipped because they had no number (headers, blank lines, notes). */
  skipped: { line: number; text: string }[];
  /** Problems that stop the import. */
  errors: string[];
  /** Interpretations the user should check. */
  notes: string[];
  decimalStyle: 'dot' | 'comma';
}

export const MAX_IMPORT_BYTES = 1_000_000;
export const MAX_IMPORT_ROWS = 10_000;

function splitRows(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const delimiter = text.includes('\t') ? '\t' : text.includes(';') ? ';' : null;
  return lines.map((line) => {
    if (delimiter) return line.split(delimiter).map((c) => c.trim());
    // No tab/semicolon: commas separate columns only when they are followed by a space or
    // when the line has several comma-separated fields; "1,5" stays a single number token.
    const parts = line
      .split(/,(?=\s)|\s+/)
      .map((c) => c.trim())
      .filter((c) => c !== '');
    return parts.length > 0 ? parts : [''];
  });
}

const DOT_RE = /^[-+]?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/; // 1,234.56 / 1234.56
const COMMA_RE = /^[-+]?(\d{1,3}(\.\d{3})+|\d+)(,\d+)?$/; // 1.234,56 / 1234,56

function cleanToken(raw: string): { token: string; negative: boolean } {
  let s = raw.trim().replace(/[\s\u00a0\u202f']/g, ''); // spaces (incl. U+00A0, U+202F) and apostrophe thousands marks
  s = s
    .replace(/^(TRY|USD|EUR|GBP|TL|₺|\$|€|£)/i, '')
    .replace(/(TRY|USD|EUR|GBP|TL|₺|\$|€|£)$/i, '');
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true; // accounting negatives: (1,000)
    s = s.slice(1, -1);
  }
  s = s.replace(/^−/, '-'); // unicode minus
  return { token: s, negative };
}

function parseWith(token: string, style: 'dot' | 'comma'): number | null {
  if (style === 'dot') {
    if (!DOT_RE.test(token)) return null;
    return Number(token.replace(/,/g, ''));
  }
  if (!COMMA_RE.test(token)) return null;
  return Number(token.replace(/\./g, '').replace(',', '.'));
}

/** True when the token reads differently under the two styles (e.g. "1.500" or "2,250"). */
function isAmbiguous(token: string): boolean {
  const a = parseWith(token, 'dot');
  const b = parseWith(token, 'comma');
  return a !== null && b !== null && a !== b;
}

function chooseStyle(
  tokens: string[],
  pref: DecimalStyle,
  notes: string[],
  hint?: 'dot' | 'comma',
): 'dot' | 'comma' {
  if (pref === 'dot' || pref === 'comma') return pref;
  const dotOk = tokens.filter((t) => parseWith(t, 'dot') !== null).length;
  const commaOk = tokens.filter((t) => parseWith(t, 'comma') !== null).length;
  const unambiguousDot = tokens.filter(
    (t) => parseWith(t, 'dot') !== null && parseWith(t, 'comma') === null,
  ).length;
  const unambiguousComma = tokens.filter(
    (t) => parseWith(t, 'comma') !== null && parseWith(t, 'dot') === null,
  ).length;
  let style: 'dot' | 'comma';
  if (unambiguousComma > unambiguousDot) style = 'comma';
  else if (unambiguousDot > unambiguousComma) style = 'dot';
  else if (hint && commaOk === dotOk) style = hint;
  else style = commaOk > dotOk ? 'comma' : 'dot';
  const ambiguous = tokens.filter(isAmbiguous);
  if (ambiguous.length > 0) {
    notes.push(
      `${ambiguous.length} value(s) such as "${ambiguous[0]}" could be read two ways; read with ${
        style === 'dot' ? 'dot' : 'comma'
      } as the decimal separator${hint === style ? ' (matching the date format)' : ''}. Change the setting if that is wrong.`,
    );
  }
  return style;
}

/** Each row contributes its last numeric cell (so "Year 1<TAB>12,000" works). */
export function parseNumberList(text: string, opts: ParseOptions = {}): ParseReport<number> {
  const errors: string[] = [];
  const notes: string[] = [];
  const skipped: { line: number; text: string }[] = [];
  if (text.length > MAX_IMPORT_BYTES) {
    return {
      values: [],
      skipped,
      errors: ['The data is larger than 1 MB.'],
      notes,
      decimalStyle: 'dot',
    };
  }
  const rows = splitRows(text);
  if (rows.length > MAX_IMPORT_ROWS) errors.push(`More than ${MAX_IMPORT_ROWS} rows.`);

  const candidates = rows.map((cells) => {
    for (let i = cells.length - 1; i >= 0; i--) {
      const { token } = cleanToken(cells[i]!);
      if (/\d/.test(token) && (DOT_RE.test(token) || COMMA_RE.test(token))) return cells[i]!;
    }
    return null;
  });
  const style = chooseStyle(
    candidates.filter((c): c is string => c !== null).map((c) => cleanToken(c).token),
    opts.decimal ?? 'auto',
    notes,
  );

  const values: number[] = [];
  candidates.forEach((cell, i) => {
    const line = rows[i]!.join(' ').trim();
    if (cell === null) {
      if (line !== '') skipped.push({ line: i + 1, text: line });
      return;
    }
    const { token, negative } = cleanToken(cell);
    const v = parseWith(token, style);
    if (v === null || !Number.isFinite(v)) {
      errors.push(
        `Line ${i + 1}: "${cell}" is not a number with ${style === 'dot' ? 'dot' : 'comma'} decimals.`,
      );
      return;
    }
    values.push(negative ? -v : v);
  });
  if (values.length === 0 && errors.length === 0) errors.push('No numbers found.');
  return { values, skipped, errors, notes, decimalStyle: style };
}

export interface ReadNumber {
  value: number;
  /** Canonical dot-decimal text, safe for exact decimal arithmetic. */
  canonical: string;
  /** True when the text could also be read the other way ("1,500", "2.250"). */
  ambiguous: boolean;
  /** True when the separators were interpreted (the text was not already canonical). */
  reinterpreted: boolean;
}

/**
 * Reads one typed number in either convention: "1,234.56", "1.234,56", "12,5", "(1,000)", "−5".
 * Rules: with both separators the last one is the decimal mark; a lone comma is a decimal mark
 * unless it is followed by exactly three digits (then thousands, flagged ambiguous); a lone dot
 * is a decimal mark unless it repeats in 3-digit groups ("1.234.567").
 */
export function readNumber(text: string): ReadNumber | null {
  const raw = text.trim();
  if (raw === '') return null;
  const { token, negative } = cleanToken(raw);
  if (!/^[-+]?[\d.,]+$/.test(token) || !/\d/.test(token)) return null;
  const hasDot = token.includes('.');
  const hasComma = token.includes(',');
  let style: 'dot' | 'comma';
  let ambiguous = false;
  if (hasDot && hasComma) style = token.lastIndexOf(',') > token.lastIndexOf('.') ? 'comma' : 'dot';
  else if (hasComma) {
    const thousandsOnly = /^[-+]?\d{1,3}(,\d{3})+$/.test(token);
    style = thousandsOnly ? 'dot' : 'comma';
    ambiguous = thousandsOnly && (token.match(/,/g) ?? []).length === 1;
  } else if (hasDot) {
    const groups = /^[-+]?\d{1,3}(\.\d{3}){2,}$/.test(token);
    style = groups ? 'comma' : 'dot';
    ambiguous = !groups && /^[-+]?\d{1,3}\.\d{3}$/.test(token);
  } else style = 'dot';
  const v = parseWith(token, style);
  if (v === null || !Number.isFinite(v)) return null;
  const value = negative ? -v : v;
  const canonical = String(value);
  return { value, canonical, ambiguous, reinterpreted: canonical !== raw };
}

export interface MatrixRow {
  line: number;
  /** Non-numeric cells joined with spaces (the row label). */
  label: string;
  /** Numeric cells in order, parsed with one decimal style for the whole block. */
  numbers: number[];
}

/** Rows of "label, number, number, …" (pasted statements). Empty cells and dashes count as 0. */
export function parseMatrix(
  text: string,
  opts: ParseOptions = {},
): { rows: MatrixRow[]; notes: string[]; errors: string[]; decimalStyle: 'dot' | 'comma' } {
  const notes: string[] = [];
  const errors: string[] = [];
  if (text.length > MAX_IMPORT_BYTES)
    return { rows: [], notes, errors: ['The data is larger than 1 MB.'], decimalStyle: 'dot' };
  const raw = splitRows(text);
  const isNum = (c: string) => {
    const { token } = cleanToken(c);
    return /\d/.test(token) && (DOT_RE.test(token) || COMMA_RE.test(token));
  };
  const style = chooseStyle(
    raw
      .flat()
      .filter(isNum)
      .map((c) => cleanToken(c).token),
    opts.decimal ?? 'auto',
    notes,
  );
  const rows: MatrixRow[] = [];
  raw.forEach((cells, i) => {
    const label: string[] = [];
    const numbers: number[] = [];
    for (const c of cells) {
      if (isNum(c)) {
        const { token, negative } = cleanToken(c);
        const v = parseWith(token, style);
        if (v === null) errors.push(`Line ${i + 1}: "${c}" is not a number.`);
        else numbers.push(negative ? -v : v);
      } else if (/^[-–—]$/.test(c.trim()) && label.length > 0) {
        numbers.push(0); // accounting dash = zero
      } else if (c.trim() !== '' && numbers.length === 0) {
        label.push(c.trim());
      }
    }
    if (label.length > 0 || numbers.length > 0)
      rows.push({ line: i + 1, label: label.join(' '), numbers });
  });
  return { rows, notes, errors, decimalStyle: style };
}

const ISO_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const DMY_DATE = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;

/** Accepts YYYY-MM-DD or DD.MM.YYYY. Slash dates are rejected as ambiguous (M/D vs D/M). */
export function parseDate(s: string): string | null | 'ambiguous' {
  const t = s.trim();
  let y: number, m: number, d: number;
  const iso = ISO_DATE.exec(t);
  const dmy = DMY_DATE.exec(t);
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (dmy) [d, m, y] = [Number(dmy[1]), Number(dmy[2]), Number(dmy[3])];
  else if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(t)) return 'ambiguous';
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export interface DatedValue {
  date: string;
  amount: number;
}

/** Rows of "date, amount" (either column order). */
export function parseDatedList(text: string, opts: ParseOptions = {}): ParseReport<DatedValue> {
  const errors: string[] = [];
  const notes: string[] = [];
  const skipped: { line: number; text: string }[] = [];
  if (text.length > MAX_IMPORT_BYTES) {
    return {
      values: [],
      skipped,
      errors: ['The data is larger than 1 MB.'],
      notes,
      decimalStyle: 'dot',
    };
  }
  const rows = splitRows(text);
  const parsedRows = rows.map((cells, i) => {
    let date: string | null = null;
    let amountCell: string | null = null;
    for (const c of cells) {
      const d = parseDate(c);
      if (d === 'ambiguous') {
        errors.push(`Line ${i + 1}: "${c}" is ambiguous. Use YYYY-MM-DD or DD.MM.YYYY.`);
        return null;
      }
      if (d && !date) date = d;
      else if (/\d/.test(c)) amountCell = c;
    }
    return { date, amountCell, line: i + 1, text: cells.join(' ').trim() };
  });

  const tokens = parsedRows
    .filter((r): r is NonNullable<typeof r> => !!r && !!r.date && r.amountCell !== null)
    .map((r) => cleanToken(r.amountCell!).token);
  // DD.MM.YYYY dates come from Turkish/European spreadsheets, which use comma decimals.
  const dmy = rows.some((cells) => cells.some((c) => DMY_DATE.test(c.trim())));
  const style = chooseStyle(tokens, opts.decimal ?? 'auto', notes, dmy ? 'comma' : undefined);

  const values: DatedValue[] = [];
  for (const r of parsedRows) {
    if (!r) continue;
    if (!r.date || r.amountCell === null) {
      if (r.text !== '') skipped.push({ line: r.line, text: r.text });
      continue;
    }
    const { token, negative } = cleanToken(r.amountCell);
    const v = parseWith(token, style);
    if (v === null) {
      errors.push(`Line ${r.line}: "${r.amountCell}" is not a number.`);
      continue;
    }
    values.push({ date: r.date, amount: negative ? -v : v });
  }
  if (values.length === 0 && errors.length === 0) errors.push('No "date + amount" rows found.');
  return { values, skipped, errors, notes, decimalStyle: style };
}

/** CSV-safe cell: quotes when needed, and neutralises formula injection (=, +, -, @). */
export function csvCell(v: string | number): string {
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  let s = v;
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s)) s = `'${s}`;
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
