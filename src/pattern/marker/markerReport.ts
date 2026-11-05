import type { Vec2 } from '../../core/model/types';
import { csvTable } from '../../core/text/csv';
import type { MarkerLayout, MarkerPlacement } from './markerLayout';

/** Cost input for a marker report; prices are per running metre of fabric. */
export interface MarkerCostOptions {
  pricePerMeter?: number;
  currency?: string;
}

/** One panel's contribution to the marker, grouped by name. */
export interface MarkerPanelCount {
  name: string;
  count: number;
  areaM2: number;
}

/** Aggregate marker measurements and cost. */
export interface MarkerReport {
  pieceCount: number;
  panels: MarkerPanelCount[];
  usedLengthM: number;
  fabricAreaM2: number;
  garmentAreaM2: number;
  /** Piece area divided by fabric area, in [0, 1]. */
  utilization: number;
  cost: number | null;
  currency: string;
}

/** Shoelace area of a closed polygon, in the polygon's unit squared. */
export function polygonArea(points: Vec2[]): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/** Builds a marker report from the shared marker layout, optionally pricing the fabric. */
export function buildMarkerReport(layout: MarkerLayout, options: MarkerCostOptions = {}): MarkerReport {
  const byPanel = new Map<string, MarkerPanelCount>();
  let garmentAreaCm2 = 0;

  for (const entry of layout.placements) {
    const areaCm2 = polygonArea(entry.piece.outline);
    garmentAreaCm2 += areaCm2;
    const current = byPanel.get(entry.piece.name);
    if (current) {
      current.count += 1;
      current.areaM2 += areaCm2 / 10_000;
    } else {
      byPanel.set(entry.piece.name, {
        name: entry.piece.name,
        count: 1,
        areaM2: areaCm2 / 10_000,
      });
    }
  }

  const usedLengthM = layout.usedLengthCm / 100;
  const fabricAreaM2 = usedLengthM * (layout.fabricWidthCm / 100);
  const garmentAreaM2 = garmentAreaCm2 / 10_000;
  const price = options.pricePerMeter;
  const cost = typeof price === 'number' && Number.isFinite(price) && price >= 0 ? usedLengthM * price : null;

  return {
    pieceCount: layout.placements.length,
    panels: [...byPanel.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN')),
    usedLengthM,
    fabricAreaM2,
    garmentAreaM2,
    utilization: fabricAreaM2 > 0 ? garmentAreaM2 / fabricAreaM2 : 0,
    cost,
    currency: options.currency ?? 'CNY',
  };
}

/** Fixed-column CSV for a marker report; numbers use four decimals. */
export function markerReportCsv(report: MarkerReport): string {
  const rows: string[][] = [
    ['项目', '数值'],
    ['版片数', String(report.pieceCount)],
    ['用料长度(m)', report.usedLengthM.toFixed(4)],
    ['面料面积(m²)', report.fabricAreaM2.toFixed(4)],
    ['版片面积(m²)', report.garmentAreaM2.toFixed(4)],
    ['利用率', report.utilization.toFixed(4)],
  ];
  if (report.cost !== null) rows.push([`面料成本 (${report.currency})`, report.cost.toFixed(2)]);
  rows.push(['版片', '数量', '面积(m²)']);
  for (const panel of report.panels) {
    rows.push([panel.name, String(panel.count), panel.areaM2.toFixed(4)]);
  }
  return csvTable(rows);
}

/** Total placed outline area; exposed for callers that already have placements. */
export function placedAreaM2(placements: MarkerPlacement[]): number {
  return placements.reduce((sum, entry) => sum + polygonArea(entry.piece.outline), 0) / 10_000;
}
