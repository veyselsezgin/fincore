import { Decimal } from 'decimal.js';

/**
 * Decimal arithmetic for money-facing outputs (schedules, balances, rounding). A private
 * Decimal clone keeps the configuration independent of any other decimal.js user.
 * Rounding: half away from zero (matches Excel ROUND and common banking practice).
 */
export const Dec = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Dec = InstanceType<typeof Dec>;

/** ISO 4217 minor units for supported currencies. Extend deliberately, not dynamically. */
export const CURRENCY_MINOR_UNITS = {
  TRY: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  CHF: 2,
  JPY: 0,
} as const;

export type CurrencyCode = keyof typeof CURRENCY_MINOR_UNITS;

export function isCurrencyCode(x: unknown): x is CurrencyCode {
  return typeof x === 'string' && Object.prototype.hasOwnProperty.call(CURRENCY_MINOR_UNITS, x);
}

/**
 * An amount tagged with its currency. `amount` is a decimal string so it round-trips through
 * JSON and the database without float drift.
 */
export interface Money {
  readonly amount: string;
  readonly currency: CurrencyCode;
}

export function money(amount: Decimal.Value, currency: CurrencyCode): Money {
  return { amount: new Dec(amount).toFixed(), currency };
}

/** Rounds to the currency's minor unit. */
export function roundMoney(x: Decimal.Value, currency: CurrencyCode): Dec {
  return new Dec(x).toDecimalPlaces(CURRENCY_MINOR_UNITS[currency]);
}

export class CurrencyMismatchError extends Error {
  constructor(a: CurrencyCode, b: CurrencyCode) {
    super(`Currency mismatch: ${a} vs ${b}. Convert explicitly with a stated FX rate.`);
  }
}

/** Adds two Money values; mixing currencies is a programming error, never an implicit conversion. */
export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) throw new CurrencyMismatchError(a.currency, b.currency);
  return money(new Dec(a.amount).plus(b.amount), a.currency);
}
