import { csvTable } from '@/common/text';
import type { StrainStats } from '@/analysis/strain';

/** Limits of one fabric written into a strain report. */
export interface StrainReportFabric {
  name: string;
  stretchLimit: number;
  compressionLimit: number;
}

/** How the strain report judges the pass, and the fabric limits behind it. */
export interface StrainReportOptions {
  /** `fabric` counts against each panel's own limits instead of the manual colour range. */
  mode: 'manual' | 'fabric';
  fabrics?: StrainReportFabric[];
}

/** Builds a two-column CSV summary of one strain pass, ready for a spreadsheet. */
export function strainReportCsv(
  projectName: string,
  stats: StrainStats,
  range: { min: number; max: number },
  options: StrainReportOptions = { mode: 'manual' },
  now = new Date(),
): string {
  const overLimit = stats.overStretch + stats.overCompression;
  const ratio = stats.vertices > 0 ? overLimit / stats.vertices * 100 : 0;
  const rows: Array<[string, string]> = [
    ['工程', projectName],
    ['日期', now.toISOString()],
    ['判定方式', options.mode === 'fabric' ? '按面料上限' : '通用色标'],
    ['色标下限', range.min.toFixed(3)],
    ['色标上限', range.max.toFixed(3)],
    ['最小应变', stats.min.toFixed(5)],
    ['最大应变', stats.max.toFixed(5)],
    ['平均绝对应变', stats.meanAbs.toFixed(5)],
    ['顶点数', String(stats.vertices)],
    ['超限拉伸', String(stats.overStretch)],
    ['超限压缩', String(stats.overCompression)],
    ['超限占比(%)', ratio.toFixed(2)],
  ];
  for (const fabric of options.fabrics ?? []) {
    rows.push([`面料 ${fabric.name} 拉伸上限(%)`, (fabric.stretchLimit * 100).toFixed(2)]);
    rows.push([`面料 ${fabric.name} 压缩上限(%)`, (fabric.compressionLimit * 100).toFixed(2)]);
  }
  return csvTable(rows);
}