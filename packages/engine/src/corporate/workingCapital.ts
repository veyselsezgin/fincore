import { Trace, type Result } from '../core/result.js';
import { requireFinite } from '../core/validate.js';

function positive(t: Trace, k: string, v: number, allowZero = false) {
  if (!requireFinite(t, k, v)) return;
  if (allowZero ? v < 0 : v <= 0)
    t.error({
      code: 'NOT_POSITIVE',
      message: `${k} must be ${allowZero ? 'zero or ' : ''}positive.`,
      field: k,
    });
}

export interface EoqInput {
  /** Annual demand (units). */
  annualDemand: number;
  /** Cost per order. */
  orderCost: number;
  /** Holding cost per unit per year. */
  holdingCost: number;
  leadTimeDays: number;
  safetyStock: number;
  daysInYear?: number;
}

export interface EoqOutput {
  eoq: number;
  ordersPerYear: number;
  orderingCost: number;
  holdingCostTotal: number;
  totalCost: number;
  reorderPoint: number;
  /** Total relevant cost curve around the EOQ, for charts. */
  curve: { q: number; ordering: number; holding: number; total: number }[];
}

/** Economic order quantity (Harris–Wilson): Q* = √(2DS/H). */
export function eoq(input: EoqInput): Result<EoqOutput> {
  const t = new Trace('workingCapital.eoq');
  const days = input.daysInYear ?? 365;
  positive(t, 'annualDemand', input.annualDemand);
  positive(t, 'orderCost', input.orderCost);
  positive(t, 'holdingCost', input.holdingCost);
  positive(t, 'leadTimeDays', input.leadTimeDays, true);
  positive(t, 'safetyStock', input.safetyStock, true);
  if (t.hasErrors) return t.fail();
  const { annualDemand: D, orderCost: S, holdingCost: H } = input;
  t.assume(
    'eoq',
    'Constant demand, instantaneous replenishment, no quantity discounts; safety stock holding cost is excluded from the trade-off.',
  );
  const q = Math.sqrt((2 * D * S) / H);
  const cost = (x: number) => ({
    q: x,
    ordering: (D / x) * S,
    holding: (x / 2) * H,
    total: (D / x) * S + (x / 2) * H,
  });
  const at = cost(q);
  const reorderPoint = (D / days) * input.leadTimeDays + input.safetyStock;
  const curve = Array.from({ length: 41 }, (_, i) => cost(q * (0.25 + (i * 2.75) / 40)));
  t.step('eoq', 'Economic order quantity', q, 'Q^* = \\sqrt{\\frac{2DS}{H}}');
  t.step('orders', 'Orders per year', D / q, 'D / Q^*');
  t.step('total', 'Total ordering + holding cost', at.total, '\\frac{D}{Q}S + \\frac{Q}{2}H');
  t.step('rop', 'Reorder point', reorderPoint, 'ROP = \\frac{D}{days} L + SS');
  return t.ok({
    eoq: q,
    ordersPerYear: D / q,
    orderingCost: at.ordering,
    holdingCostTotal: at.holding,
    totalCost: at.total,
    reorderPoint,
    curve,
  });
}

export interface BaumolInput {
  /** Total cash needed over the period. */
  annualCashNeed: number;
  /** Fixed cost per securities sale. */
  transactionCost: number;
  /** Interest rate on marketable securities, per period. */
  interestRate: number;
}

export interface BaumolOutput {
  optimalCash: number;
  averageCash: number;
  transfers: number;
  opportunityCost: number;
  tradingCost: number;
  totalCost: number;
}

/** Baumol (1952): C* = √(2TF / i). */
export function baumol(input: BaumolInput): Result<BaumolOutput> {
  const t = new Trace('workingCapital.baumol');
  positive(t, 'annualCashNeed', input.annualCashNeed);
  positive(t, 'transactionCost', input.transactionCost);
  positive(t, 'interestRate', input.interestRate);
  if (t.hasErrors) return t.fail();
  const { annualCashNeed: T, transactionCost: F, interestRate: i } = input;
  t.assume(
    'baumol',
    'Cash is used at a constant rate and replenished in equal lots by selling securities.',
  );
  const c = Math.sqrt((2 * T * F) / i);
  const opportunityCost = (c / 2) * i;
  const tradingCost = (T / c) * F;
  t.step('c', 'Optimal cash transfer size', c, 'C^* = \\sqrt{\\frac{2TF}{i}}');
  t.step('opp', 'Opportunity cost', opportunityCost, '\\frac{C}{2} i');
  t.step('trade', 'Trading cost', tradingCost, '\\frac{T}{C} F');
  return t.ok({
    optimalCash: c,
    averageCash: c / 2,
    transfers: T / c,
    opportunityCost,
    tradingCost,
    totalCost: opportunityCost + tradingCost,
  });
}

export interface MillerOrrInput {
  lowerLimit: number;
  transactionCost: number;
  /** Variance of daily net cash flows. */
  dailyVariance: number;
  /** Daily interest rate. */
  dailyRate: number;
}

export interface MillerOrrOutput {
  spread: number;
  returnPoint: number;
  upperLimit: number;
  averageCash: number;
}

/** Miller–Orr (1966): Z* = L + (3Fσ² / 4i)^(1/3); H* = 3Z* − 2L; average = (4Z* − L)/3. */
export function millerOrr(input: MillerOrrInput): Result<MillerOrrOutput> {
  const t = new Trace('workingCapital.millerOrr');
  positive(t, 'lowerLimit', input.lowerLimit, true);
  positive(t, 'transactionCost', input.transactionCost);
  positive(t, 'dailyVariance', input.dailyVariance);
  positive(t, 'dailyRate', input.dailyRate);
  if (t.hasErrors) return t.fail();
  const { lowerLimit: L, transactionCost: F, dailyVariance: s2, dailyRate: i } = input;
  t.assume(
    'mo',
    'Daily net cash flows are random with constant variance; securities are bought at the upper limit and sold at the lower limit, returning to Z*.',
  );
  const zMinusL = Math.cbrt((3 * F * s2) / (4 * i));
  const returnPoint = L + zMinusL;
  const upperLimit = 3 * returnPoint - 2 * L;
  const averageCash = (4 * returnPoint - L) / 3;
  t.step(
    'z',
    'Return point Z*',
    returnPoint,
    'Z^* = L + \\left(\\frac{3F\\sigma^2}{4i}\\right)^{1/3}',
  );
  t.step('h', 'Upper limit H*', upperLimit, 'H^* = 3Z^* - 2L');
  t.step('avg', 'Average cash balance', averageCash, '\\frac{4Z^* - L}{3}');
  return t.ok({ spread: upperLimit - L, returnPoint, upperLimit, averageCash });
}
