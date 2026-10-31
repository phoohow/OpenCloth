import type { StrainStats } from './strain';

/** Builds a two-column CSV summary of one strain pass, ready for a spreadsheet. */
export function strainReportCsv(
  projectName: string,
  stats: StrainStats,
  range: { min: number; max: number },
  now = new Date(),
): string {
  const rows: Array<[string, string]> = [
    ['工程', projectName],
    ['日期', now.toISOString()],
    ['色标下限', range.min.toFixed(3)],
    ['色标上限', range.max.toFixed(3)],
    ['最小应变', stats.min.toFixed(5)],
    ['最大应变', stats.max.toFixed(5)],
    ['平均绝对应变', stats.meanAbs.toFixed(5)],
  ];
  return rows.map(([label, value]) => `${csvCell(label)},${csvCell(value)}`).join('\r\n');
}

/** Quotes a CSV cell when it contains a separator, quote or newline. */
function csvCell(value: string): string {
  if (!/[",\r\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}