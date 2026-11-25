import { readNumber } from './io/parse';

/**
 * Converters from form values (always text) to engine inputs. Shared by the registry and the
 * calculator modules; kept free of registry imports so there are no circular dependencies.
 */
type Raw = unknown;

/**
 * Parses user text in either number convention ("1,234.56" or "1.234,56", "12,5" = 12.5);
 * empty or malformed text becomes NaN so the engine reports it.
 */
export const num = (x: Raw): number =>
  typeof x === 'string' ? (readNumber(x)?.value ?? Number.NaN) : Number.NaN;
export const pct = (x: Raw) => num(x) / 100;
export const str = (x: Raw) => (typeof x === 'string' ? x : '');
export const list = (x: Raw) => (Array.isArray(x) ? (x as string[]).map(num) : []);
/** Optional number: empty text → null (feature off), otherwise parsed (NaN if malformed). */
export const optNum = (x: Raw): number | null =>
  typeof x === 'string' && x.trim() === '' ? null : num(x);
/** Number → input text without float noise (0.1 + 0.2 → "0.3"). */
export const txt = (x: number) => String(Number(x.toPrecision(12)));
