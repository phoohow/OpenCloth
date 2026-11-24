import type { Fabric, KnitSpec, KnitStitch } from '@/model/types';

export type { KnitSpec, KnitStitch } from '@/model/types';

export const KNIT_STITCH_LABELS: Record<KnitStitch, string> = {
  jersey: '平针',
  rib2: '2×2 罗纹',
  cable: '绞花',
};

export const KNIT_STITCHES: KnitStitch[] = ['jersey', 'rib2', 'cable'];

export const KNIT_NEEDLE_GAUGE_MIN = 6;

export const KNIT_NEEDLE_GAUGE_MAX = 80;

export const KNIT_ROW_GAUGE_MIN = 8;

export const KNIT_ROW_GAUGE_MAX = 110;

export const KNIT_MACHINE_GAUGES: KnitMachineGauge[] = [
  { gauge: 3, needleGauge: 12, rowGauge: 15 },
  { gauge: 5, needleGauge: 20, rowGauge: 26 },
  { gauge: 7, needleGauge: 28, rowGauge: 36 },
  { gauge: 9, needleGauge: 35, rowGauge: 46 },
  { gauge: 12, needleGauge: 47, rowGauge: 62 },
  { gauge: 14, needleGauge: 55, rowGauge: 72 },
  { gauge: 16, needleGauge: 63, rowGauge: 82 },
  { gauge: 18, needleGauge: 71, rowGauge: 92 },
];

export const DEFAULT_KNIT_SPEC: KnitSpec = { stitch: 'jersey', needleGauge: 47, rowGauge: 62 };

export interface KnitMachineGauge {
  gauge: number;
  needleGauge: number;
  rowGauge: number;
}

export function knitGaugeOf(spec: KnitSpec): number | null {
  const match = KNIT_MACHINE_GAUGES.find(g => g.needleGauge === Math.round(spec.needleGauge));
  return match?.gauge ?? null;
}

function clampGauge(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function normalizeKnitSpec(spec: Partial<KnitSpec> | undefined): KnitSpec {
  return {
    stitch: spec?.stitch === 'rib2' || spec?.stitch === 'cable' ? spec.stitch : DEFAULT_KNIT_SPEC.stitch,
    needleGauge: clampGauge(
      spec?.needleGauge, DEFAULT_KNIT_SPEC.needleGauge, KNIT_NEEDLE_GAUGE_MIN, KNIT_NEEDLE_GAUGE_MAX,
    ),
    rowGauge: clampGauge(spec?.rowGauge, DEFAULT_KNIT_SPEC.rowGauge, KNIT_ROW_GAUGE_MIN, KNIT_ROW_GAUGE_MAX),
  };
}

export function knitOf(fabric: Fabric | null | undefined): KnitSpec {
  return fabric?.knit ?? DEFAULT_KNIT_SPEC;
}

export function knitNeedleCount(widthCm: number, spec: KnitSpec): number {
  const raw = Math.max(1, Math.round((Math.max(0, widthCm) / 10) * Math.max(1, spec.needleGauge)));
  if (spec.stitch !== 'rib2') return raw;
  return Math.max(3, Math.round((raw - 2) / 4) * 4 + 2);
}

export function knitRowCount(heightCm: number, spec: KnitSpec): number {
  return Math.max(1, Math.round((Math.max(0, heightCm) / 10) * Math.max(1, spec.rowGauge)));
}
