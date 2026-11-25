import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildPdf, pdfText } from '../src/io/report';
import { writeXlsx } from '../src/io/xlsx';
import { CALCULATORS, defaults } from '../src/registry';

/** Every calculator, with its example inputs, must produce a valid workbook and a PDF report. */
describe('exports for every calculator', () => {
  for (const calc of CALCULATORS) {
    it(`${calc.id}: xlsx opens with formulas and PDF builds`, async () => {
      const values = defaults(calc);
      const comp = calc.compute(values);
      expect(comp.result.status).not.toBe('error');

      if (calc.excel) {
        const book = calc.excel(values)!;
        expect(book).not.toBeNull();
        const blob = await writeXlsx(book);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(await blob.arrayBuffer());
        let formulas = 0;
        wb.eachSheet((ws) =>
          ws.eachRow((row) => row.eachCell((cell) => (formulas += cell.formula ? 1 : 0))),
        );
        expect(formulas).toBeGreaterThan(0);
      }

      const doc = await buildPdf(calc, values, comp);
      const bytes = new Uint8Array(doc.output('arraybuffer'));
      expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
      expect(doc.getNumberOfPages()).toBeGreaterThan(0);
    });
  }
});

describe('pdfText', () => {
  it('maps symbols outside Latin-1 (the PDF base fonts) and keeps those inside', () => {
    // ± and × are Latin-1, so they stay.
    expect(pdfText('−20% ≥ 0 ± 5 × 2 → β Şirket ığ')).toBe('-20% >= 0 ± 5 × 2 -> beta Sirket ig');
  });
});
