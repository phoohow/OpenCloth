/** One CSV row, already formatted cell by cell. */
export type CsvRow = readonly string[];

/** Quotes one CSV cell when it holds a separator, quote or newline. */
export function csvCell(value: string): string {
  if (!/["\r\n,]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

/** Joins rows into one CRLF-separated table. */
export function csvTable(rows: Iterable<CsvRow>): string {
  return [...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
}

const pad = (n: number): string => String(n).padStart(2, '0');
const clock = (d: Date): string => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Storage timestamp as MM-DD HH:mm. */
export function formatSavedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${clock(date)}`;
}

/** Storage timestamp as HH:mm. */
export function formatClockTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : clock(date);
}
