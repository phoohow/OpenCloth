import type { Panel, Pattern, Project } from '../core/model/types';
import { TRIM_KIND_LABELS } from '../core/model/defaults';
import { panelOutlineWithAllowance, sampleOutline, samplePanelOutline } from './panel/panelBuilder';
import { polygonArea } from './marker/markerReport';
import { edgeIntervalLength } from './geom/edgeSample';

/** Section of the bill of materials a row belongs to. */
export type BomCategory = '面料' | '印花' | '明线' | '辅料';

/** One bill-of-materials row; amounts are only filled when a unit price is known. */
export interface BomRow {
  category: BomCategory;
  name: string;
  /** Size, colour or other short production note. */
  spec: string;
  unit: 'm²' | '张' | '米' | '个';
  quantity: number;
  unitPrice: number | null;
  amount: number | null;
  /** Panel the row belongs to, or an empty string for project-wide rows. */
  note: string;
}

/** Price total over the priced rows. */
export interface BomTotals {
  amount: number;
  pricedRows: number;
}

/** Area of a polyline in square metres. */
function outlineAreaM2(points: { x: number; y: number }[]): number {
  return points.length >= 3 ? polygonArea(points) / 10_000 : 0;
}

/** Net (seam line) and gross (cut line) area of one panel, holes removed. */
export function panelAreas(pattern: Pattern, panel: Panel): { netAreaM2: number; grossAreaM2: number } {
  const holes = (panel.holes ?? [])
    .map(loop => sampleOutline(pattern, loop))
    .filter(loop => loop.length >= 3);
  const holeArea = holes.reduce((sum, loop) => sum + outlineAreaM2(loop), 0);
  const net = outlineAreaM2(samplePanelOutline(pattern, panel)) - holeArea;
  const gross = outlineAreaM2(panelOutlineWithAllowance(pattern, panel)) - holeArea;
  return { netAreaM2: Math.max(0, net), grossAreaM2: Math.max(0, gross) };
}

/** Rounds to two decimals, the precision quantities and amounts carry. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Centimetre measurement without trailing zeros. */
function cm(value: number): string {
  return String(Math.round(value * 10) / 10);
}

/** Millimetre measurement without trailing zeros. */
function mm(value: number): string {
  return String(Math.round(value * 10) / 10);
}

/** Quantity as printed: whole numbers stay whole, fractional areas and lengths take two decimals. */
export function bomQuantityText(quantity: number): string {
  return Number.isInteger(quantity) ? String(quantity) : quantity.toFixed(2);
}

/**
 * Collates the production bill of materials from the visible panels and their prints,
 * topstitches and trims. Hidden panels and hidden records are left out.
 */
export function buildBom(project: Project): BomRow[] {
  const pattern = project.pattern;
  const rows: BomRow[] = [];
  const panels = Object.values(pattern.panels).filter(panel => panel.visible !== false);

  // Fabric: net panel area grouped by the fabric each panel wears.
  const areas = new Map<string, number>();
  for (const panel of panels) {
    areas.set(panel.fabricId, (areas.get(panel.fabricId) ?? 0) + panelAreas(pattern, panel).netAreaM2);
  }
  for (const [fabricId, areaM2] of areas) {
    const fabric = project.fabrics[fabricId];
    rows.push({
      category: '面料',
      name: fabric?.name ?? '未指定面料',
      spec: fabric ? `面密度 ${fabric.physics.massPerArea} g/m²` : '未指定',
      unit: 'm²',
      quantity: round2(areaM2),
      unitPrice: null,
      amount: null,
      note: '',
    });
  }

  for (const print of Object.values(pattern.prints ?? {})) {
    const panel = pattern.panels[print.panelId];
    if (!panel || panel.visible === false || print.visible === false) continue;
    const repeats = print.repeat.x * print.repeat.y;
    rows.push({
      category: '印花',
      name: print.name ?? print.imageName ?? '印花',
      spec: `${cm(print.widthCm)} × ${cm(print.heightCm)} cm${repeats > 1 ? `，平铺 ${print.repeat.x}×${print.repeat.y}` : ''}`,
      unit: '张',
      quantity: Math.round(repeats),
      unitPrice: null,
      amount: null,
      note: panel.name,
    });
  }

  for (const stitch of Object.values(pattern.topstitches ?? {})) {
    const panel = pattern.panels[stitch.panelId];
    if (!panel || panel.visible === false || stitch.visible === false) continue;
    const lengthCm = pattern.edges[stitch.edgeId]
      ? edgeIntervalLength(pattern, stitch.edgeId, stitch.t0, stitch.t1) * stitch.rows
      : 0;
    if (lengthCm <= 0) continue;
    rows.push({
      category: '明线',
      name: stitch.name ?? '明线',
      spec: `偏移 ${mm(stitch.offsetMm)} mm，${stitch.rows} 行，行距 ${mm(stitch.spacingMm)} mm`,
      unit: '米',
      quantity: round2(lengthCm / 100),
      unitPrice: null,
      amount: null,
      note: panel.name,
    });
  }

  for (const trim of Object.values(pattern.trims ?? {})) {
    const panel = pattern.panels[trim.panelId];
    if (!panel || panel.visible === false || trim.visible === false) continue;
    const price = typeof trim.unitPrice === 'number' && Number.isFinite(trim.unitPrice) ? trim.unitPrice : null;
    rows.push({
      category: '辅料',
      name: trim.name ?? TRIM_KIND_LABELS[trim.kind],
      spec: `${TRIM_KIND_LABELS[trim.kind]}，直径 ${mm(trim.sizeMm)} mm`,
      unit: '个',
      quantity: trim.qty,
      unitPrice: price,
      amount: price === null ? null : round2(price * trim.qty),
      note: panel.name,
    });
  }

  return rows;
}

/** Sums the priced rows; unpriced rows leave the total untouched. */
export function bomTotals(rows: BomRow[]): BomTotals {
  let amount = 0;
  let pricedRows = 0;
  for (const row of rows) {
    if (row.amount === null) continue;
    amount += row.amount;
    pricedRows += 1;
  }
  return { amount: round2(amount), pricedRows };
}

/** Fixed CSV column order, shared by the export and the preview. */
const CSV_HEADERS = ['类别', '名称', '规格', '单位', '数量', '单价', '金额', '备注'];

/** Quotes a cell when it holds a comma, a quote or a line break. */
function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Serialises the rows as a UTF-8 CSV with a BOM so Excel reads the Chinese column names. */
export function bomCsv(rows: BomRow[]): string {
  const lines = [CSV_HEADERS.join(',')];
  for (const row of rows) {
    lines.push([
      row.category,
      row.name,
      row.spec,
      row.unit,
      bomQuantityText(row.quantity),
      row.unitPrice === null ? '' : row.unitPrice.toFixed(2),
      row.amount === null ? '' : row.amount.toFixed(2),
      row.note,
    ].map(csvCell).join(','));
  }
  return '\ufeff' + lines.join('\r\n');
}
