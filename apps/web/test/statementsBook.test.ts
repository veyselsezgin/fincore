import { HyperFormula } from 'hyperformula';
import { describe, expect, it } from 'vitest';
import { toHyperFormulaSheets, type XBook } from '../src/io/xlsx';
import { CALCULATORS, defaults } from '../src/registry';

/** Evaluates every formula; numeric cached values must match, text values (zones, "n/a") too. */
function verify(book: XBook): { numbers: number; texts: number } {
  const hf = HyperFormula.buildFromSheets(toHyperFormulaSheets(book), {
    licenseKey: 'gpl-v3',
    useArrayArithmetic: true,
  });
  let numbers = 0;
  let texts = 0;
  for (const sheet of book.sheets) {
    const id = hf.getSheetId(sheet.name)!;
    sheet.rows.forEach((row, r) =>
      row.forEach((cell, c) => {
        if (!cell || typeof cell !== 'object' || !('f' in cell)) return;
        const got = hf.getCellValue({ sheet: id, row: r, col: c });
        const where = `${sheet.name}!R${r + 1}C${c + 1} =${cell.f}`;
        if (typeof cell.v === 'number') {
          expect(typeof got, `${where} -> ${JSON.stringify(got)}`).toBe('number');
          expect(
            Math.abs((got as number) - cell.v) / Math.max(1, Math.abs(cell.v)),
            where,
          ).toBeLessThan(1e-9);
          numbers++;
        } else if (cell.v === null) {
          // Engine says "not meaningful": Excel must not produce a number either.
          expect(typeof got === 'number' ? `number ${got}` : 'text', where).toBe('text');
          texts++;
        } else if (typeof cell.v === 'string') {
          expect(got, where).toBe(cell.v);
          texts++;
        }
      }),
    );
  }
  hf.destroy();
  return { numbers, texts };
}

const calc = CALCULATORS.find((c) => c.id === 'statements')!;

describe('statement analysis workbook', () => {
  it('example company: every formula matches the engine, for all three Altman models', () => {
    for (const altmanModel of ['private', 'public', 'nonManufacturing']) {
      const book = calc.excel!({ ...defaults(calc), altmanModel })!;
      const { numbers } = verify(book);
      // 3 periods × (13 derived + 20 ratios + 8 DuPont) + Altman + what-if
      expect(numbers).toBeGreaterThan(3 * (13 + 20 + 8));
    }
  });

  it('single period, missing market value, negative equity and zero interest', () => {
    const v = defaults(calc);
    const g = structuredClone(v.statements) as {
      periods: string[];
      values: Record<string, string[]>;
    };
    g.periods = ['FY2025'];
    for (const k of Object.keys(g.values)) g.values[k] = [g.values[k]![2]!];
    g.values.interestExpense = ['0'];
    g.values.marketCap = [''];
    g.values.equity = ['-100'];
    g.values.otherNonCurrentLiabilities = [String(60 + 1270 + 100)]; // keep it balanced
    for (const altmanModel of ['public', 'private']) {
      const book = calc.excel!({ ...v, statements: g, altmanModel })!;
      const { numbers, texts } = verify(book);
      expect(numbers).toBeGreaterThan(20);
      expect(texts).toBeGreaterThan(0); // D/E, ROE, coverage are "n/a"
    }
  });
});
