import { describe, expect, it } from 'vitest';
import { csvCell, parseDate, parseDatedList, parseNumberList } from '../src/io/parse';

describe('parseNumberList', () => {
  it('reads a single Excel column', () => {
    expect(parseNumberList('-70000\n12000\n15000\n').values).toEqual([-70000, 12000, 15000]);
  });
  it('reads US-formatted numbers with thousands separators', () => {
    const r = parseNumberList('-1,000,000.50\n250,000.25');
    expect(r.values).toEqual([-1000000.5, 250000.25]);
    expect(r.decimalStyle).toBe('dot');
  });
  it('reads Turkish-formatted numbers', () => {
    const r = parseNumberList('-1.000.000,50\n250.000,25\n12,5');
    expect(r.values).toEqual([-1000000.5, 250000.25, 12.5]);
    expect(r.decimalStyle).toBe('comma');
  });
  it('takes the last numeric column and skips headers', () => {
    const r = parseNumberList('Year\tCash flow\n0\t-100000\n1\t30000\n2\t45000');
    expect(r.values).toEqual([-100000, 30000, 45000]);
    expect(r.skipped).toHaveLength(1);
  });
  it('handles accounting negatives and currency marks', () => {
    expect(parseNumberList('(1,500.00)\n$2,000\n₺300\n−50').values).toEqual([
      -1500, 2000, 300, -50,
    ]);
  });
  it('reads semicolon CSV with comma decimals', () => {
    expect(parseNumberList('Period;Amount\n0;-1000,5\n1;600,25').values).toEqual([-1000.5, 600.25]);
  });
  it('flags ambiguous tokens and honours an explicit setting', () => {
    const auto = parseNumberList('1.500\n2.250');
    expect(auto.notes.length).toBe(1);
    expect(parseNumberList('1.500\n2.250', { decimal: 'comma' }).values).toEqual([1500, 2250]);
    expect(parseNumberList('1.500\n2.250', { decimal: 'dot' }).values).toEqual([1.5, 2.25]);
  });
  it('reports text that is not a number', () => {
    expect(parseNumberList('abc').errors).toEqual(['No numbers found.']);
  });
});

describe('dates', () => {
  it('accepts ISO and DD.MM.YYYY, rejects slash dates and impossible dates', () => {
    expect(parseDate('2024-02-29')).toBe('2024-02-29');
    expect(parseDate('01.03.2008')).toBe('2008-03-01');
    expect(parseDate('03/01/2008')).toBe('ambiguous');
    expect(parseDate('2023-02-29')).toBeNull();
  });
  it('parses date/amount rows in either column order', () => {
    const r = parseDatedList(
      'Date\tAmount\n01.01.2008\t-10.000\n2008-03-01\t2.750\n4250\t30.10.2008',
    );
    expect(r.errors).toEqual([]);
    expect(r.values).toEqual([
      { date: '2008-01-01', amount: -10000 },
      { date: '2008-03-01', amount: 2750 },
      { date: '2008-10-30', amount: 4250 },
    ]);
  });
});

describe('csvCell', () => {
  it('neutralises formula injection but keeps negative numbers', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell('-5')).toBe('-5');
  });
});

describe('readNumber (typed inputs)', () => {
  it('reads both conventions without silently corrupting values', async () => {
    const { readNumber } = await import('../src/io/parse');
    const v = (s: string) => readNumber(s)?.value;
    expect(v('12,5')).toBe(12.5);
    expect(v('1.234,56')).toBe(1234.56);
    expect(v('1,234.56')).toBe(1234.56);
    expect(v('250.000,50')).toBe(250000.5);
    expect(v('1.234.567')).toBe(1234567);
    expect(v('1,234,567')).toBe(1234567);
    expect(v('-70000')).toBe(-70000);
    expect(v('(1,000)')).toBe(-1000);
    expect(v('0.08')).toBe(0.08);
    expect(v('8')).toBe(8);
    expect(v('abc')).toBeUndefined();
    expect(v('1.2.3')).toBeUndefined();
  });
  it('flags the genuinely ambiguous forms', async () => {
    const { readNumber } = await import('../src/io/parse');
    expect(readNumber('1,500')).toMatchObject({ value: 1500, ambiguous: true });
    expect(readNumber('2.250')).toMatchObject({ value: 2.25, ambiguous: true });
    expect(readNumber('12,5')).toMatchObject({ ambiguous: false, reinterpreted: true });
    expect(readNumber('12.5')).toMatchObject({ ambiguous: false, reinterpreted: false });
  });
});
