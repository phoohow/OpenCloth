import type { Fabric, Measurement, Pattern, Project, Seam, SeamType, SizeDef, Vec2 } from '../core/model/types';
import { EDGE_SEMANTIC_LABELS, SEAM_TYPE_LABELS, TRIM_KIND_LABELS } from '../core/model/defaults';
import { samplePanelOutline } from '../pattern/panel/panelBuilder';
import { edgeIntervalLength, measurementValue } from '../pattern/geom/edgeSample';
import { orderedSizes } from '../pattern/grading/grading';
import { buildMarkerLayout } from '../pattern/marker/markerLayout';
import { buildMarkerReport } from '../pattern/marker/markerReport';
import { bomQuantityText, bomTotals, buildBom, panelAreas, type BomRow } from '../pattern/bom';
import { assemblePdf, CM_PT, pdfNum, rectPath, textOps, textWidthPt } from './pdf/pdfDocument';

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
  color: string;
  quantity: number;
  unitPrice: number | null;
}

/** Everything the tech pack prints, computed from the live project. */
export interface TechPackData {
  projectName: string;
  date: string;
  sizes: TechPackSizeRow[];
  baseSizeLabel: string | null;
  activeSizeLabel: string | null;
  panels: TechPackPanelRow[];
  fabrics: TechPackFabricRow[];
  seams: TechPackSeamRow[];
  prints: TechPackPrintRow[];
  topstitches: TechPackTopstitchRow[];
  trims: TechPackTrimRow[];
  bom: BomRow[];
  marker: TechPackMarkerSummary;
  measurements: TechPackMeasurementRow[];
}

const MEASUREMENT_KIND_LABELS: Record<Measurement['kind'], string> = {
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
    fabrics,
    seams,
    prints,
    topstitches,
    trims,
    bom: buildBom(project),
    marker: markerSummary(pattern, options),
    measurements,
  };
}

const PAGE_WIDTH_PT = 595.28;
const PAGE_HEIGHT_PT = 841.89;
const MARGIN_PT = 1.5 * CM_PT;
const CONTENT_W = PAGE_WIDTH_PT - MARGIN_PT * 2;
const BODY_SIZE = 8.5;
const HEADING_SIZE = 10.5;
const TITLE_SIZE = 16;

interface Sheet {
  pages: string[];
  ops: string[];
  /** Current baseline, in page points. */
  y: number;
}

interface Column {
  title: string;
  width: number;
  align?: 'left' | 'right';
}

/** Truncates a run to a column width, marking the cut with '..'. */
function fitText(text: string, maxWidth: number, size: number): string {
  if (textWidthPt(text, size) <= maxWidth) return text;
  let out = '';
  for (const ch of text) {
    if (textWidthPt(out + ch, size) + textWidthPt('..', size) > maxWidth) break;
    out += ch;
  }
  return out ? `${out}..` : '';
}

/** One text run with its fill grey; resets the fill to black afterwards. */
function textRun(sheet: Sheet, x: number, text: string, size: number, grey = 0): void {
  if (grey > 0) sheet.ops.push(`${pdfNum(grey)} g\n`);
  sheet.ops.push(textOps({ x, y: sheet.y }, size, text, 0, 'cjk'));
  if (grey > 0) sheet.ops.push('0 g\n');
}

/** Starts a new page, closing the current one with its footer. */
function breakPage(sheet: Sheet, projectName: string): void {
  if (sheet.ops.length > 0) {
    const footer = `工程名：${projectName} - 工艺单 - 第 ${sheet.pages.length + 1} 页`;
    sheet.ops.push(`0.5 g\n${textOps({ x: MARGIN_PT, y: MARGIN_PT * 0.55 }, 7.5, footer, 0, 'cjk')}0 g\n`);
    sheet.pages.push(sheet.ops.join(''));
  }
  sheet.ops = [];
  sheet.y = PAGE_HEIGHT_PT - MARGIN_PT;
}

/** Reserves vertical room, breaking the page when the block does not fit. */
function ensure(sheet: Sheet, height: number, projectName: string): void {
  if (sheet.y - height >= MARGIN_PT) return;
  breakPage(sheet, projectName);
}

/** Emits one line of body text and advances the baseline. */
function line(
  sheet: Sheet, text: string, projectName: string,
  opts: { size?: number; grey?: number; gap?: number; indent?: number } = {},
): void {
  const size = opts.size ?? BODY_SIZE;
  ensure(sheet, size * 1.6, projectName);
  textRun(sheet, MARGIN_PT + (opts.indent ?? 0), text, size, opts.grey ?? 0);
  sheet.y -= size * (opts.gap ?? 1.7);
}

/** Section heading with a light rule under the text. */
function heading(sheet: Sheet, text: string, projectName: string): void {
  ensure(sheet, HEADING_SIZE * 3.2, projectName);
  sheet.y -= 6;
  textRun(sheet, MARGIN_PT, text, HEADING_SIZE);
  sheet.y -= 4;
  sheet.ops.push(`0.75 g\n${rectPath(MARGIN_PT, sheet.y, CONTENT_W, 0.4)}f\n0 g\n`);
  sheet.y -= HEADING_SIZE * 1.2;
}

/** Draws one table row at the current baseline. */
function tableRow(sheet: Sheet, columns: Column[], cells: string[], size: number): void {
  let x = MARGIN_PT;
  cells.forEach((cell, i) => {
    const column = columns[i];
    if (!column) return;
    const text = fitText(cell, column.width - 6, size);
    const offset = column.align === 'right' ? column.width - 6 - textWidthPt(text, size) : 0;
    textRun(sheet, x + Math.max(0, offset), text, size);
    x += column.width;
  });
}

/** Table with a repeating header; `cells` are already formatted. */
function table(sheet: Sheet, columns: Column[], rows: string[][], projectName: string): void {
  const rowH = BODY_SIZE * 1.9;
  const drawHeader = (): void => {
    tableRow(sheet, columns, columns.map(column => column.title), BODY_SIZE);
    sheet.ops.push(`0.8 g\n${rectPath(MARGIN_PT, sheet.y - 3, CONTENT_W, 0.35)}f\n0 g\n`);
    sheet.y -= rowH * 0.7;
  };
  ensure(sheet, rowH * 2.4, projectName);
  drawHeader();
  for (const row of rows) {
    if (sheet.y - rowH < MARGIN_PT) {
      breakPage(sheet, projectName);
      drawHeader();
    }
    tableRow(sheet, columns, row, BODY_SIZE);
    sheet.y -= rowH;
  }
}

/** Formats the seam allowance for one seam row. */
function allowanceText(row: TechPackSeamRow): string {
  const a = row.allowanceA.toFixed(1);
  const b = row.allowanceB.toFixed(1);
  return a === b ? a : `${a} / ${b}`;
}

/** Formats the gather column. */
function gatherText(row: TechPackSeamRow): string {
  if (!row.gather) return '否';
  return row.gatherRatio !== null ? `是（比例 ${row.gatherRatio.toFixed(2)}）` : '是';
}

/** Lays out the tech pack pages; data formatting happens in the table row builders below. */
function renderTechPack(data: TechPackData): Uint8Array {
  const sheet: Sheet = { pages: [], ops: [], y: PAGE_HEIGHT_PT - MARGIN_PT };
  const name = data.projectName;

  textRun(sheet, MARGIN_PT, '工艺单', TITLE_SIZE);
  sheet.y -= TITLE_SIZE * 1.6;
  line(sheet, `工程名：${data.projectName}`, name, { size: 10 });
  line(sheet, `日期：${data.date}`, name, { size: 9, grey: 0.25 });
  const chart = data.baseSizeLabel ? `基码 ${data.baseSizeLabel}` : '未标基码';
  const sizeLabels = data.sizes.length > 0 ? data.sizes.map(size => size.label).join(' / ') : '未定义尺码表';
  const active = data.activeSizeLabel ? `　当前码 ${data.activeSizeLabel}` : '';
  line(sheet, `尺码表：${sizeLabels}（${chart}）${active}`, name, { size: 9 });
  sheet.y -= 6;

  heading(sheet, '版片', name);
  if (data.panels.length === 0) {
    line(sheet, '无可见版片', name, { grey: 0.35 });
  } else {
    const columns: Column[] = [
      { title: '版片', width: 180 },
      { title: '数量', width: 50, align: 'right' },
      { title: '净面积(m2)', width: 140, align: 'right' },
      { title: '毛面积(m2)', width: 140, align: 'right' },
    ];
    table(sheet, columns, data.panels.map(panel => [
      panel.name, String(panel.quantity), panel.netAreaM2.toFixed(4), panel.grossAreaM2.toFixed(4),
    ]), name);
  }

  heading(sheet, '材质', name);
  if (data.fabrics.length === 0) {
    line(sheet, '未定义材质', name, { grey: 0.35 });
  } else {
    const columns: Column[] = [
      { title: '材质', width: 96 },
      { title: '基础色', width: 62 },
      { title: '面密度(g/m2)', width: 76, align: 'right' },
      { title: '拉伸', width: 52, align: 'right' },
      { title: '弯曲', width: 52, align: 'right' },
      { title: '剪切', width: 52, align: 'right' },
      { title: '阻尼', width: 52, align: 'right' },
      { title: '折痕', width: 68, align: 'right' },
    ];
    table(sheet, columns, data.fabrics.map(fabric => [
      fabric.name, fabric.baseColor,
      String(fabric.massPerArea), fabric.stretchStiffness.toFixed(2), fabric.bendingStiffness.toFixed(2),
      fabric.shearStiffness.toFixed(2), fabric.damping.toFixed(3),
      fabric.creaseStiffness === null ? '—' : fabric.creaseStiffness.toFixed(2),
    ]), name);
  }

  heading(sheet, '缝合清单', name);
  if (data.seams.length === 0) {
    line(sheet, '无缝合', name, { grey: 0.35 });
  } else {
    const columns: Column[] = [
      { title: '甲片 / 边', width: 150 },
      { title: '乙片 / 边', width: 150 },
      { title: '缝型', width: 58 },
      { title: '缝份(cm)', width: 70, align: 'right' },
      { title: '缩缝', width: 82 },
    ];
    table(sheet, columns, data.seams.map(seam => [
      `${seam.panelA} / ${seam.edgeA} ${seam.intervalA}`,
      `${seam.panelB} / ${seam.edgeB} ${seam.intervalB}`,
      seam.typeLabel,
      allowanceText(seam),
      gatherText(seam),
    ]), name);
  }

  heading(sheet, '印花', name);
  if (data.prints.length === 0) {
    line(sheet, '无印花', name, { grey: 0.35 });
  } else {
    const columns: Column[] = [
      { title: '版片', width: 100 },
      { title: '印花', width: 130 },
      { title: '尺寸(cm)', width: 100, align: 'right' },
      { title: '角度', width: 60, align: 'right' },
      { title: '平铺', width: 60, align: 'right' },
      { title: '不透明度', width: 60, align: 'right' },
    ];
    table(sheet, columns, data.prints.map(print => [
      print.panelName,
      print.name,
      `${print.widthCm.toFixed(1)} × ${print.heightCm.toFixed(1)}`,
      `${print.angleDeg.toFixed(1)}°`,
      `${print.repeat.x} × ${print.repeat.y}`,
      `${Math.round(print.opacity * 100)}%`,
    ]), name);
  }

  heading(sheet, '明线', name);
  if (data.topstitches.length === 0) {
    line(sheet, '无明线', name, { grey: 0.35 });
  } else {
    const columns: Column[] = [
      { title: '版片', width: 100 },
      { title: '边', width: 130 },
      { title: '偏移(mm)', width: 80, align: 'right' },
      { title: '行距(mm)', width: 70, align: 'right' },
      { title: '行数', width: 50, align: 'right' },
      { title: '长度(cm)', width: 80, align: 'right' },
    ];
    table(sheet, columns, data.topstitches.map(stitch => [
      stitch.panelName, stitch.edge,
      stitch.offsetMm.toFixed(1), stitch.spacingMm.toFixed(1), String(stitch.rows), stitch.lengthCm.toFixed(1),
    ]), name);
  }

  heading(sheet, '辅料', name);
  if (data.trims.length === 0) {
    line(sheet, '无辅料', name, { grey: 0.35 });
  } else {
    const columns: Column[] = [
      { title: '版片', width: 100 },
      { title: '名称', width: 110 },
      { title: '类型', width: 70 },
      { title: '直径(mm)', width: 70, align: 'right' },
      { title: '数量', width: 50, align: 'right' },
      { title: '单价', width: 60, align: 'right' },
      { title: '颜色', width: 50 },
    ];
    table(sheet, columns, data.trims.map(trim => [
      trim.panelName, trim.name, trim.kindLabel, trim.sizeMm.toFixed(1), String(trim.quantity),
      trim.unitPrice === null ? '—' : trim.unitPrice.toFixed(2), trim.color,
    ]), name);
  }

  heading(sheet, '物料清单', name);
  if (data.bom.length === 0) {
    line(sheet, '无物料', name, { grey: 0.35 });
  } else {
    const columns: Column[] = [
      { title: '类别', width: 50 },
      { title: '名称', width: 110 },
      { title: '规格', width: 145 },
      { title: '单位', width: 40 },
      { title: '数量', width: 55, align: 'right' },
      { title: '单价', width: 50, align: 'right' },
      { title: '金额', width: 60, align: 'right' },
    ];
    table(sheet, columns, data.bom.map(row => [
      row.category, row.name, row.spec, row.unit, bomQuantityText(row.quantity),
      row.unitPrice === null ? '—' : row.unitPrice.toFixed(2),
      row.amount === null ? '—' : row.amount.toFixed(2),
    ]), name);
    const totals = bomTotals(data.bom);
    line(sheet, totals.pricedRows === 0
      ? '合计：未填写单价'
      : `合计金额：${totals.amount.toFixed(2)}（${totals.pricedRows} 项已定价）`, name, { size: 7.5, grey: 0.35, gap: 1.4 });
  }

  heading(sheet, '排料摘要', name);
  if (!data.marker.laidOut) {
    line(sheet, data.marker.note ?? '未排料', name, { grey: 0.35 });
  } else {
    const marker = data.marker;
    const rows: string[][] = [
      ['幅宽(cm)', marker.fabricWidthCm.toFixed(0)],
      ['版片数', String(marker.pieceCount)],
      ['用料长度(m)', marker.usedLengthM.toFixed(2)],
      ['面料面积(m2)', marker.fabricAreaM2.toFixed(2)],
      ['利用率', `${(marker.utilization * 100).toFixed(1)}%`],
    ];
    if (marker.cost !== null) rows.push([`面料成本 (${marker.currency})`, marker.cost.toFixed(2)]);
    table(sheet, [{ title: '项目', width: 220 }, { title: '数值', width: 290, align: 'right' }], rows, name);
    line(sheet, `缩率 ${marker.shrinkPercent}%　片间距 ${marker.gapCm} cm　允许旋转 90°`, name, { size: 7.5, grey: 0.4, gap: 1.4 });
  }

  heading(sheet, '版片测量', name);
  if (data.measurements.length === 0) {
    line(sheet, '无可计算的尺寸标注', name, { grey: 0.35 });
  } else {
    const columns: Column[] = [
      { title: '测量', width: 190 },
      { title: '版片', width: 120 },
      { title: '类型', width: 80 },
      { title: '数值', width: 120, align: 'right' },
    ];
    table(sheet, columns, data.measurements.map(row => [
      row.name,
      row.panelName,
      MEASUREMENT_KIND_LABELS[row.kind],
      row.unit === 'deg' ? `${row.value.toFixed(1)}°` : `${row.value.toFixed(2)} cm`,
    ]), name);
  }

  breakPage(sheet, name);
  return assemblePdf(sheet.pages, PAGE_WIDTH_PT, PAGE_HEIGHT_PT);
}

/** Renders the live project as a multi-page A4 tech pack PDF. */
export function buildTechPackPdf(project: Project, options: TechPackOptions = {}): Uint8Array {
  return renderTechPack(buildTechPackData(project, options));
}
