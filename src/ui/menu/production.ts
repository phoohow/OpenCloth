export const PRODUCTION_ITEMS: ProductionItem[] = [
  { kind: 'exportMarker', label: '排料图', format: 'SVG / DXF' },
  { kind: 'exportCutGerber', label: 'Gerber', format: 'GBR' },
  { kind: 'exportCutHpgl', label: 'PLT', format: 'PLT' },
  { kind: 'exportDxf', label: 'DXF', format: 'DXF' },
  { kind: 'exportSvg', label: 'SVG', format: 'SVG' },
  { kind: 'exportPdf', label: 'PDF', format: 'PDF' },
  { kind: 'exportTechPack', label: '工艺单', format: 'PDF' },
  { kind: 'exportBom', label: 'BOM', format: 'CSV' },
];

export const MARKER_ANGLE_MODES = [
  { value: 'default', label: '0° / 90°（默认）' },
  { value: 'none', label: '仅 0°' },
  { value: '15', label: '0°–90°，每 15°' },
  { value: '5', label: '0°–90°，每 5°' },
  { value: 'free', label: '自定义角度' },
] as const;

export type ProductionOutputKind =
  | 'exportMarker'
  | 'exportCutGerber'
  | 'exportCutHpgl'
  | 'exportDxf'
  | 'exportSvg'
  | 'exportPdf'
  | 'exportTechPack'
  | 'exportBom';

export interface ProductionItem {
  kind: ProductionOutputKind;
  label: string;
  format: string;
}

export type MarkerAngleMode = typeof MARKER_ANGLE_MODES[number]['value'];

export function markerAngles(mode: MarkerAngleMode, freeText: string): number[] | undefined {
  if (mode === 'default') return undefined;
  if (mode === 'none') return [0];
  if (mode === 'free') {
    const parsed = freeText
      .split(/[,，\s]+/)
      .map(Number)
      .filter(value => Number.isFinite(value))
      .map(value => ((value % 360) + 360) % 360);
    return parsed.length > 0 ? [...new Set(parsed)] : [0];
  }

  const step = Number(mode);
  return Array.from({ length: Math.round(90 / step) + 1 }, (_, index) => index * step);
}

export function productionItem(kind: ProductionOutputKind): ProductionItem {
  return PRODUCTION_ITEMS.find(item => item.kind === kind) ?? PRODUCTION_ITEMS[0]!;
}
