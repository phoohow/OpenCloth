import type { Project, Vec2 } from '@/model/types';
import {
  assemblePdf, CM_PT, closedPath, openPath, pdfNum, rectPath, textOps, textWidthPt,
} from '@/io/pdf/pdfDocument';
import {
  MEASUREMENT_KIND_LABELS, buildTechPackData, type TechPackData, type TechPackOperationRow,
  type TechPackOptions, type TechPackSeamRow, type TechPackStylePanel,
} from '@/io/exporters/techPackData';
import { bomQuantityText, bomTotals } from '@/pattern';

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

/** Page-point rectangle a drawing is fitted into. */
interface DrawBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Axis-aligned bounds of a point set; null when it is empty. */
function pointBounds(points: Vec2[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (points.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/** Maps pattern coordinates into a page-point box, keeping the aspect ratio and centring the result. */
function boxMapper(points: Vec2[], box: DrawBox, pad = 5): (p: Vec2) => Vec2 {
  const bounds = pointBounds(points);
  if (!bounds) return () => ({ x: box.x + box.w / 2, y: box.y + box.h / 2 });
  const width = Math.max(bounds.maxX - bounds.minX, 1e-6);
  const height = Math.max(bounds.maxY - bounds.minY, 1e-6);
  const scale = Math.min((box.w - pad * 2) / width, (box.h - pad * 2) / height);
  const ox = box.x + (box.w - width * scale) / 2;
  const oy = box.y + (box.h - height * scale) / 2;
  return p => ({ x: ox + (p.x - bounds.minX) * scale, y: oy + (p.y - bounds.minY) * scale });
}

/** Grey closed outline with the holes punched inside it. */
function drawOutline(sheet: Sheet, outline: Vec2[], holes: Vec2[][], map: (p: Vec2) => Vec2): void {
  if (outline.length < 3) return;
  sheet.ops.push('0.25 G\n' + closedPath(outline.map(map)));
  for (const hole of holes) {
    if (hole.length >= 3) sheet.ops.push(closedPath(hole.map(map)));
  }
  sheet.ops.push('0 G\n');
}

/** Dashed grain line, drawn in a lighter grey. */
function drawGrain(sheet: Sheet, grain: Vec2[], map: (p: Vec2) => Vec2): void {
  if (grain.length < 2) return;
  sheet.ops.push('0.55 G\n[2 2] 0 d\n' + openPath(grain.map(map)) + '[] 0 d\n0 G\n');
}

/** Style drawing: every visible panel outline, its holes and grain line, labelled with its name. */
function drawStyleSection(sheet: Sheet, data: TechPackData): void {
  heading(sheet, '款式图', data.projectName);
  if (data.stylePanels.length === 0) {
    line(sheet, '无可见版片', data.projectName, { grey: 0.35 });
    return;
  }
  const columns = 3;
  const cellW = CONTENT_W / columns;
  const cellH = 132;
  data.stylePanels.forEach((panel, index) => {
    const column = index % columns;
    if (column === 0) ensure(sheet, cellH + 18, data.projectName);
    const box: DrawBox = {
      x: MARGIN_PT + column * cellW,
      y: sheet.y - cellH,
      w: cellW,
      h: cellH - 14,
    };
    const all = [...panel.outline, ...panel.holes.flat(), ...(panel.grain ?? [])];
    const map = boxMapper(all, box);
    drawOutline(sheet, panel.outline, panel.holes, map);
    if (panel.grain) drawGrain(sheet, panel.grain, map);
    sheet.ops.push(textOps({ x: box.x + 3, y: box.y + 5 }, 7.5, panel.name, 0, 'cjk'));
    if (column === columns - 1 || index === data.stylePanels.length - 1) sheet.y -= cellH + 10;
  });
}

/** One operation card: both pieces side by side, the seamed intervals in red and an arrow between them. */
function drawOperationCard(
  sheet: Sheet, data: TechPackData, op: TechPackOperationRow, box: DrawBox,
): void {
  const byId = new Map(data.stylePanels.map(panel => [panel.id, panel]));
  const panels = [byId.get(op.panelAId), byId.get(op.panelBId)].filter(
    (panel): panel is TechPackStylePanel => panel !== undefined,
  );
  const all = [...panels.flatMap(panel => panel.outline), ...op.edgeA, ...op.edgeB];
  if (all.length === 0) return;
  const map = boxMapper(all, { x: box.x, y: box.y + 14, w: box.w, h: box.h - 30 });
  for (const panel of panels) drawOutline(sheet, panel.outline, panel.holes, map);

  sheet.ops.push('1 0 0 RG\n');
  for (const edge of [op.edgeA, op.edgeB]) {
    if (edge.length >= 2) sheet.ops.push(openPath(edge.map(map)));
  }
  const midA = op.edgeA[Math.floor(op.edgeA.length / 2)];
  const midB = op.edgeB[Math.floor(op.edgeB.length / 2)];
  if (midA && midB) sheet.ops.push(openPath([map(midA), map(midB)]));
  sheet.ops.push('0 G\n');

  const title = `工序 ${op.step} · ${op.typeLabel} · 缝份 ${op.allowanceCm.toFixed(1)} cm${op.gather ? ' · 缩缝' : ''}`;
  sheet.ops.push(textOps({ x: box.x + 3, y: box.y + box.h - 2 }, 7.5, title, 0, 'cjk'));
  sheet.ops.push(textOps({ x: box.x + 3, y: box.y + 4 }, 7, `${op.panelAName} → ${op.panelBName}`, 0, 'cjk'));
}

/** Operation drawing: numbered sewing steps, two cards per row. */
function drawOperationSection(sheet: Sheet, data: TechPackData): void {
  heading(sheet, '工序图', data.projectName);
  if (data.operations.length === 0) {
    line(sheet, '无缝合工序', data.projectName, { grey: 0.35 });
    return;
  }
  const columns = 2;
  const cellW = CONTENT_W / columns;
  const cellH = 152;
  data.operations.forEach((op, index) => {
    const column = index % columns;
    if (column === 0) ensure(sheet, cellH + 12, data.projectName);
    drawOperationCard(sheet, data, op, {
      x: MARGIN_PT + column * cellW,
      y: sheet.y - cellH,
      w: cellW,
      h: cellH - 8,
    });
    if (column === columns - 1 || index === data.operations.length - 1) sheet.y -= cellH;
  });
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

  drawStyleSection(sheet, data);
  drawOperationSection(sheet, data);

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
    const limitColumns: Column[] = [
      { title: '材质', width: 120 },
      { title: '接触摩擦', width: 90, align: 'right' },
      { title: '拉伸上限(%)', width: 130, align: 'right' },
      { title: '压缩上限(%)', width: 130, align: 'right' },
    ];
    table(sheet, limitColumns, data.fabrics.map(fabric => [
      fabric.name, fabric.contactFriction.toFixed(2),
      (fabric.stretchLimit * 100).toFixed(1), (fabric.compressionLimit * 100).toFixed(1),
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
      { title: '版片', width: 90 },
      { title: '边', width: 100 },
      { title: '区间', width: 80 },
      { title: '偏移(mm)', width: 65, align: 'right' },
      { title: '行距(mm)', width: 55, align: 'right' },
      { title: '行数', width: 35, align: 'right' },
      { title: '长度(cm)', width: 60, align: 'right' },
    ];
    table(sheet, columns, data.topstitches.map(stitch => [
      stitch.panelName, stitch.edge, stitch.interval,
      stitch.offsetMm.toFixed(1), stitch.spacingMm.toFixed(1), String(stitch.rows), stitch.lengthCm.toFixed(1),
    ]), name);
  }

  heading(sheet, '辅料', name);
  if (data.trims.length === 0) {
    line(sheet, '无辅料', name, { grey: 0.35 });
  } else {
    const columns: Column[] = [
      { title: '版片', width: 80 },
      { title: '名称', width: 90 },
      { title: '类型', width: 55 },
      { title: '直径(mm)', width: 55, align: 'right' },
      { title: '位置(cm)', width: 80, align: 'right' },
      { title: '数量', width: 40, align: 'right' },
      { title: '单价', width: 55, align: 'right' },
      { title: '颜色', width: 45 },
    ];
    table(sheet, columns, data.trims.map(trim => [
      trim.panelName, trim.name, trim.kindLabel, trim.sizeMm.toFixed(1), trim.positionCm,
      String(trim.quantity), trim.unitPrice === null ? '—' : trim.unitPrice.toFixed(2), trim.color,
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
    line(sheet, `缩率 ${marker.shrinkPercent}%　片间距 ${marker.gapCm} cm　旋转 0° / 90°`, name, { size: 7.5, grey: 0.4, gap: 1.4 });
  }

  if (data.pom.length > 0) {
    heading(sheet, 'POM 尺寸表', name);
    const columns: Column[] = [
      { title: '测量点', width: 120 },
      { title: '部位', width: 70 },
      { title: '尺码', width: 50 },
      { title: '数值(cm)', width: 80, align: 'right' },
      { title: '差值(cm)', width: 80, align: 'right' },
      { title: '公式', width: 100 },
    ];
    table(sheet, columns, data.pom.map(row => [
      row.name,
      row.part,
      row.sizeLabel,
      row.valueCm === null ? '—' : row.valueCm.toFixed(2),
      row.diffCm === null ? '—' : row.diffCm.toFixed(2),
      row.formula ?? '',
    ]), name);
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
