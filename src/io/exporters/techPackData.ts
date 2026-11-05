import type { Fabric, Measurement, Pattern, Project, Seam, SeamType, SizeDef, Vec2 } from '@/model/types';
import {
  DEFAULT_COMPRESSION_LIMIT, DEFAULT_CONTACT_FRICTION, DEFAULT_STRETCH_LIMIT,
  EDGE_SEMANTIC_LABELS, SEAM_TYPE_LABELS, TRIM_KIND_LABELS,
} from '@/model';
import { samplePanelOutline, sampleOutline, panelGrainLine } from '@/pattern/panel';
import { edgeIntervalLength, measurementValue, sampleEdge } from '@/pattern/geom';
import { orderedSizes } from '@/pattern/grading';
import { buildMarkerLayout } from '@/pattern/marker';
import { buildMarkerReport } from '@/pattern/marker';
import { buildBom, panelAreas, type BomRow } from '@/pattern';
import { buildPomTable, pomReportRows } from '@/pattern/pom';

/** Inputs of the tech pack summary and PDF; every field has a production default. */
export interface TechPackOptions {
  /** Calendar date printed on the sheet, ISO `YYYY-MM-DD`; defaults to today. */
  date?: string;
  /** Marker fabric width in centimetres; default 150. */
  fabricWidthCm?: number;
  /** Marker shrinkage percentage; default 0. */
  shrinkPercent?: number;
  /** Marker gap between pieces in centimetres; default 0.5. */
  gapCm?: number;
  /** Fabric price per running metre; the cost row is omitted when absent. */
  pricePerMeter?: number;
  /** Cost currency, default CNY. */
  currency?: string;
}

/** One size chart entry as printed on the sheet. */
export interface TechPackSizeRow {
  label: string;
  isBase: boolean;
  isActive: boolean;
}

/** One visible panel with its net and gross area. */
export interface TechPackPanelRow {
  id: string;
  name: string;
  quantity: number;
  netAreaM2: number;
  grossAreaM2: number;
}

/** One material with its appearance and physical fields. */
export interface TechPackFabricRow {
  id: string;
  name: string;
  baseColor: string;
  massPerArea: number;
  stretchStiffness: number;
  bendingStiffness: number;
  shearStiffness: number;
  damping: number;
  creaseStiffness: number | null;
  contactFriction: number;
  /** Relative elongation tolerance, as a ratio. */
  stretchLimit: number;
  /** Relative compression tolerance, as a ratio. */
  compressionLimit: number;
}

/** One seam with both panel/edge descriptions and its sewing parameters. */
export interface TechPackSeamRow {
  id: string;
  name: string;
  panelA: string;
  panelB: string;
  edgeA: string;
  edgeB: string;
  intervalA: string;
  intervalB: string;
  /** Stitched length of side A, in centimetres. */
  lengthCm: number;
  type: SeamType;
  typeLabel: string;
  allowanceA: number;
  allowanceB: number;
  gather: boolean;
  gatherRatio: number | null;
}

/** Marker summary; `note` explains why nothing was laid out. */
export interface TechPackMarkerSummary {
  laidOut: boolean;
  fabricWidthCm: number;
  shrinkPercent: number;
  gapCm: number;
  pieceCount: number;
  usedLengthM: number;
  fabricAreaM2: number;
  garmentAreaM2: number;
  utilization: number;
  cost: number | null;
  currency: string;
  note: string | null;
}

/** One dimension line with a computable value. */
export interface TechPackMeasurementRow {
  id: string;
  name: string;
  panelName: string;
  kind: Measurement['kind'];
  value: number;
  unit: 'cm' | 'deg';
}

/** One placed print with its size and tiling. */
export interface TechPackPrintRow {
  id: string;
  name: string;
  panelName: string;
  widthCm: number;
  heightCm: number;
  angleDeg: number;
  repeat: Vec2;
  opacity: number;
}

/** One topstitch line group with its interval length. */
export interface TechPackTopstitchRow {
  id: string;
  name: string;
  panelName: string;
  edge: string;
  /** Interval along the edge as percentages. */
  interval: string;
  offsetMm: number;
  spacingMm: number;
  rows: number;
  /** Stitched length of all rows, in centimetres. */
  lengthCm: number;
}

/** One trim mark with its production count. */
export interface TechPackTrimRow {
  id: string;
  name: string;
  panelName: string;
  kindLabel: string;
  sizeMm: number;
  /** Pattern-plane position in centimetres, formatted for the sheet. */
  positionCm: string;
  color: string;
  quantity: number;
  unitPrice: number | null;
}

/** One POM value of one size, as printed in the POM table. */
export interface TechPackPomRow {
  id: string;
  name: string;
  part: string;
  sizeLabel: string;
  valueCm: number | null;
  /** Difference from the base size, in centimetres. */
  diffCm: number | null;
  formula: string | null;
}

/** One panel outline prepared for the style and operation drawings. */
export interface TechPackStylePanel {
  id: string;
  name: string;
  outline: Vec2[];
  holes: Vec2[][];
  grain: Vec2[] | null;
}

/** One sewing operation, with the sampled edge intervals its diagram highlights. */
export interface TechPackOperationRow {
  step: number;
  panelAId: string;
  panelBId: string;
  panelAName: string;
  panelBName: string;
  edgeA: Vec2[];
  edgeB: Vec2[];
  typeLabel: string;
  allowanceCm: number;
  gather: boolean;
}

/** Everything the tech pack prints, computed from the live project. */
export interface TechPackData {
  projectName: string;
  date: string;
  sizes: TechPackSizeRow[];
  baseSizeLabel: string | null;
  activeSizeLabel: string | null;
  panels: TechPackPanelRow[];
  stylePanels: TechPackStylePanel[];
  operations: TechPackOperationRow[];
  fabrics: TechPackFabricRow[];
  seams: TechPackSeamRow[];
  prints: TechPackPrintRow[];
  topstitches: TechPackTopstitchRow[];
  trims: TechPackTrimRow[];
  bom: BomRow[];
  marker: TechPackMarkerSummary;
  measurements: TechPackMeasurementRow[];
  pom: TechPackPomRow[];
}

export const MEASUREMENT_KIND_LABELS: Record<Measurement['kind'], string> = {
  distance: '两点距离',
  edgeLength: '边长',
  angle: '角度',
};

/** True while the seam consumes extra fabric through gathering. */
function isGatherSeam(seam: Seam): boolean {
  return seam.type === 'gather'
    || (typeof seam.gatherRatio === 'number' && Number.isFinite(seam.gatherRatio) && seam.gatherRatio < 0.999);
}

/** Index of the panel owning each edge of an outline or hole loop. */
function edgeOwners(pattern: Pattern): Map<string, string> {
  const owner = new Map<string, string>();
  for (const panel of Object.values(pattern.panels)) {
    for (const id of panel.outlineEdgeIds) if (!owner.has(id)) owner.set(id, panel.id);
    for (const loop of panel.holes ?? []) for (const id of loop) if (!owner.has(id)) owner.set(id, panel.id);
  }
  return owner;
}

/** Chinese description of an edge: custom name, then role, then edge type. */
function describeEdge(pattern: Pattern, edgeId: string): string {
  const edge = pattern.edges[edgeId];
  if (!edge) return '缺失边';
  if (edge.name) return edge.name;
  if (edge.semantic) return EDGE_SEMANTIC_LABELS[edge.semantic];
  return edge.type === 'arc' ? '圆弧边' : edge.type === 'bezier' ? '曲线边' : '直线边';
}

/** Effective seam allowance of an edge, in centimetres. */
function allowanceOf(pattern: Pattern, edgeId: string, panelId: string | undefined): number {
  const edge = pattern.edges[edgeId];
  if (edge?.seamAllowanceCm !== undefined) return edge.seamAllowanceCm;
  return panelId ? (pattern.panels[panelId]?.seamAllowanceCm ?? 0) : 0;
}

/** Summarises the default marker for the tech pack; failures keep the note instead of throwing. */
function markerSummary(pattern: Pattern, options: TechPackOptions): TechPackMarkerSummary {
  const fabricWidthCm = options.fabricWidthCm ?? 150;
  const shrinkPercent = options.shrinkPercent ?? 0;
  const gapCm = options.gapCm ?? 0.5;
  const empty: TechPackMarkerSummary = {
    laidOut: false, fabricWidthCm, shrinkPercent, gapCm, pieceCount: 0, usedLengthM: 0, fabricAreaM2: 0,
    garmentAreaM2: 0, utilization: 0, cost: null, currency: options.currency ?? 'CNY', note: null,
  };
  const drawable = Object.values(pattern.panels)
    .some(panel => panel.visible !== false && samplePanelOutline(pattern, panel).length >= 3);
  if (!drawable) return { ...empty, note: '无可见版片，未排料' };

  try {
    const layout = buildMarkerLayout(pattern, { fabricWidthCm, shrinkPercent, gapCm });
    const price = options.pricePerMeter;
    const report = buildMarkerReport(layout, {
      ...(typeof price === 'number' && Number.isFinite(price) ? { pricePerMeter: price } : {}),
      ...(options.currency ? { currency: options.currency } : {}),
    });
    return {
      laidOut: true,
      fabricWidthCm,
      shrinkPercent,
      gapCm,
      pieceCount: report.pieceCount,
      usedLengthM: report.usedLengthM,
      fabricAreaM2: report.fabricAreaM2,
      garmentAreaM2: report.garmentAreaM2,
      utilization: report.utilization,
      cost: report.cost,
      currency: report.currency,
      note: null,
    };
  } catch (err) {
    return { ...empty, note: `无法排料：${(err as Error).message}` };
  }
}

/** Points of one edge interval, sampled between `t0` and `t1`; empty when the edge is missing. */
function edgeIntervalPoints(pattern: Pattern, edgeId: string, t0: number, t1: number): Vec2[] {
  if (!pattern.edges[edgeId]) return [];
  const pts = sampleEdge(pattern, edgeId);
  if (pts.length < 2) return [];
  const total = pts.length - 1;
  const from = Math.min(t0, t1);
  const to = Math.max(t0, t1);
  const start = Math.max(0, Math.floor(from * total));
  const end = Math.min(total, Math.max(start + 1, Math.ceil(to * total)));
  return pts.slice(start, end + 1);
}

/** Builds the tech pack summary: sizes, panels, materials, seams, marker usage and measurements. */
export function buildTechPackData(project: Project, options: TechPackOptions = {}): TechPackData {
  const pattern = project.pattern;
  const chart: SizeDef[] = orderedSizes(project);
  const sizes = chart.map(size => ({
    label: size.label,
    isBase: !!size.isBase,
    isActive: size.id === project.activeSizeId,
  }));
  const baseSize = chart.find(size => size.isBase) ?? null;
  const activeSize = chart.find(size => size.id === project.activeSizeId) ?? null;

  const panels = Object.values(pattern.panels)
    .filter(panel => panel.visible !== false)
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
    .map(panel => ({ id: panel.id, name: panel.name, quantity: 1, ...panelAreas(pattern, panel) }));

  const stylePanels: TechPackStylePanel[] = panels.map(row => {
    const panel = pattern.panels[row.id]!;
    const outline = samplePanelOutline(pattern, panel);
    return {
      id: row.id,
      name: row.name,
      outline,
      holes: (panel.holes ?? []).map(loop => sampleOutline(pattern, loop)),
      grain: panelGrainLine(panel, outline),
    };
  });

  const fabrics = Object.values(project.fabrics)
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
    .map((fabric: Fabric): TechPackFabricRow => ({
      id: fabric.id,
      name: fabric.name,
      baseColor: fabric.appearance.baseColor,
      massPerArea: fabric.physics.massPerArea,
      stretchStiffness: fabric.physics.stretchStiffness,
      bendingStiffness: fabric.physics.bendingStiffness,
      shearStiffness: fabric.physics.shearStiffness,
      damping: fabric.physics.damping,
      creaseStiffness: typeof fabric.physics.creaseStiffness === 'number' ? fabric.physics.creaseStiffness : null,
      contactFriction: fabric.physics.contactFriction ?? DEFAULT_CONTACT_FRICTION,
      stretchLimit: fabric.physics.stretchLimit ?? DEFAULT_STRETCH_LIMIT,
      compressionLimit: fabric.physics.compressionLimit ?? DEFAULT_COMPRESSION_LIMIT,
    }));

  const owner = edgeOwners(pattern);
  const seams = Object.values(pattern.seams).map((seam: Seam): TechPackSeamRow => {
    const panelAId = owner.get(seam.a.edgeId);
    const panelBId = owner.get(seam.b.edgeId);
    const panelA = panelAId ? pattern.panels[panelAId]?.name ?? '—' : '—';
    const panelB = panelBId ? pattern.panels[panelBId]?.name ?? '—' : '—';
    const ratio = typeof seam.gatherRatio === 'number' && Number.isFinite(seam.gatherRatio) ? seam.gatherRatio : null;
    return {
      id: seam.id,
      name: seam.name ?? `${panelA} ↔ ${panelB}`,
      panelA,
      panelB,
      edgeA: describeEdge(pattern, seam.a.edgeId),
      edgeB: describeEdge(pattern, seam.b.edgeId),
      intervalA: `${Math.round(seam.a.t0 * 100)}% – ${Math.round(seam.a.t1 * 100)}%`,
      intervalB: `${Math.round(seam.b.t0 * 100)}% – ${Math.round(seam.b.t1 * 100)}%`,
      lengthCm: pattern.edges[seam.a.edgeId] ? edgeIntervalLength(pattern, seam.a.edgeId, seam.a.t0, seam.a.t1) : 0,
      type: seam.type,
      typeLabel: SEAM_TYPE_LABELS[seam.type],
      allowanceA: allowanceOf(pattern, seam.a.edgeId, panelAId),
      allowanceB: allowanceOf(pattern, seam.b.edgeId, panelBId),
      gather: isGatherSeam(seam),
      gatherRatio: ratio,
    };
  });

  const operations: TechPackOperationRow[] = Object.values(pattern.seams).map((seam, index) => {
    const panelAId = owner.get(seam.a.edgeId) ?? '';
    const panelBId = owner.get(seam.b.edgeId) ?? '';
    return {
      step: index + 1,
      panelAId,
      panelBId,
      panelAName: panelAId ? pattern.panels[panelAId]?.name ?? '—' : '—',
      panelBName: panelBId ? pattern.panels[panelBId]?.name ?? '—' : '—',
      edgeA: edgeIntervalPoints(pattern, seam.a.edgeId, seam.a.t0, seam.a.t1),
      edgeB: edgeIntervalPoints(pattern, seam.b.edgeId, seam.b.t0, seam.b.t1),
      typeLabel: SEAM_TYPE_LABELS[seam.type],
      allowanceCm: Math.max(allowanceOf(pattern, seam.a.edgeId, panelAId), allowanceOf(pattern, seam.b.edgeId, panelBId)),
      gather: isGatherSeam(seam),
    };
  });

  const measurements: TechPackMeasurementRow[] = [];
  for (const measurement of Object.values(pattern.measurements)) {
    const value = measurementValue(pattern, measurement);
    if (value === null || !Number.isFinite(value)) continue;
    measurements.push({
      id: measurement.id,
      name: measurement.name ?? MEASUREMENT_KIND_LABELS[measurement.kind],
      panelName: pattern.panels[measurement.panelId]?.name ?? '—',
      kind: measurement.kind,
      value,
      unit: measurement.kind === 'angle' ? 'deg' : 'cm',
    });
  }

  const pom = pomReportRows(buildPomTable(project)).map((row): TechPackPomRow => ({
    id: row.pomId,
    name: row.name,
    part: row.part,
    sizeLabel: row.sizeLabel,
    valueCm: row.valueCm,
    diffCm: row.diffCm,
    formula: row.formula,
  }));

  const prints: TechPackPrintRow[] = Object.values(pattern.prints)
    .filter(print => {
      const panel = pattern.panels[print.panelId];
      return !!panel && panel.visible !== false && print.visible !== false;
    })
    .map(print => ({
      id: print.id,
      name: print.name ?? print.imageName ?? '印花',
      panelName: pattern.panels[print.panelId]?.name ?? '—',
      widthCm: print.widthCm,
      heightCm: print.heightCm,
      angleDeg: print.angleDeg,
      repeat: print.repeat,
      opacity: print.opacity,
    }));

  const topstitches: TechPackTopstitchRow[] = Object.values(pattern.topstitches)
    .filter(stitch => {
      const panel = pattern.panels[stitch.panelId];
      return !!panel && panel.visible !== false && stitch.visible !== false;
    })
    .map(stitch => ({
      id: stitch.id,
      name: stitch.name ?? '明线',
      panelName: pattern.panels[stitch.panelId]?.name ?? '—',
      edge: describeEdge(pattern, stitch.edgeId),
      interval: `${Math.round(stitch.t0 * 100)}% – ${Math.round(stitch.t1 * 100)}%`,
      offsetMm: stitch.offsetMm,
      spacingMm: stitch.spacingMm,
      rows: stitch.rows,
      lengthCm: pattern.edges[stitch.edgeId]
        ? edgeIntervalLength(pattern, stitch.edgeId, stitch.t0, stitch.t1) * stitch.rows
        : 0,
    }));

  const trims: TechPackTrimRow[] = Object.values(pattern.trims)
    .filter(trim => {
      const panel = pattern.panels[trim.panelId];
      return !!panel && panel.visible !== false && trim.visible !== false;
    })
    .map(trim => ({
      id: trim.id,
      name: trim.name ?? TRIM_KIND_LABELS[trim.kind],
      panelName: pattern.panels[trim.panelId]?.name ?? '—',
      kindLabel: TRIM_KIND_LABELS[trim.kind],
      sizeMm: trim.sizeMm,
      positionCm: `${trim.pos.x.toFixed(1)}, ${trim.pos.y.toFixed(1)}`,
      color: trim.color,
      quantity: trim.qty,
      unitPrice: typeof trim.unitPrice === 'number' && Number.isFinite(trim.unitPrice) ? trim.unitPrice : null,
    }));

  return {
    projectName: project.meta.name,
    date: options.date ?? new Date().toISOString().slice(0, 10),
    sizes,
    baseSizeLabel: baseSize?.label ?? null,
    activeSizeLabel: activeSize?.label ?? null,
    panels,
    stylePanels,
    operations,
    fabrics,
    seams,
    prints,
    topstitches,
    trims,
    bom: buildBom(project),
    marker: markerSummary(pattern, options),
    measurements,
    pom,
  };
}

