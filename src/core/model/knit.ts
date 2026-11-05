import type { Fabric, KnitSpec, KnitStitch } from './types';

export type { KnitSpec, KnitStitch } from './types';

/** Chinese labels of the stitch structures. */
export const KNIT_STITCH_LABELS: Record<KnitStitch, string> = {
  jersey: '平针',
  rib2: '2×2 罗纹',
  cable: '绞花',
};

/** Stitch structures in selection order. */
export const KNIT_STITCHES: KnitStitch[] = ['jersey', 'rib2', 'cable'];

/** Density used by a fabric without an explicit knit record. */
export const DEFAULT_KNIT_SPEC: KnitSpec = { stitch: 'jersey', needleGauge: 12, rowGauge: 15 };

/** Knit structure of a material, falling back to a jersey default. */
export function knitOf(fabric: Fabric | null | undefined): KnitSpec {
  return fabric?.knit ?? DEFAULT_KNIT_SPEC;
}

/** Needles across a panel width, given the material's gauge. */
export function knitNeedleCount(widthCm: number, spec: KnitSpec): number {
  return Math.max(1, Math.round((Math.max(0, widthCm) / 10) * Math.max(1, spec.needleGauge)));
}

/** Courses down a panel height, given the material's course gauge. */
export function knitRowCount(heightCm: number, spec: KnitSpec): number {
  return Math.max(1, Math.round((Math.max(0, heightCm) / 10) * Math.max(1, spec.rowGauge)));
}

const MAX_CHART_SIDE = 400;

/** One chart symbol: K knit, P purl, X cable crossing. */
export function knitChartSymbol(spec: KnitSpec, row: number, column: number): string {
  if (spec.stitch === 'rib2') return column % 4 < 2 ? 'K' : 'P';
  if (spec.stitch === 'cable') return row % 8 === 4 && column % 6 >= 2 && column % 6 < 4 ? 'X' : 'K';
  return 'K';
}

/** CSV stitch chart with a header row and a symbol legend. */
export function knitChartCsv(spec: KnitSpec, needles: number, rows: number): string {
  const width = Math.min(MAX_CHART_SIDE, Math.max(1, Math.round(needles)));
  const height = Math.min(MAX_CHART_SIDE, Math.max(1, Math.round(rows)));
  const lines: string[] = [];
  lines.push(['行\\列', ...Array.from({ length: width }, (_, i) => String(i + 1))].join(','));
  for (let row = 0; row < height; row++) {
    const cells: string[] = [String(height - row)];
    for (let column = 0; column < width; column++) cells.push(knitChartSymbol(spec, row, column));
    lines.push(cells.join(','));
  }
  lines.push('# 图例：K=下针 P=上针 X=绞花；第一行与第一列为针号/行号');
  return lines.join('\r\n');
}
