import * as E from '@fincore/engine';
import { num, pct, str } from '../fieldValues';
import { fmtMoney, fmtNum, fmtPct } from '../format';
import type { Calculator, Output } from '../registry';

const x2 = (v: number | null) => (v === null ? 'n/a' : `${fmtNum(v, 2)}×`);
const units = (v: number | null) => (v === null ? 'n/a' : `${fmtNum(v, 0)} units`);

function leverageInputs(v: Record<string, unknown>): E.LeverageInput {
  return {
    units: num(v.units),
    price: num(v.price),
    variableCost: num(v.variableCost),
    fixedCosts: num(v.fixedCosts),
    interest: num(v.interest),
    taxRate: pct(v.taxRate),
    shares: num(v.shares),
  };
}

export const leverageCalc: Calculator = {
  id: 'leverage',
  category: 'Capital Structure',
  title: 'Operating & Financial Leverage',
  description:
    'DOL, DFL and DTL at the current sales volume, with operating and total break-even points. Shows how a change in sales flows through to EBIT and EPS.',
  fields: [
    { key: 'units', label: 'Units Sold (Q)', kind: 'number', default: '10000' },
    { key: 'price', label: 'Price / Unit (P)', kind: 'number', default: '50' },
    { key: 'variableCost', label: 'Variable Cost / Unit (V)', kind: 'number', default: '30' },
    {
      key: 'fixedCosts',
      label: 'Fixed Operating Costs (F)',
      kind: 'number',
      default: '120000',
      hint: 'Including depreciation',
    },
    { key: 'interest', label: 'Interest Expense (C)', kind: 'number', default: '30000' },
    { key: 'taxRate', label: 'Tax Rate (T)', kind: 'number', default: '25', suffix: '%' },
    { key: 'shares', label: 'Shares Outstanding', kind: 'number', default: '10000' },
  ],
  compute: (v) => {
    const input = leverageInputs(v);
    const r = E.leverage(input);
    if (r.value === null) return { result: r };
    const o = r.value;
    const sens = [-0.2, -0.1, 0, 0.1, 0.2].map((s) => {
      const q = input.units * (1 + s);
      const x = E.leverage({ ...input, units: q }).value!;
      return [fmtPct(s, 0), fmtNum(q, 0), fmtMoney(x.ebit), fmtMoney(x.eps)];
    });
    const maxQ = Math.max(input.units * 1.6, (o.breakeven ?? 0) * 1.4);
    return {
      result: r,
      view: {
        outputs: [
          { label: 'DOL', value: x2(o.dol), primary: true },
          { label: 'DFL', value: x2(o.dfl), primary: true },
          { label: 'DTL (DOL × DFL)', value: x2(o.dcl), primary: true },
          { label: 'EBIT', value: fmtMoney(o.ebit) },
          { label: 'EPS', value: fmtMoney(o.eps) },
          { label: 'Operating Break-Even', value: units(o.operatingBreakeven), sub: 'F / (P − V)' },
          { label: 'Total Break-Even', value: units(o.breakeven), sub: '(F + C) / (P − V)' },
        ],
        notes:
          o.dcl !== null
            ? [
                `A 1% change in sales changes EBIT by about ${fmtNum(o.dol!, 2)}% and EPS by about ${fmtNum(o.dcl, 2)}% at this volume.`,
              ]
            : [],
        lines: {
          title: 'Revenue vs. total cost (break-even chart)',
          xLabel: 'Units sold',
          yLabel: 'Amount',
          xFormat: 'num',
          yFormat: 'money',
          series: [
            {
              name: 'Revenue',
              points: [0, maxQ].map((q) => [q, q * input.price] as [number, number]),
            },
            {
              name: 'Operating cost',
              points: [0, maxQ].map(
                (q) => [q, input.fixedCosts + q * input.variableCost] as [number, number],
              ),
            },
            {
              name: 'Operating cost + interest',
              points: [0, maxQ].map(
                (q) =>
                  [q, input.fixedCosts + input.interest + q * input.variableCost] as [
                    number,
                    number,
                  ],
              ),
            },
          ],
          markers: [
            ...(o.operatingBreakeven !== null
              ? [{ x: o.operatingBreakeven, label: 'Operating BE' }]
              : []),
            ...(o.breakeven !== null ? [{ x: o.breakeven, label: 'Total BE' }] : []),
            { x: input.units, label: 'Current Q' },
          ],
        },
        table: {
          title: 'Sales sensitivity',
          columns: ['Δ Sales', 'Units', 'EBIT', 'EPS'],
          numeric: [true, true, true, true],
          rows: sens,
        },
      },
    };
  },
};

export const ebitEpsCalc: Calculator = {
  id: 'ebiteps',
  category: 'Capital Structure',
  title: 'EBIT-EPS Indifference',
  description:
    'Compare two financing plans. Above the indifference EBIT the more levered plan delivers higher EPS; below it, the equity-heavy plan does.',
  fields: [
    { key: 'nameA', label: 'Plan A Name', kind: 'text', default: 'All equity' },
    { key: 'interestA', label: 'Plan A: Interest', kind: 'number', default: '0' },
    { key: 'sharesA', label: 'Plan A: Shares', kind: 'number', default: '1000000' },
    { key: 'nameB', label: 'Plan B Name', kind: 'text', default: 'Debt-financed' },
    { key: 'interestB', label: 'Plan B: Interest', kind: 'number', default: '400000' },
    { key: 'sharesB', label: 'Plan B: Shares', kind: 'number', default: '500000' },
    { key: 'taxRate', label: 'Tax Rate (T)', kind: 'number', default: '25', suffix: '%' },
    { key: 'expectedEbit', label: 'Expected EBIT', kind: 'number', default: '1000000' },
  ],
  compute: (v) => {
    const planA = {
      name: str(v.nameA) || 'Plan A',
      interest: num(v.interestA),
      shares: num(v.sharesA),
    };
    const planB = {
      name: str(v.nameB) || 'Plan B',
      interest: num(v.interestB),
      shares: num(v.sharesB),
    };
    const taxRate = pct(v.taxRate);
    const r = E.ebitEps({ planA, planB, taxRate, expectedEbit: num(v.expectedEbit) });
    if (r.value === null) return { result: r };
    const o = r.value;
    const ref =
      Math.max(num(v.expectedEbit), o.indifferenceEbit ?? 0, planB.interest, planA.interest) * 1.6;
    const xs = Array.from({ length: 21 }, (_, i) => (ref * i) / 20);
    const preferred =
      o.preferredAtExpected === 'tie'
        ? 'neither (tie)'
        : o.preferredAtExpected === 'A'
          ? planA.name
          : planB.name;
    return {
      result: r,
      view: {
        outputs: [
          {
            label: 'Indifference EBIT',
            value: o.indifferenceEbit === null ? 'none' : fmtMoney(o.indifferenceEbit),
            primary: true,
          },
          {
            label: 'EPS at Indifference',
            value: o.indifferenceEps === null ? 'n/a' : fmtMoney(o.indifferenceEps),
          },
          { label: `EPS: ${planA.name}`, value: fmtMoney(o.epsA) },
          { label: `EPS: ${planB.name}`, value: fmtMoney(o.epsB) },
          { label: 'Preferred at Expected EBIT', value: preferred, primary: true },
        ],
        lines: {
          title: 'EPS by EBIT for each financing plan',
          xLabel: 'EBIT',
          yLabel: 'EPS',
          xFormat: 'money',
          yFormat: 'money',
          series: [planA, planB].map((p) => ({
            name: p.name,
            points: xs.map((x) => [x, E.epsAt(x, p, taxRate)] as [number, number]),
          })),
          markers: [
            ...(o.indifferenceEbit !== null
              ? [{ x: o.indifferenceEbit, label: 'Indifference' }]
              : []),
            { x: num(v.expectedEbit), label: 'Expected' },
          ],
        },
      },
    };
  },
};

export const eoqCalc: Calculator = {
  id: 'eoq',
  category: 'Working Capital',
  title: 'Economic Order Quantity',
  description:
    'Optimal order size balancing ordering and holding costs, with the reorder point and the cost trade-off curve.',
  fields: [
    { key: 'annualDemand', label: 'Annual Demand (units)', kind: 'number', default: '12000' },
    { key: 'orderCost', label: 'Cost per Order (S)', kind: 'number', default: '75' },
    { key: 'holdingCost', label: 'Holding Cost / Unit / Yr (H)', kind: 'number', default: '4' },
    { key: 'leadTimeDays', label: 'Lead Time (days)', kind: 'number', default: '10' },
    { key: 'safetyStock', label: 'Safety Stock (units)', kind: 'number', default: '150' },
  ],
  compute: (v) => {
    const r = E.eoq({
      annualDemand: num(v.annualDemand),
      orderCost: num(v.orderCost),
      holdingCost: num(v.holdingCost),
      leadTimeDays: num(v.leadTimeDays),
      safetyStock: num(v.safetyStock),
    });
    if (r.value === null) return { result: r };
    const o = r.value;
    return {
      result: r,
      view: {
        outputs: [
          { label: 'EOQ', value: `${fmtNum(o.eoq, 1)} units`, primary: true },
          { label: 'Orders / Year', value: fmtNum(o.ordersPerYear, 2) },
          { label: 'Total Relevant Cost', value: fmtMoney(o.totalCost), primary: true },
          { label: 'Ordering Cost', value: fmtMoney(o.orderingCost) },
          { label: 'Holding Cost', value: fmtMoney(o.holdingCostTotal) },
          { label: 'Reorder Point', value: `${fmtNum(o.reorderPoint, 1)} units` },
        ],
        lines: {
          title: 'Cost trade-off: ordering vs. holding',
          xLabel: 'Order quantity (units)',
          yLabel: 'Annual cost',
          xFormat: 'num',
          yFormat: 'money',
          series: [
            { name: 'Total cost', points: o.curve.map((c) => [c.q, c.total]) },
            { name: 'Ordering cost', points: o.curve.map((c) => [c.q, c.ordering]) },
            { name: 'Holding cost', points: o.curve.map((c) => [c.q, c.holding]) },
          ],
          markers: [{ x: o.eoq, label: 'EOQ' }],
        },
      },
    };
  },
};

export const cashCalc: Calculator = {
  id: 'cash',
  category: 'Working Capital',
  title: 'Cash Management Models',
  description:
    'Baumol (deterministic, steady outflows) and Miller–Orr (random daily cash flows with control limits) target cash policies.',
  fields: [
    {
      key: 'model',
      label: 'Model',
      kind: 'select',
      default: 'baumol',
      options: [
        { value: 'baumol', label: 'Baumol (EOQ for cash)' },
        { value: 'millerOrr', label: 'Miller–Orr (control limits)' },
      ],
    },
    {
      key: 'annualCashNeed',
      label: 'Annual Cash Requirement (T)',
      kind: 'number',
      default: '2400000',
      visible: (v) => v.model !== 'millerOrr',
    },
    { key: 'transactionCost', label: 'Cost per Transaction (F)', kind: 'number', default: '150' },
    {
      key: 'interestRate',
      label: 'Annual Interest Rate (i)',
      kind: 'number',
      default: '6',
      suffix: '%',
      visible: (v) => v.model !== 'millerOrr',
    },
    {
      key: 'lowerLimit',
      label: 'Lower Limit (L)',
      kind: 'number',
      default: '20000',
      visible: (v) => v.model === 'millerOrr',
    },
    {
      key: 'dailySd',
      label: 'Daily Cash Flow Std. Dev. (σ)',
      kind: 'number',
      default: '5000',
      visible: (v) => v.model === 'millerOrr',
    },
    {
      key: 'dailyRate',
      label: 'Daily Interest Rate',
      kind: 'number',
      default: '0.02',
      suffix: '%',
      visible: (v) => v.model === 'millerOrr',
      hint: 'e.g. 7.3% a year ÷ 365 ≈ 0.02% a day',
    },
  ],
  compute: (v) => {
    if (str(v.model) === 'millerOrr') {
      const sd = num(v.dailySd);
      const r = E.millerOrr({
        lowerLimit: num(v.lowerLimit),
        transactionCost: num(v.transactionCost),
        dailyVariance: sd * sd,
        dailyRate: pct(v.dailyRate),
      });
      if (r.value === null) return { result: r };
      const o = r.value;
      return {
        result: r,
        view: {
          outputs: [
            { label: 'Return Point (Z*)', value: fmtMoney(o.returnPoint), primary: true },
            { label: 'Upper Limit (H*)', value: fmtMoney(o.upperLimit), primary: true },
            { label: 'Lower Limit (L)', value: fmtMoney(num(v.lowerLimit)) },
            { label: 'Spread (H* − L)', value: fmtMoney(o.spread) },
            { label: 'Average Cash Balance', value: fmtMoney(o.averageCash) },
          ],
          notes: [
            `Buy securities with ${fmtMoney(o.upperLimit - o.returnPoint)} when cash hits ${fmtMoney(o.upperLimit)}; sell ${fmtMoney(o.returnPoint - num(v.lowerLimit))} when it falls to ${fmtMoney(num(v.lowerLimit))}.`,
          ],
        },
      };
    }
    const r = E.baumol({
      annualCashNeed: num(v.annualCashNeed),
      transactionCost: num(v.transactionCost),
      interestRate: pct(v.interestRate),
    });
    if (r.value === null) return { result: r };
    const o = r.value;
    return {
      result: r,
      view: {
        outputs: [
          { label: 'Optimal Transfer (C*)', value: fmtMoney(o.optimalCash), primary: true },
          { label: 'Average Cash Balance', value: fmtMoney(o.averageCash) },
          { label: 'Transfers / Year', value: fmtNum(o.transfers, 2) },
          { label: 'Opportunity Cost', value: fmtMoney(o.opportunityCost) },
          { label: 'Trading Cost', value: fmtMoney(o.tradingCost) },
          { label: 'Total Cost', value: fmtMoney(o.totalCost), primary: true },
        ] satisfies Output[],
      },
    };
  },
};
