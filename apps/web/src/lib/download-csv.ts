import type { CsvExport } from '@erp/contracts';

/**
 * Saves an exported CSV through the browser. The text already starts with a byte-order mark, and
 * a Blob built from a string is encoded as UTF-8 without dropping it, so the saved file begins
 * with the bytes EF BB BF that spreadsheet software needs to show Thai text correctly (RPT-04).
 */
export function downloadCsv({ filename, content }: CsvExport): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
