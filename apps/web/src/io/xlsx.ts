/**
 * A small, library-independent workbook description. The same description is written to .xlsx
 * by ExcelJS (in the browser) and evaluated by HyperFormula in tests, which checks that every
 * exported Excel formula reproduces the engine's number.
 */

export type Fmt = 'money' | 'pct' | 'num' | 'int' | 'date' | 'ratio' | 'days';

export type XCell =
  | null
  | string
  | number
  | { t: string; bold?: boolean; italic?: boolean }
  | { v: number; fmt?: Fmt }
  | { f: string; v?: number | string | null; fmt?: Fmt; bold?: boolean }
  | { date: string };

export interface XSheet {
  name: string;
  rows: XCell[][];
  widths?: number[];
}

export interface XBook {
  fileName: string;
  sheets: XSheet[];
}

/** 0-based column index to letters: 0 → A, 26 → AA. */
export function col(i: number): string {
  let s = '';
  let n = i + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Quoted sheet reference prefix, e.g. 'NPV'! */
export const sheetRef = (name: string) => `'${name.replace(/'/g, "''")}'!`;

const NUM_FMT: Record<Fmt, string> = {
  money: '#,##0.00;[Red]-#,##0.00',
  pct: '0.00%',
  num: '0.000000',
  int: '0',
  date: 'yyyy-mm-dd',
  ratio: '0.00"x"',
  days: '0.0',
};

/** Excel serial date (1900 system) for an ISO date. */
export function excelSerial(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000);
}

/** Builds the .xlsx file. ExcelJS is loaded on demand to keep the first page load small. */
export async function writeXlsx(book: XBook): Promise<Blob> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'FinCore';
  wb.created = new Date();
  for (const sheet of book.sheets) {
    const ws = wb.addWorksheet(sheet.name);
    sheet.widths?.forEach((w, i) => (ws.getColumn(i + 1).width = w));
    sheet.rows.forEach((row, r) => {
      row.forEach((cell, c) => {
        if (cell === null) return;
        const target = ws.getCell(r + 1, c + 1);
        if (typeof cell === 'string' || typeof cell === 'number') {
          // Strings are written as string cells, so text can never become a formula.
          target.value = cell;
        } else if ('t' in cell) {
          target.value = cell.t;
          target.font = { bold: !!cell.bold, italic: !!cell.italic };
        } else if ('f' in cell) {
          target.value = { formula: cell.f, result: cell.v ?? undefined } as never;
          if (cell.fmt) target.numFmt = NUM_FMT[cell.fmt];
          if (cell.bold) target.font = { bold: true };
        } else if ('date' in cell) {
          const [y, m, d] = cell.date.split('-').map(Number) as [number, number, number];
          target.value = new Date(Date.UTC(y, m - 1, d));
          target.numFmt = NUM_FMT.date;
        } else {
          target.value = cell.v;
          if (cell.fmt) target.numFmt = NUM_FMT[cell.fmt];
        }
      });
    });
  }
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

/** Converts the description to plain values/formulas for HyperFormula (tests). */
export function toHyperFormulaSheets(book: XBook): Record<string, (string | number | null)[][]> {
  const out: Record<string, (string | number | null)[][]> = {};
  for (const s of book.sheets) {
    out[s.name] = s.rows.map((row) =>
      row.map((cell) => {
        if (cell === null || typeof cell === 'string' || typeof cell === 'number') return cell;
        if ('t' in cell) return cell.t;
        if ('f' in cell) return `=${cell.f}`;
        if ('date' in cell) return excelSerial(cell.date);
        return cell.v;
      }),
    );
  }
  return out;
}

/** Finds the cell holding a formula marked with `id` (via the label in the column to its left). */
export function findLabeled(sheet: XSheet, label: string): { row: number; col: number } | null {
  for (let r = 0; r < sheet.rows.length; r++) {
    const row = sheet.rows[r]!;
    for (let c = 0; c < row.length - 1; c++) {
      const cell = row[c];
      const text =
        typeof cell === 'string'
          ? cell
          : cell && typeof cell === 'object' && 't' in cell
            ? cell.t
            : null;
      if (text === label) return { row: r, col: c + 1 };
    }
  }
  return null;
}
