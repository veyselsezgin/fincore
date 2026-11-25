import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { parseStatementBlock } from '../src/io/statements';
import { parseNumberList } from '../src/io/parse';
import { checkExcelFile, ImportError, xlsxToText } from '../src/io/xlsxImport';
import { upsertCase, MAX_CASES_PER_CALC } from '../src/session';
import { CALCULATORS, defaults } from '../src/registry';

async function xlsxFile(name: string, rows: unknown[][], formulaRow?: number) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');
  rows.forEach((r) => ws.addRow(r));
  // A formula cell with a cached result: the importer must read the result, never evaluate.
  if (formulaRow) ws.getCell(`B${formulaRow}`).value = { formula: 'B2*2', result: 6000 };
  return new File([await wb.xlsx.writeBuffer()], name);
}

describe('xlsx import', () => {
  it('reads statements from the first sheet into the statement parser', async () => {
    const text = await xlsxToText(
      await xlsxFile('statements.xlsx', [
        ['Item', 2024, 2025],
        ['Revenue', 3000, 3300.5],
        ['Ticari alacaklar', 470, 610],
      ]),
    );
    expect(text.split('\n')[0]).toBe('Item\t2024\t2025');
    const imp = parseStatementBlock(text);
    expect(imp.periods).toEqual(['FY2024', 'FY2025']);
    expect(imp.values.revenue).toEqual([3000, 3300.5]);
    expect(imp.values.receivables).toEqual([470, 610]);
  });

  it('reads a cash-flow column, using cached formula results', async () => {
    const text = await xlsxToText(
      await xlsxFile(
        'flows.xlsx',
        [
          ['Period', 'Cash flow'],
          [0, -100],
          [1, 40],
          [2, 70],
        ],
        5,
      ),
    );
    expect(parseNumberList(text).values).toEqual([-100, 40, 70, 6000]);
  });

  it('refuses macro-enabled, legacy, oversized and fake files', () => {
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
    expect(() => checkExcelFile('a.xlsm', 10, zip)).toThrow(ImportError);
    expect(() => checkExcelFile('a.xls', 10, zip)).toThrow(/Legacy/);
    expect(() => checkExcelFile('a.xlsx', 6_000_000, zip)).toThrow(/5 MB/);
    expect(() => checkExcelFile('a.xlsx', 10, new Uint8Array([0x3c, 0x68, 0x74, 0x6d]))).toThrow(
      /not a valid/,
    );
    expect(() => checkExcelFile('a.xlsx', 10, zip)).not.toThrow();
  });
});

describe('saved cases', () => {
  it('upserts by name, newest first, capped', () => {
    let list = upsertCase([], 'Base', { a: '1' });
    list = upsertCase(list, 'Bull', { a: '2' });
    list = upsertCase(list, 'Base', { a: '3' });
    expect(list.map((c) => c.name)).toEqual(['Base', 'Bull']);
    expect(list[0]!.values).toEqual({ a: '3' });
    for (let i = 0; i < 20; i++) list = upsertCase(list, `C${i}`, {});
    expect(list).toHaveLength(MAX_CASES_PER_CALC);
  });
});

describe('every calculator', () => {
  it('computes its sample case without errors', () => {
    for (const c of CALCULATORS) {
      const r = c.compute(defaults(c));
      expect(r.result.errors, c.id).toEqual([]);
      expect(r.view?.outputs.length, c.id).toBeGreaterThan(0);
    }
  });
});
