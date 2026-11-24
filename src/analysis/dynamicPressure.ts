import type { PressureStats } from '@/analysis/pressure';

import { csvTable, type CsvRow } from '@/base/string';

export const MAX_DYNAMIC_FRAMES = 20000;

export interface DynamicPressureFrame {
  timeMs: number;
  frame: number;
  vertices: number;
  contactVertices: number;
  minKpa: number;
  meanKpa: number;
  maxKpa: number;
}

export interface DynamicPressureOptions {
  maxKpa: number;
  kpaPerMm: number;
  clipName?: string;
}

export function pushDynamicFrame(
  frames: DynamicPressureFrame[],
  frame: DynamicPressureFrame,
  limit = MAX_DYNAMIC_FRAMES,
): void {
  frames.push(frame);
  if (frames.length > limit) frames.splice(0, frames.length - limit);
}

export function dynamicFrame(timeMs: number, frame: number, stats: PressureStats): DynamicPressureFrame {
  return {
    timeMs,
    frame,
    vertices: stats.vertices,
    contactVertices: stats.contactVertices,
    minKpa: stats.minKpa,
    meanKpa: stats.meanKpa,
    maxKpa: stats.maxKpa,
  };
}

export function dynamicPressureCsv(
  projectName: string,
  frames: readonly DynamicPressureFrame[],
  options: DynamicPressureOptions,
  now = new Date(),
): string {
  const header: Array<[string, string]> = [
    ['工程', projectName],
    ['日期', now.toISOString()],
    ['口径', '接触法向修正量估算，非接触力求解'],
    ['换算(kPa/mm)', options.kpaPerMm.toFixed(2)],
    ['色标上限(kPa)', options.maxKpa.toFixed(2)],
    ['动画片段', options.clipName ?? '-'],
    ['采样帧数', String(frames.length)],
  ];
  const columns = ['时间(ms)', '仿真帧', '顶点数', '接触顶点', '最小压力(kPa)', '平均压力(kPa)', '最大压力(kPa)'];
  const rows: CsvRow[] = [...header, columns];
  for (const frame of frames) {
    rows.push([
      frame.timeMs.toFixed(0),
      String(frame.frame),
      String(frame.vertices),
      String(frame.contactVertices),
      frame.minKpa.toFixed(2),
      frame.meanKpa.toFixed(2),
      frame.maxKpa.toFixed(2),
    ]);
  }

  return csvTable(rows);
}
