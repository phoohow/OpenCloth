import { csvTable } from '../../core/text/csv';
import type { PressureStats } from './pressure';

/** Scale and wording of one pressure report. */
export interface PressureReportOptions {
  /** Upper end of the colour scale, in kilopascals. */
  maxKpa: number;
  /** Pressure added per millimetre of normal indentation. */
  kpaPerMm: number;
  /** Display names of the panels that had contact, keyed by panel id. */
  panelNames?: Readonly<Record<string, string>>;
}

/** Builds a two-column CSV summary of one pressure pass, ready for a spreadsheet. */
export function pressureReportCsv(
  projectName: string,
  stats: PressureStats,
  options: PressureReportOptions,
  now = new Date(),
): string {
  const rows: Array<[string, string]> = [
    ['工程', projectName],
    ['日期', now.toISOString()],
    ['口径', '接触法向修正量估算，非接触力求解'],
    ['换算(kPa/mm)', options.kpaPerMm.toFixed(2)],
    ['色标上限(kPa)', options.maxKpa.toFixed(2)],
    ['顶点数', String(stats.vertices)],
    ['接触顶点', String(stats.contactVertices)],
    ['最小压力(kPa)', stats.minKpa.toFixed(2)],
    ['平均压力(kPa)', stats.meanKpa.toFixed(2)],
    ['最大压力(kPa)', stats.maxKpa.toFixed(2)],
  ];
  for (const panel of stats.panels) {
    const name = options.panelNames?.[panel.panelId] ?? panel.panelId;
    rows.push([`版片 ${name} 接触顶点`, String(panel.contactVertices)]);
    rows.push([`版片 ${name} 平均压力(kPa)`, panel.meanKpa.toFixed(2)]);
    rows.push([`版片 ${name} 最大压力(kPa)`, panel.maxKpa.toFixed(2)]);
  }
  return csvTable(rows);
}
