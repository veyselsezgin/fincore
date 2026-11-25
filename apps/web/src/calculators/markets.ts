import * as E from '@fincore/engine';
import { list, num, pct, str, txt } from '../fieldValues';
import { fmtMoney, fmtNum, fmtPct } from '../format';
import type { Calculator, Values } from '../registry';

// --- Bonds -------------------------------------------------------------------------------------

function bondInputs(v: Values): E.BondInput {
  const base = {
    settlement: str(v.settlement),
    maturity: str(v.maturity),
    couponRate: pct(v.couponRate),
    frequency: Number(str(v.frequency)) as E.Frequency,
    basis: str(v.basis) as E.BondBasis,
    redemption: num(v.redemption),
  };
  return str(v.solveFor) === 'yield'
    ? { ...base, cleanPrice: num(v.cleanPrice) }
    : { ...base, yield: pct(v.yield) };
}

export const bondCalc: Calculator = {
  id: 'bond',
  category: 'Fixed Income',
  title: 'Bond Pricing & Risk',
  description:
    'Clean/dirty price or yield to maturity for a fixed-rate bullet bond, with accrued interest, current yield, Macaulay and modified duration, convexity and the price–yield curve (Excel PRICE / YIELD parity).',
  fields: [
    {
      key: 'solveFor',
      label: 'Solve For',
      kind: 'select',
      default: 'price',
      options: [
        { value: 'price', label: 'Price (given yield)' },
        { value: 'yield', label: 'Yield to maturity (given price)' },
      ],
    },
    { key: 'settlement', label: 'Settlement Date', kind: 'date', default: '2008-02-15' },
    { key: 'maturity', label: 'Maturity Date', kind: 'date', default: '2017-11-15' },
    {
      key: 'couponRate',
      label: 'Coupon Rate (annual)',
      kind: 'number',
      default: '5.75',
      suffix: '%',
    },
    {
      key: 'yield',
      label: 'Yield to Maturity',
      kind: 'number',
      default: '6.5',
      suffix: '%',
      visible: (v) => v.solveFor !== 'yield',
    },
    {
      key: 'cleanPrice',
      label: 'Clean Price (per 100)',
      kind: 'number',
      default: '94.63436',
      visible: (v) => v.solveFor === 'yield',
    },
    {
      key: 'frequency',
      label: 'Coupon Frequency',
      kind: 'select',
      default: '2',
      options: [
        { value: '1', label: 'Annual' },
        { value: '2', label: 'Semi-annual' },
        { value: '4', label: 'Quarterly' },
        { value: '12', label: 'Monthly' },
      ],
    },
    {
      key: 'basis',
      label: 'Day Count Basis',
      kind: 'select',
      default: '30/360-US',
      options: E.BOND_BASES.map((b) => ({ value: b, label: b })),
    },
    { key: 'redemption', label: 'Redemption (per 100)', kind: 'number', default: '100' },
  ],
  compute: (v) => {
    const input = bondInputs(v);
    const r = E.bondAnalytics(input);
    if (r.value === null) return { result: r };
    const o = r.value;
    const p = (x: number) => fmtNum(x, 4);
    // Exact repricing at +100 bp, to compare with the duration + convexity approximation.
    const shifted: E.BondInput = { ...input, yield: o.yield + 0.01 };
    delete shifted.cleanPrice;
    const up = E.bondAnalytics(shifted).value;
    const approx = -o.modifiedDuration * 0.01 + 0.5 * o.convexity * 0.0001;
    return {
      result: r,
      view: {
        outputs: [
          {
            label: str(v.solveFor) === 'yield' ? 'Yield to Maturity' : 'Clean Price',
            value: str(v.solveFor) === 'yield' ? fmtPct(o.yield, 4) : p(o.cleanPrice),
            primary: true,
          },
          { label: 'Dirty Price', value: p(o.dirtyPrice), primary: true },
          { label: 'Accrued Interest', value: p(o.accruedInterest) },
          { label: 'Current Yield', value: fmtPct(o.currentYield, 3) },
          { label: 'Macaulay Duration', value: `${fmtNum(o.macaulayDuration, 4)} yrs` },
          { label: 'Modified Duration', value: fmtNum(o.modifiedDuration, 4) },
          { label: 'Convexity', value: fmtNum(o.convexity, 4) },
          {
            label: 'Effective Duration',
            value: fmtNum(o.effectiveDuration, 4),
            sub: '±1 bp repricing',
          },
        ],
        notes: up
          ? [
              `+100 bp in yield: duration + convexity estimate ${fmtPct(approx, 2)} of full price; exact repricing ${fmtPct(up.dirtyPrice / o.dirtyPrice - 1, 2)}.`,
            ]
          : [],
        lines: {
          title: 'Price–yield curve (clean price)',
          xLabel: 'Yield to maturity',
          yLabel: 'Clean price',
          xFormat: 'pct',
          yFormat: 'num',
          series: [
            { name: 'Clean price', points: o.priceYieldCurve.map((x) => [x.yield, x.cleanPrice]) },
          ],
          markers: [{ x: o.yield, label: `YTM ${fmtPct(o.yield, 2)}` }],
        },
        table: {
          title: 'Coupon schedule position',
          columns: [
            'Previous coupon',
            'Next coupon',
            'Coupons remaining',
            'Accrued days (A)',
            'Period days (E)',
            'Days to next (DSC)',
          ],
          numeric: [false, false, true, true, true, true],
          rows: [
            [
              o.schedule.previousCoupon,
              o.schedule.nextCoupon,
              String(o.schedule.couponsRemaining),
              fmtNum(o.schedule.accruedDays, 2),
              fmtNum(o.schedule.periodDays, 2),
              fmtNum(o.schedule.daysToNext, 2),
            ],
          ],
        },
      },
    };
  },
};

// --- Equity valuation --------------------------------------------------------------------------

export const ddmCalc: Calculator = {
  id: 'ddm',
  category: 'Equity Valuation',
  title: 'Dividend Discount Model',
  description:
    'Gordon growth (constant growth) or two-stage DDM: explicit high-growth dividends followed by a Gordon terminal value.',
  fields: [
    {
      key: 'model',
      label: 'Model',
      kind: 'select',
      default: 'multi',
      options: [
        { value: 'gordon', label: 'Gordon growth (single stage)' },
        { value: 'multi', label: 'Multi-stage' },
      ],
    },
    { key: 'dividend', label: 'Current Dividend (D0)', kind: 'number', default: '2.00' },
    {
      key: 'requiredReturn',
      label: 'Required Return (Re)',
      kind: 'number',
      default: '10',
      suffix: '%',
    },
    { key: 'growth', label: 'Perpetual Growth (g)', kind: 'number', default: '4', suffix: '%' },
    {
      key: 'g1',
      label: 'Stage 1 Growth',
      kind: 'number',
      default: '15',
      suffix: '%',
      visible: (v) => v.model === 'multi',
    },
    {
      key: 'n1',
      label: 'Stage 1 Years',
      kind: 'number',
      default: '3',
      visible: (v) => v.model === 'multi',
    },
    {
      key: 'g2',
      label: 'Stage 2 Growth (optional)',
      kind: 'number',
      default: '8',
      suffix: '%',
      visible: (v) => v.model === 'multi',
    },
    {
      key: 'n2',
      label: 'Stage 2 Years (0 = none)',
      kind: 'number',
      default: '2',
      visible: (v) => v.model === 'multi',
    },
  ],
  compute: (v) => {
    if (str(v.model) === 'gordon') {
      const r = E.gordonGrowth({
        dividend: num(v.dividend),
        requiredReturn: pct(v.requiredReturn),
        growth: pct(v.growth),
      });
      if (r.value === null) return { result: r };
      return {
        result: r,
        view: {
          outputs: [
            { label: 'Intrinsic Value (V0)', value: fmtMoney(r.value), primary: true },
            {
              label: 'Implied Dividend Yield',
              value: fmtPct((num(v.dividend) * (1 + pct(v.growth))) / r.value, 2),
            },
          ],
        },
      };
    }
    const stages = [{ growth: pct(v.g1), years: num(v.n1) }];
    if (num(v.n2) > 0) stages.push({ growth: pct(v.g2), years: num(v.n2) });
    const r = E.multiStageDdm({
      dividend: num(v.dividend),
      requiredReturn: pct(v.requiredReturn),
      stages,
      terminalGrowth: pct(v.growth),
    });
    if (r.value === null) return { result: r };
    const o = r.value;
    return {
      result: r,
      view: {
        outputs: [
          { label: 'Intrinsic Value (V0)', value: fmtMoney(o.value), primary: true },
          { label: 'PV of Explicit Dividends', value: fmtMoney(o.pvExplicit) },
          {
            label: 'PV of Terminal Value',
            value: fmtMoney(o.pvTerminal),
            sub: `${fmtPct(o.pvTerminal / o.value, 1)} of value`,
          },
        ],
        table: {
          title: 'Dividend forecast',
          columns: ['Year', 'Dividend', 'Present value'],
          numeric: [true, true, true],
          rows: o.dividends.map((d) => [String(d.year), fmtMoney(d.dividend), fmtMoney(d.pv)]),
        },
      },
    };
  },
};

export const dcfCalc: Calculator = {
  id: 'dcf',
  category: 'Equity Valuation',
  title: 'FCFF / FCFE Valuation',
  description:
    'Discount forecast free cash flows: FCFF at WACC to enterprise value (less net debt), or FCFE at the cost of equity to equity value, with a Gordon terminal value.',
  fields: [
    {
      key: 'kind',
      label: 'Cash Flow Basis',
      kind: 'select',
      default: 'FCFF',
      options: [
        { value: 'FCFF', label: 'FCFF (firm) at WACC' },
        { value: 'FCFE', label: 'FCFE (equity) at cost of equity' },
      ],
    },
    {
      key: 'discountRate',
      label: 'Discount Rate (WACC or Re)',
      kind: 'number',
      default: '9',
      suffix: '%',
    },
    {
      key: 'terminalGrowth',
      label: 'Terminal Growth (g)',
      kind: 'number',
      default: '2.5',
      suffix: '%',
    },
    {
      key: 'netDebt',
      label: 'Net Debt (debt − cash)',
      kind: 'number',
      default: '400',
      visible: (v) => v.kind !== 'FCFE',
    },
    { key: 'shares', label: 'Shares Outstanding', kind: 'number', default: '100' },
    {
      key: 'cashFlows',
      label: 'Forecast Free Cash Flows (Y1…YN)',
      kind: 'numberList',
      default: ['120', '132', '143', '152', '160'],
    },
  ],
  compute: (v) => {
    const kind = (str(v.kind) || 'FCFF') as 'FCFF' | 'FCFE';
    const r = E.dcfValuation({
      kind,
      cashFlows: list(v.cashFlows),
      discountRate: pct(v.discountRate),
      terminalGrowth: pct(v.terminalGrowth),
      netDebt: kind === 'FCFF' ? num(v.netDebt) : 0,
      shares: num(v.shares),
    });
    if (r.value === null) return { result: r };
    const o = r.value;
    const grid = [-0.01, -0.005, 0, 0.005, 0.01];
    const flows = list(v.cashFlows);
    return {
      result: r,
      view: {
        outputs: [
          { label: 'Value per Share', value: fmtMoney(o.valuePerShare), primary: true },
          {
            label: kind === 'FCFF' ? 'Enterprise Value' : 'Equity Value',
            value: fmtMoney(o.presentValue),
            primary: true,
          },
          ...(kind === 'FCFF' ? [{ label: 'Equity Value', value: fmtMoney(o.equityValue) }] : []),
          {
            label: 'PV of Terminal Value',
            value: fmtMoney(o.pvTerminal),
            sub: `${fmtPct(o.terminalShare, 1)} of value`,
          },
        ],
        heatmap: {
          title: 'Value per share: discount rate × terminal growth',
          rowTitle: 'Terminal growth',
          colTitle: 'Discount rate',
          rowLabels: grid.map((d) => fmtPct(pct(v.terminalGrowth) + d, 2)),
          colLabels: grid.map((d) => fmtPct(pct(v.discountRate) + d, 2)),
          values: grid.map((dg) =>
            grid.map((dr) => {
              const x = E.dcfValuation({
                kind,
                cashFlows: flows,
                discountRate: pct(v.discountRate) + dr,
                terminalGrowth: pct(v.terminalGrowth) + dg,
                netDebt: kind === 'FCFF' ? num(v.netDebt) : 0,
                shares: num(v.shares),
              }).value;
              return x ? x.valuePerShare : Number.NaN;
            }),
          ),
          base: [2, 2],
        },
      },
    };
  },
};

// --- Portfolio & VaR ----------------------------------------------------------------------------

function portfolioInputs(v: Values) {
  const assets = (Array.isArray(v.assets) ? (v.assets as string[][]) : []).filter((r) =>
    r.some((c) => c.trim() !== ''),
  );
  const n = assets.length;
  const corr = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : Number.NaN)),
  );
  const pairs = Array.isArray(v.correlations) ? (v.correlations as string[][]) : [];
  for (const [a, b, rho] of pairs) {
    const i = num(a) - 1;
    const j = num(b) - 1;
    if (
      Number.isInteger(i) &&
      Number.isInteger(j) &&
      i >= 0 &&
      j >= 0 &&
      i < n &&
      j < n &&
      i !== j
    ) {
      corr[i]![j] = num(rho);
      corr[j]![i] = num(rho);
    }
  }
  return {
    names: assets.map((r, i) => r[0]?.trim() || `Asset ${i + 1}`),
    input: {
      weights: assets.map((r) => num(r[1]) / 100),
      expectedReturns: assets.map((r) => num(r[2]) / 100),
      volatilities: assets.map((r) => num(r[3]) / 100),
      betas: assets.map((r) => num(r[4])),
      correlations: corr,
      riskFree: pct(v.riskFree),
      marketReturn: pct(v.marketReturn),
    } satisfies E.PortfolioInput,
  };
}

export const portfolioCalc: Calculator = {
  id: 'portfolio',
  category: 'Portfolio & Risk',
  title: 'Portfolio Analytics',
  description:
    'Mean–variance portfolio statistics from weights, expected returns, volatilities, betas and pairwise correlations: σ via w′Σw, Sharpe, Treynor, Jensen’s alpha and risk contribution.',
  fields: [
    {
      key: 'assets',
      label: 'Assets (weights, E[R], σ in %)',
      kind: 'grid',
      columns: [
        { label: 'Name' },
        { label: 'Weight %', numeric: true },
        { label: 'E[R] %', numeric: true },
        { label: 'σ %', numeric: true },
        { label: 'Beta', numeric: true },
      ],
      minRows: 1,
      maxRows: 10,
      default: [
        ['Equities', '60', '9', '18', '1.10'],
        ['Bonds', '30', '4', '6', '0.20'],
        ['Real assets', '10', '6.5', '12', '0.60'],
      ],
    },
    {
      key: 'correlations',
      label: 'Pairwise Correlations (asset # i, asset # j, ρ)',
      kind: 'grid',
      columns: [
        { label: 'Asset i', numeric: true },
        { label: 'Asset j', numeric: true },
        { label: 'ρ', numeric: true },
      ],
      minRows: 0,
      maxRows: 45,
      default: [
        ['1', '2', '0.10'],
        ['1', '3', '0.50'],
        ['2', '3', '0.20'],
      ],
      hint: 'Every pair of assets needs a row; missing pairs are reported, never assumed.',
    },
    { key: 'riskFree', label: 'Risk-Free Rate (Rf)', kind: 'number', default: '3', suffix: '%' },
    {
      key: 'marketReturn',
      label: 'Expected Market Return (Rm)',
      kind: 'number',
      default: '8',
      suffix: '%',
    },
  ],
  compute: (v) => {
    const { names, input } = portfolioInputs(v);
    const missing: string[] = [];
    input.correlations.forEach((row, i) =>
      row.forEach((x, j) => j > i && Number.isNaN(x) && missing.push(`${names[i]} – ${names[j]}`)),
    );
    const r = E.portfolioMetrics(input);
    if (r.value === null) {
      // A missing pair leaves NaN in the matrix; name the pairs instead of a generic matrix error.
      if (missing.length > 0)
        r.errors.unshift({
          code: 'MISSING_CORRELATION',
          message: `Add correlations for: ${missing.join(', ')}.`,
          field: 'correlations',
        });
      return { result: r };
    }
    const o = r.value;
    return {
      result: r,
      view: {
        outputs: [
          { label: 'Expected Return', value: fmtPct(o.expectedReturn, 2), primary: true },
          { label: 'Volatility (σp)', value: fmtPct(o.volatility, 2), primary: true },
          { label: 'Sharpe Ratio', value: o.sharpe === null ? 'n/a' : fmtNum(o.sharpe, 3) },
          { label: 'Treynor Ratio', value: o.treynor === null ? 'n/a' : fmtNum(o.treynor, 4) },
          { label: 'Portfolio Beta', value: fmtNum(o.beta, 3) },
          { label: "Jensen's Alpha", value: fmtPct(o.jensensAlpha, 2) },
        ],
        actions: [
          {
            label: 'Push to Value at Risk →',
            target: 'var',
            patch: {
              expectedReturn: txt(o.expectedReturn * 100),
              volatility: txt(o.volatility * 100),
            },
            message: `Portfolio E[R] ${fmtPct(o.expectedReturn, 2)} and σ ${fmtPct(o.volatility, 2)} imported from Portfolio Analytics.`,
          },
        ],
        table: {
          title: 'Risk contribution',
          columns: ['Asset', 'Weight', 'σ', 'Share of portfolio variance'],
          numeric: [false, true, true, true],
          rows: names.map((nm, i) => [
            nm,
            fmtPct(input.weights[i]!, 1),
            fmtPct(input.volatilities[i]!, 1),
            fmtPct(o.riskContribution[i]!, 1),
          ]),
        },
      },
    };
  },
};

export const varCalc: Calculator = {
  id: 'var',
  category: 'Portfolio & Risk',
  title: 'Value at Risk (Parametric)',
  description:
    'Variance–covariance VaR and expected shortfall at 95% and 99% under normal returns, scaled to the holding period.',
  fields: [
    { key: 'portfolioValue', label: 'Portfolio Value', kind: 'number', default: '10000000' },
    {
      key: 'expectedReturn',
      label: 'Expected Return (annual)',
      kind: 'number',
      default: '7',
      suffix: '%',
    },
    {
      key: 'volatility',
      label: 'Volatility (annual σ)',
      kind: 'number',
      default: '15',
      suffix: '%',
    },
    { key: 'horizonDays', label: 'Holding Period (trading days)', kind: 'number', default: '10' },
  ],
  compute: (v) => {
    const r = E.parametricVar({
      portfolioValue: num(v.portfolioValue),
      expectedReturn: pct(v.expectedReturn),
      volatility: pct(v.volatility),
      horizonDays: num(v.horizonDays),
      confidence: [0.95, 0.99],
    });
    if (r.value === null) return { result: r };
    const [a, b] = r.value.rows as [E.VarRow, E.VarRow];
    return {
      result: r,
      view: {
        outputs: [
          {
            label: 'VaR 95%',
            value: fmtMoney(a.valueAtRisk),
            primary: true,
            sub: `${fmtPct(a.valueAtRisk / num(v.portfolioValue), 2)} of value`,
          },
          {
            label: 'VaR 99%',
            value: fmtMoney(b.valueAtRisk),
            primary: true,
            sub: `${fmtPct(b.valueAtRisk / num(v.portfolioValue), 2)} of value`,
          },
          { label: 'Expected Shortfall 95%', value: fmtMoney(a.expectedShortfall) },
          { label: 'Expected Shortfall 99%', value: fmtMoney(b.expectedShortfall) },
          { label: 'Horizon σ', value: fmtPct(r.value.horizonVolatility, 3) },
        ],
        notes: [
          `With 99% confidence, the ${num(v.horizonDays)}-day loss should not exceed ${fmtMoney(b.valueAtRisk)} if returns are normal. Real returns have fatter tails, so treat this as a floor.`,
        ],
      },
    };
  },
};
