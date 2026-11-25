/**
 * Excel upload → tab-separated text for the existing paste parsers.
 *
 * Safety (untrusted files): only .xlsx is accepted (macro-enabled .xlsm and binary .xls/.xlsb
 * are refused), the size is capped, the ZIP signature is checked before parsing, and cells are
 * read as values only. Formulas are never evaluated: the result Excel cached is used.
 */
export const MAX_XLSX_BYTES = 5_000_000;
export const MAX_XLSX_ROWS = 5_000;

export class ImportError extends Error {}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (typeof v === 'string') return v.replace(/[\t\r\n]+/g, ' ').trim();
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('result' in o) return cellText(o.result); // formula: cached value only
    if (Array.isArray(o.richText))
      return (o.richText as { text?: string }[])
        .map((r) => r.text ?? '')
        .join('')
        .trim();
    if ('text' in o) return cellText(o.text); // hyperlink
    if ('error' in o) return '';
  }
  return '';
}

export function checkExcelFile(name: string, size: number, head: Uint8Array): void {
  const lower = name.toLowerCase();
  if (/\.(xlsm|xltm|xlam)$/.test(lower))
    throw new ImportError(
      'Macro-enabled workbooks are not accepted. Save the sheet as .xlsx first.',
    );
  if (/\.(xls|xlsb)$/.test(lower))
    throw new ImportError(
      'Legacy .xls / binary .xlsb files are not supported. Save the sheet as .xlsx.',
    );
  if (!lower.endsWith('.xlsx')) throw new ImportError('Choose an .xlsx file.');
  if (size > MAX_XLSX_BYTES) throw new ImportError('The workbook is larger than 5 MB.');
  if (!(head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04)) {
    throw new ImportError('The file is not a valid .xlsx workbook.');
  }
}

/** First worksheet with data, as tab-separated text (one line per row). */
export async function xlsxToText(file: {
  name: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}): Promise<string> {
  const buf = await file.arrayBuffer();
  checkExcelFile(file.name, file.size, new Uint8Array(buf.slice(0, 4)));
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf);
  } catch {
    throw new ImportError('The workbook could not be read.');
  }
  const ws = wb.worksheets.find((w) => w.actualRowCount > 0);
  if (!ws) throw new ImportError('The workbook has no data.');
  if (ws.actualRowCount > MAX_XLSX_ROWS) throw new ImportError(`More than ${MAX_XLSX_ROWS} rows.`);
  const lines: string[] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    for (let c = 1; c <= row.cellCount; c++) cells.push(cellText(row.getCell(c).value));
    lines.push(cells.join('\t').replace(/\t+$/, ''));
  });
  return lines.join('\n');
}
