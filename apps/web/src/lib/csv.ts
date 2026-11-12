/**
 * CSV for the accountant.
 *
 * Two rules earn their keep here: a field that contains a comma, a quote or a newline is
 * quoted with its quotes doubled, and the file starts with a BOM so Excel on Windows reads
 * the rupee names and accented spellings as UTF-8 instead of mojibake. Everything else is
 * plain text — a timesheet nobody has to explain.
 */
export function toCsv(rows: (string | number | null)[][]): string {
  return rows.map((row) => row.map(cell).join(',')).join('\r\n');
}

function cell(value: string | number | null): string {
  if (value === null) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Hands a string to the browser as a download. The BOM is what makes Excel behave. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
