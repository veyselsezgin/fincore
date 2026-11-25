import { STATEMENT_ITEMS, type StatementItemKey } from '@fincore/engine';
import { parseMatrix, type ParseOptions } from './parse';

/**
 * Maps pasted statement rows (English or Turkish labels, as exported by common accounting
 * software or typed in Excel) to FinCore line items.
 */
const ALIASES: Record<StatementItemKey, string[]> = {
  cash: [
    'cash',
    'cash and cash equivalents',
    'cash & equivalents',
    'cash and equivalents',
    'nakit',
    'nakit ve nakit benzerleri',
    'hazir degerler',
  ],
  shortTermInvestments: [
    'short-term investments',
    'short term investments',
    'marketable securities',
    'finansal yatirimlar',
    'kisa vadeli yatirimlar',
    'menkul kiymetler',
  ],
  receivables: [
    'accounts receivable',
    'trade receivables',
    'receivables',
    'ticari alacaklar',
    'alacaklar',
  ],
  inventory: ['inventory', 'inventories', 'stoklar', 'stok'],
  otherCurrentAssets: ['other current assets', 'diger donen varliklar'],
  nonCurrentAssets: [
    'non-current assets',
    'noncurrent assets',
    'total non-current assets',
    'fixed assets',
    'duran varliklar',
    'toplam duran varliklar',
  ],
  payables: ['accounts payable', 'trade payables', 'payables', 'ticari borclar'],
  shortTermDebt: [
    'short-term debt',
    'short term debt',
    'short-term borrowings',
    'current portion of long-term debt',
    'kisa vadeli borclanmalar',
    'kisa vadeli finansal borclar',
  ],
  otherCurrentLiabilities: ['other current liabilities', 'diger kisa vadeli yukumlulukler'],
  longTermDebt: [
    'long-term debt',
    'long term debt',
    'long-term borrowings',
    'uzun vadeli borclanmalar',
    'uzun vadeli finansal borclar',
  ],
  otherNonCurrentLiabilities: [
    'other non-current liabilities',
    'other noncurrent liabilities',
    'diger uzun vadeli yukumlulukler',
  ],
  equity: [
    'total equity',
    "shareholders' equity",
    'shareholders equity',
    "stockholders' equity",
    'equity',
    'ozkaynaklar',
    'toplam ozkaynaklar',
  ],
  retainedEarnings: ['retained earnings', 'gecmis yillar karlari', 'birikmis karlar'],
  revenue: [
    'revenue',
    'revenues',
    'sales',
    'net sales',
    'total revenue',
    'hasilat',
    'satis gelirleri',
    'net satislar',
  ],
  cogs: ['cost of goods sold', 'cost of sales', 'cogs', 'satislarin maliyeti'],
  operatingExpenses: [
    'operating expenses',
    'sg&a',
    'selling, general and administrative',
    'selling general and administrative',
    'faaliyet giderleri',
  ],
  depreciation: [
    'depreciation',
    'depreciation and amortisation',
    'depreciation and amortization',
    'depreciation & amortisation',
    'd&a',
    'amortisman',
    'amortisman giderleri',
  ],
  interestExpense: [
    'interest expense',
    'interest',
    'finance costs',
    'finansman giderleri',
    'faiz giderleri',
  ],
  otherIncome: ['other income', 'other non-operating income', 'diger gelirler'],
  taxExpense: [
    'income tax expense',
    'tax expense',
    'income taxes',
    'taxes',
    'vergi gideri',
    'donem vergi gideri',
  ],
  principalRepayment: [
    'principal repayment',
    'scheduled principal',
    'scheduled principal repayment',
    'anapara odemesi',
  ],
  operatingCashFlow: [
    'cash flow from operations',
    'operating cash flow',
    'cash from operations',
    'cfo',
    'isletme faaliyetlerinden nakit akislari',
  ],
  marketCap: [
    'market value of equity',
    'market cap',
    'market capitalisation',
    'market capitalization',
    'piyasa degeri',
  ],
};

/** Lower-case, fold Turkish letters and accents, drop the "(optional)" style suffixes. */
export function normaliseLabel(s: string): string {
  return s
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/[:*]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const TABLE: { key: StatementItemKey; alias: string }[] = STATEMENT_ITEMS.flatMap((it) =>
  [it.label, ...ALIASES[it.key]].map((a) => ({ key: it.key, alias: normaliseLabel(a) })),
).sort((a, b) => b.alias.length - a.alias.length);

export function matchItem(label: string): StatementItemKey | null {
  const n = normaliseLabel(label);
  if (!n) return null;
  const exact = TABLE.find((x) => x.alias === n);
  if (exact) return exact.key;
  // Longest alias contained in the label ("Total trade receivables, net" → receivables).
  const contained = TABLE.find(
    (x) => x.alias.length >= 3 && new RegExp(`(^|[^a-z])${escapeRe(x.alias)}([^a-z]|$)`).test(n),
  );
  return contained?.key ?? null;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface StatementImport {
  periods: string[] | null;
  values: Partial<Record<StatementItemKey, number[]>>;
  matched: { line: number; label: string; key: StatementItemKey }[];
  unmatched: { line: number; label: string }[];
  notes: string[];
  errors: string[];
  periodCount: number;
}

/**
 * Parses a pasted block: one line item per row, one period per numeric column (up to 3).
 * A header row whose cells are all numbers or year-like labels sets the period names.
 */
export function parseStatementBlock(text: string, opts: ParseOptions = {}): StatementImport {
  const m = parseMatrix(text, opts);
  const out: StatementImport = {
    periods: null,
    values: {},
    matched: [],
    unmatched: [],
    notes: [...m.notes],
    errors: [...m.errors],
    periodCount: 0,
  };

  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  for (const row of m.rows) {
    const key = row.label ? matchItem(row.label) : null;
    if (!key) {
      // Header such as "Item  2023  2024  2025": label is generic or empty, numbers look like years.
      if (
        !out.periods &&
        row.numbers.length > 0 &&
        row.numbers.every((n) => Number.isInteger(n) && n >= 1900 && n <= 2200)
      ) {
        out.periods = row.numbers.map((n) => `FY${n}`);
        continue;
      }
      if (!out.periods && row.numbers.length === 0) {
        const cells = (lines[row.line - 1] ?? '')
          .split(/\t|;/)
          .map((c) => c.trim())
          .filter(Boolean);
        if (
          cells.length >= 2 &&
          cells.slice(1).every((c) => /(19|20|21)\d{2}|FY|Q[1-4]|period|dönem|donem/i.test(c))
        ) {
          out.periods = cells.slice(1, 4);
          continue;
        }
      }
      if (row.label || row.numbers.length)
        out.unmatched.push({ line: row.line, label: row.label || '(numbers only)' });
      continue;
    }
    if (row.numbers.length === 0) {
      out.unmatched.push({ line: row.line, label: `${row.label} (no numbers)` });
      continue;
    }
    if (out.values[key])
      out.notes.push(`"${row.label}" (line ${row.line}) repeats ${key}; the first row was kept.`);
    else {
      out.values[key] = row.numbers.slice(0, 3);
      out.matched.push({ line: row.line, label: row.label, key });
    }
    if (row.numbers.length > 3)
      out.notes.push(
        `Line ${row.line} has more than 3 numbers; only the first 3 periods are used.`,
      );
  }
  out.periodCount = Math.max(0, ...Object.values(out.values).map((v) => v!.length));
  if (out.matched.length === 0 && out.errors.length === 0)
    out.errors.push(
      'No recognised line items. Put the item name in the first column (e.g. "Revenue", "Hasılat", "Ticari alacaklar").',
    );
  return out;
}

const EXPENSE_ITEMS: StatementItemKey[] = [
  'cogs',
  'operatingExpenses',
  'depreciation',
  'interestExpense',
  'taxExpense',
];
const ALWAYS_POSITIVE: StatementItemKey[] = ['principalRepayment'];

/**
 * Many statements (IFRS/TFRS layouts) print expenses as negative numbers. FinCore expects
 * expenses as positive amounts, so when most expense lines are negative the expense signs are
 * flipped (a positive tax line then correctly becomes a tax benefit).
 */
export function normaliseExpenseSigns(imp: StatementImport): StatementImport {
  const expenseValues = EXPENSE_ITEMS.flatMap((k) => imp.values[k] ?? []).filter((x) => x !== 0);
  const negative = expenseValues.filter((x) => x < 0).length;
  const values = { ...imp.values };
  const notes = [...imp.notes];
  if (expenseValues.length > 0 && negative > expenseValues.length / 2) {
    for (const k of EXPENSE_ITEMS)
      if (values[k]) values[k] = values[k]!.map((x) => (x === 0 ? 0 : -x));
    notes.push(
      'Expenses were shown as negative numbers; they were converted to positive amounts (a positive tax line is treated as a tax benefit).',
    );
  }
  for (const k of ALWAYS_POSITIVE) {
    if (values[k]?.some((x) => x < 0)) {
      values[k] = values[k]!.map(Math.abs);
      notes.push('Principal repayment was entered as an outflow; its absolute value is used.');
    }
  }
  return { ...imp, values, notes };
}
