export type CsvRow = readonly string[];

const pad = (n: number): string => String(n).padStart(2, '0');

const clock = (d: Date): string => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function csvCell(value: string): string {
  if (!/["\r\n,]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

export function csvTable(rows: Iterable<CsvRow>): string {
  return [...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
}

export function stripExtension(fileName: string): string {
  const bare = fileName.slice(fileName.lastIndexOf('/') + 1);
  return bare.replace(/\.[^.\\/]+$/, '');
}

export function formatSavedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${clock(date)}`;
}

export function formatClockTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : clock(date);
}
