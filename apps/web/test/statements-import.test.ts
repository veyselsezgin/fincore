import { describe, expect, it } from 'vitest';
import { matchItem, parseStatementBlock } from '../src/io/statements';

describe('statement paste', () => {
  it('matches English and Turkish labels, longest alias first', () => {
    expect(matchItem('Trade receivables, net')).toBe('receivables');
    expect(matchItem('Ticari Alacaklar')).toBe('receivables');
    expect(matchItem('Satışların Maliyeti (-)')).toBe('cogs');
    expect(matchItem('Market value of equity')).toBe('marketCap');
    expect(matchItem('Total equity')).toBe('equity');
    expect(matchItem('Cash flow from operations')).toBe('operatingCashFlow');
    expect(matchItem('Nakit ve Nakit Benzerleri')).toBe('cash');
    expect(matchItem('Goodwill')).toBeNull();
  });

  it('reads a Turkish-format block with a year header and accounting dashes', () => {
    const text = [
      'Kalem\t2023\t2024',
      'Hasılat\t3.000.000\t3.200.000',
      'Satışların maliyeti\t(1.950.000)\t(2.140.000)',
      'Stoklar\t420.000,50\t500.000',
      'Diğer gelirler\t-\t5.000',
      'Şerefiye\t10\t20',
    ].join('\n');
    const r = parseStatementBlock(text);
    expect(r.errors).toEqual([]);
    expect(r.periods).toEqual(['FY2023', 'FY2024']);
    expect(r.values.revenue).toEqual([3000000, 3200000]);
    expect(r.values.cogs).toEqual([-1950000, -2140000]);
    expect(r.values.inventory).toEqual([420000.5, 500000]);
    expect(r.values.otherIncome).toEqual([0, 5000]);
    expect(r.unmatched.map((u) => u.label)).toEqual(['Şerefiye']);
  });

  it('reads an English block with text period headers', () => {
    const r = parseStatementBlock(
      'Item\tFY2024\tFY2025\nRevenue\t1,000.5\t1,200\nInventory\t100\t120',
    );
    expect(r.periods).toEqual(['FY2024', 'FY2025']);
    expect(r.values.revenue).toEqual([1000.5, 1200]);
  });
});

describe('expense sign convention', () => {
  it('flips negative-expense layouts and keeps a tax benefit as negative expense', async () => {
    const { normaliseExpenseSigns } = await import('../src/io/statements');
    const r = normaliseExpenseSigns(
      parseStatementBlock(
        'Revenue\t1000\nCost of sales\t(600)\nOperating expenses\t(200)\nIncome tax expense\t15\nPrincipal repayment\t(50)',
      ),
    );
    expect(r.values.cogs).toEqual([600]);
    expect(r.values.operatingExpenses).toEqual([200]);
    expect(r.values.taxExpense).toEqual([-15]);
    expect(r.values.principalRepayment).toEqual([50]);
    expect(r.notes).toHaveLength(2);
  });
  it('leaves positive-expense layouts alone', async () => {
    const { normaliseExpenseSigns } = await import('../src/io/statements');
    const r = normaliseExpenseSigns(
      parseStatementBlock('Revenue\t1000\nCOGS\t600\nOperating expenses\t200'),
    );
    expect(r.values.cogs).toEqual([600]);
    expect(r.notes).toHaveLength(0);
  });
});
