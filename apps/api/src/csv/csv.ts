import type { CsvExport } from '@erp/contracts';

/** A cell is text from the database (untrusted) or a number the API computed itself. */
export type CsvCell = string | number | null;

const BYTE_ORDER_MARK = '\uFEFF';

/**
 * A spreadsheet runs a cell as a formula when it starts with one of these (OWASP, "CSV
 * Injection"): `=`, `+`, `-`, `@`, a tab or a carriage return.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * Makes a text cell inert by putting an apostrophe in front, so the spreadsheet reads it as text.
 * Numbers are left alone: they are produced by the API, never typed by a user.
 */
function neutralize(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value;
}

/** Quotes a cell that holds a comma, a quote, a line break or a tab; doubles inner quotes. */
function quote(text: string): string {
  return /[",\r\n\t]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toText(cell: CsvCell): string {
  if (cell === null) return '';
  return typeof cell === 'number' ? String(cell) : quote(neutralize(cell));
}

/**
 * Builds a CSV file (RPT-04): a UTF-8 byte-order mark so spreadsheet software shows Thai text
 * correctly, then CRLF-separated rows, with every text cell neutralized against formula injection.
 */
export function csvExport(filename: string, rows: CsvCell[][]): CsvExport {
  const body = rows.map((row) => row.map(toText).join(',') + '\r\n').join('');
  return { filename, content: BYTE_ORDER_MARK + body };
}
