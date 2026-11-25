import { Trace, type Result } from '../core/result.js';
import {
  CURRENCY_MINOR_UNITS,
  Dec,
  isCurrencyCode,
  roundMoney,
  type CurrencyCode,
} from './money.js';

export interface AmortizationInput {
  /** Loan amount, positive. Number or decimal string. */
  principal: number | string;
  /** Nominal annual rate, e.g. 0.12 for 12%. Compounded at the payment frequency. */
  annualRate: number;
  periodsPerYear: number;
  /** Total number of payments (integer). */
  nper: number;
  currency: CurrencyCode;
}

export interface AmortizationRow {
  period: number;
  openingBalance: string;
  payment: string;
  interest: string;
  principal: string;
  closingBalance: string;
}

export interface AmortizationOutput {
  currency: CurrencyCode;
  /** Regular payment, rounded to the currency's minor unit. */
  payment: string;
  rows: AmortizationRow[];
  totalPaid: string;
  totalInterest: string;
}

/**
 * Level-payment amortization schedule computed in decimal arithmetic.
 * Interest each period is rounded to the minor unit; the final payment absorbs rounding so the
 * loan closes at exactly zero.
 */
export function amortizationSchedule(input: AmortizationInput): Result<AmortizationOutput> {
  const t = new Trace('money.amortizationSchedule');
  const { annualRate, periodsPerYear, nper, currency } = input;

  let P: Dec | null;
  try {
    P = new Dec(input.principal);
  } catch {
    P = null; // decimal.js throws on malformed strings; report it as a domain error below.
  }
  if (!P || !P.isFinite() || P.lte(0)) {
    t.error({
      code: 'PRINCIPAL_NOT_POSITIVE',
      message: 'Principal must be a positive amount.',
      field: 'principal',
    });
  }
  if (typeof annualRate !== 'number' || !Number.isFinite(annualRate) || annualRate < 0) {
    t.error({
      code: 'RATE_NEGATIVE',
      message: 'Annual rate must be zero or positive.',
      field: 'annualRate',
    });
  }
  if (!Number.isInteger(periodsPerYear) || periodsPerYear < 1 || periodsPerYear > 365) {
    t.error({
      code: 'INVALID_FREQUENCY',
      message: 'Payments per year must be an integer from 1 to 365.',
      field: 'periodsPerYear',
    });
  }
  if (!Number.isInteger(nper) || nper < 1 || nper > 1200) {
    t.error({
      code: 'INVALID_NPER',
      message: 'Number of payments must be an integer from 1 to 1200.',
      field: 'nper',
    });
  }
  if (!isCurrencyCode(currency)) {
    t.error({ code: 'UNKNOWN_CURRENCY', message: 'Unsupported currency.', field: 'currency' });
  }
  if (t.hasErrors || !P) return t.fail();

  const dp = CURRENCY_MINOR_UNITS[currency];
  t.assume(
    'currency',
    `All amounts in ${currency}, rounded to ${dp} decimal place(s), half away from zero.`,
  );
  t.assume(
    'compounding',
    `The annual rate is nominal, compounded ${periodsPerYear} time(s) per year.`,
  );
  t.assume('timing', 'Payments are made at the end of each period.');
  t.assume('finalPayment', 'The final payment is adjusted so the balance closes at exactly zero.');

  const r = new Dec(annualRate).div(periodsPerYear);
  t.step('periodRate', 'Rate per period', r.toNumber(), 'i = \\frac{APR}{m}');

  const rawPayment = r.isZero()
    ? P.div(nper)
    : P.mul(r).div(new Dec(1).minus(r.plus(1).pow(-nper)));
  const payment = roundMoney(rawPayment, currency);
  t.step(
    'payment',
    'Regular payment',
    payment.toFixed(dp),
    'PMT = \\frac{P \\cdot i}{1-(1+i)^{-n}}',
  );

  const rows: AmortizationRow[] = [];
  let balance = P;
  let totalPaid = new Dec(0);
  let totalInterest = new Dec(0);
  for (let k = 1; k <= nper; k++) {
    const interest = roundMoney(balance.mul(r), currency);
    let pay = payment;
    let princ = pay.minus(interest);
    if (k === nper || princ.gt(balance)) {
      princ = balance;
      pay = princ.plus(interest);
    }
    const closing = balance.minus(princ);
    rows.push({
      period: k,
      openingBalance: balance.toFixed(dp),
      payment: pay.toFixed(dp),
      interest: interest.toFixed(dp),
      principal: princ.toFixed(dp),
      closingBalance: closing.toFixed(dp),
    });
    totalPaid = totalPaid.plus(pay);
    totalInterest = totalInterest.plus(interest);
    balance = closing;
    if (balance.isZero() && k < nper) {
      t.warn({
        code: 'PAID_OFF_EARLY',
        message: `The loan is fully repaid after ${k} payments.`,
        params: { period: k },
      });
      break;
    }
  }

  const last = rows[rows.length - 1]!;
  if (last.payment !== payment.toFixed(dp)) {
    t.step('finalPayment', 'Final payment (rounding adjusted)', last.payment);
  }
  t.step('totalInterest', 'Total interest', totalInterest.toFixed(dp));
  return t.ok({
    currency,
    payment: payment.toFixed(dp),
    rows,
    totalPaid: totalPaid.toFixed(dp),
    totalInterest: totalInterest.toFixed(dp),
  });
}
