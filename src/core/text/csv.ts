/** One CSV row, already formatted cell by cell. */
export type CsvRow = readonly string[];

/** Quotes one CSV cell when it holds a separator, quote or newline. */
export function csvCell(value: string): string {
  if (!/["\r\n,]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

/** Joins rows into one CRLF-separated table, the line ending spreadsheet editors expect. */
export function csvTable(rows: Iterable<CsvRow>): string {
  return [...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
}
