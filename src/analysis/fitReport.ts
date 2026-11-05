import { csvTable } from '@/common/text';
import type { FitStats, FitThresholds } from '@/analysis/fit';

/** Builds a two-column CSV summary of one fit check, ready for a spreadsheet. */
export function fitReportCsv(
  projectName: string,
  stats: FitStats,
  thresholds: FitThresholds,
  now = new Date(),
): string {
  const rows: Array<[string, string]> = [
    ['工程', projectName],
    ['日期', now.toISOString()],
    ['贴近阈值(cm)', thresholds.tightCm.toFixed(2)],
    ['宽松阈值(cm)', thresholds.looseCm.toFixed(2)],
    ['顶点数', String(stats.vertices)],
    ['穿透', String(stats.penetration)],
    ['贴近', String(stats.tight)],
    ['合适', String(stats.ideal)],
    ['宽松', String(stats.loose)],
    ['最小间隙(cm)', stats.minCm.toFixed(3)],
    ['平均间隙(cm)', stats.meanCm.toFixed(3)],
    ['最大间隙(cm)', stats.maxCm.toFixed(3)],
  ];
  return csvTable(rows);
}
