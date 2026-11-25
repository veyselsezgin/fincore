/**
 * Calendar dates are plain ISO `YYYY-MM-DD` strings. Internally they become a serial day number
 * (days since 1970-01-01, UTC), so no time zone or DST effect can ever shift a cash flow.
 */
export interface CivilDate {
  y: number;
  m: number; // 1-12
  d: number; // 1-31
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m: number): number {
  return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]!;
}

/** Parses a strict ISO date; returns null for malformed or impossible dates (e.g. 2023-02-29). */
export function parseISODate(s: string): CivilDate | null {
  const match = ISO_RE.exec(s);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return { y, m, d };
}

export function toSerial(c: CivilDate): number {
  return Math.round(Date.UTC(c.y, c.m - 1, c.d) / 86_400_000);
}

export function fromSerial(n: number): CivilDate {
  const dt = new Date(n * 86_400_000);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

export function formatISODate(c: CivilDate): string {
  const p = (x: number, w: number) => String(x).padStart(w, '0');
  return `${p(c.y, 4)}-${p(c.m, 2)}-${p(c.d, 2)}`;
}

export function actualDays(a: CivilDate, b: CivilDate): number {
  return toSerial(b) - toSerial(a);
}
