import type { Panel, Pattern, Vec2 } from '@/model/types';

import { computeBBox } from '@/base/geom';
import { normalize2, perp2, sub2 } from '@/base/math';
import { assemblePdf, circlePath, closedPath, CM_PT, clamp, openPath, pdfNum, rectPath, textOps } from '@/base/pdf';
import { pointAtT, sampleEdge } from '@/pattern/geom';
import { panelGrainLine, panelOutlineWithAllowance, sampleOutline, samplePanelOutline } from '@/pattern/panel';

const PAGE_SIZES: Record<PdfPaperSize, { width: number; height: number }> = {
  A4: { width: 595.28, height: 841.89 },
  A3: { width: 841.89, height: 1190.55 },
};

const GAP_CM = 1;

const FONT_SIZE = 9;

const MARK_CM = 0.4;

export type PdfPaperSize = 'A4' | 'A3';

export type PdfOutputMode = 'single' | 'tile';

export interface PdfPatternOptions {
  scale?: number;
  includeSeamAllowance?: boolean;
  page?: PdfPaperSize;
  marginCm?: number;
  mode?: PdfOutputMode;
  overlapCm?: number;
}

export interface PdfPatternItem {
  panelId: string;
  index: number;
  originPt: Vec2;
  sizePt: Vec2;
  boundsCm: { min: Vec2; max: Vec2 };
}

export interface PdfPatternLayout {
  page: PdfPaperSize;
  pageWidthPt: number;
  pageHeightPt: number;
  marginPt: number;
  scalePtPerCm: number;
  fit: number;
  items: PdfPatternItem[];
}

export interface PdfTilingOptions {
  page?: PdfPaperSize;
  marginCm?: number;
  overlapCm?: number;
  includeSeamAllowance?: boolean;
}

export interface PdfTile {
  index: number;
  row: number;
  col: number;
  clipCm: { min: Vec2; max: Vec2 };
  offsetPt: Vec2;
  scalePtPerCm: number;
}

export interface PdfTiling {
  page: PdfPaperSize;
  pageWidthPt: number;
  pageHeightPt: number;
  marginPt: number;
  overlapCm: number;
  tileCm: Vec2;
  cols: number;
  rows: number;
  pages: PdfTile[];
  boundsCm: { min: Vec2; max: Vec2 } | null;
}

type PointMap = (panelId: string, p: Vec2) => Vec2;

function pageGeometry(options: PdfPatternOptions): { page: PdfPaperSize; width: number; height: number; marginPt: number } {
  const page = options.page ?? 'A4';
  const size = PAGE_SIZES[page];
  const marginPt = clamp((options.marginCm ?? 1) * CM_PT, 0, Math.min(size.width, size.height) / 2 - 1);
  return { page, width: size.width, height: size.height, marginPt };
}

function hasAllowance(pattern: Pattern, panelId: string): boolean {
  const panel = pattern.panels[panelId];
  if (!panel) return false;
  return panel.seamAllowanceCm > 0
    || panel.outlineEdgeIds.some(id => (pattern.edges[id]?.seamAllowanceCm ?? 0) > 0);
}

function edgeFrame(pattern: Pattern, edgeId: string, t: number): { p: Vec2; nx: number; ny: number } | null {
  const pts = sampleEdge(pattern, edgeId);
  const p = pointAtT(pattern, edgeId, t);
  if (pts.length < 2 || !p) return null;
  const idx = Math.min(pts.length - 1, Math.max(0, Math.round(t * (pts.length - 1))));
  const prev = pts[Math.max(0, idx - 1)];
  const next = pts[Math.min(pts.length - 1, idx + 1)];
  const normal = perp2(normalize2(sub2(next, prev)));
  return { p, nx: normal.x, ny: normal.y };
}

function patternBounds(pattern: Pattern, includeSeamAllowance: boolean): { min: Vec2; max: Vec2 } | null {
  const points: Vec2[] = [];
  for (const panel of Object.values(pattern.panels)) {
    if (panel.visible === false) continue;
    const outline = samplePanelOutline(pattern, panel);
    if (outline.length < 3) continue;
    points.push(...outline);
    if (includeSeamAllowance && hasAllowance(pattern, panel.id)) {
      const cut = panelOutlineWithAllowance(pattern, panel);
      if (cut.length >= 3) points.push(...cut);
    }
  }

  return points.length > 0 ? computeBBox(points) : null;
}

export function planPatternPdfLayout(pattern: Pattern, options: PdfPatternOptions = {}): PdfPatternLayout {
  const { page, width, height, marginPt } = pageGeometry(options);
  const availW = Math.max(1, width - marginPt * 2);
  const availH = Math.max(1, height - marginPt * 2);
  const requested = options.scale && options.scale > 0 ? options.scale : 1;
  const basePtPerCm = CM_PT * requested;

  interface Entry { panelId: string; min: Vec2; max: Vec2; fx: number; fy: number; wPt: number; hPt: number; }
  const entries: Entry[] = [];
  for (const panel of Object.values(pattern.panels)) {
    if (panel.visible === false) continue;
    const outline = samplePanelOutline(pattern, panel);
    if (outline.length < 3) continue;
    const points = [...outline];
    if (options.includeSeamAllowance && hasAllowance(pattern, panel.id)) {
      const cut = panelOutlineWithAllowance(pattern, panel);
      if (cut.length >= 3) points.push(...cut);
    }

    const bbox = computeBBox(points);
    entries.push({
      panelId: panel.id,
      min: bbox.min, max: bbox.max,
      fx: 0, fy: 0,
      wPt: (bbox.max.x - bbox.min.x) * basePtPerCm,
      hPt: (bbox.max.y - bbox.min.y) * basePtPerCm,
    });
  }

  const gap = GAP_CM * basePtPerCm;
  let x = 0;
  let y = 0;
  let rowH = 0;
  let packedW = 0;
  let packedH = 0;
  for (const e of entries) {
    if (x > 0 && x + e.wPt > availW) {
      x = 0;
      y += rowH + gap;
      rowH = 0;
    }

    e.fx = x;
    e.fy = y;
    x += e.wPt + gap;
    packedW = Math.max(packedW, x - gap);
    rowH = Math.max(rowH, e.hPt);
    packedH = Math.max(packedH, y + e.hPt);
  }

  const fit = entries.length > 0
    ? Math.min(1, availW / Math.max(packedW, 1e-9), availH / Math.max(packedH, 1e-9))
    : 1;
  const scalePtPerCm = basePtPerCm * fit;
  const offX = (availW - packedW * fit) / 2;
  const offY = (availH - packedH * fit) / 2;
  const top = height - marginPt - offY;

  return {
    page,
    pageWidthPt: width,
    pageHeightPt: height,
    marginPt,
    scalePtPerCm,
    fit,
    items: entries.map((e, index) => ({
      panelId: e.panelId,
      index,
      originPt: { x: marginPt + offX + e.fx * fit, y: top - e.fy * fit },
      sizePt: { x: e.wPt * fit, y: e.hPt * fit },
      boundsCm: { min: e.min, max: e.max },
    })),
  };
}

export function planPdfTiling(pattern: Pattern, options: PdfTilingOptions = {}): PdfTiling {
  const { page, width, height, marginPt } = pageGeometry(options);
  const tileCm = { x: (width - marginPt * 2) / CM_PT, y: (height - marginPt * 2) / CM_PT };
  const overlapCm = clamp(options.overlapCm ?? 1, 0, Math.min(tileCm.x, tileCm.y) / 2);
  const boundsCm = patternBounds(pattern, options.includeSeamAllowance ?? false);
  const base: PdfTiling = {
    page, pageWidthPt: width, pageHeightPt: height, marginPt, overlapCm, tileCm,
    cols: 0, rows: 0, pages: [], boundsCm,
  };
  if (!boundsCm) return base;

  const spanX = boundsCm.max.x - boundsCm.min.x;
  const spanY = boundsCm.max.y - boundsCm.min.y;
  const stepX = Math.max(1e-6, tileCm.x - overlapCm);
  const stepY = Math.max(1e-6, tileCm.y - overlapCm);
  const cols = Math.max(1, 1 + Math.ceil((spanX - tileCm.x) / stepX - 1e-9));
  const rows = Math.max(1, 1 + Math.ceil((spanY - tileCm.y) / stepY - 1e-9));

  const pages: PdfTile[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const min = { x: boundsCm.min.x + col * stepX, y: boundsCm.max.y - row * stepY - tileCm.y };
      const max = { x: min.x + tileCm.x, y: min.y + tileCm.y };
      pages.push({
        index: pages.length,
        row,
        col,
        clipCm: { min, max },
        offsetPt: { x: marginPt - min.x * CM_PT, y: height - marginPt - max.y * CM_PT },
        scalePtPerCm: CM_PT,
      });
    }
  }

  return { ...base, cols, rows, pages };
}

function panelGeometryOps(pattern: Pattern, panel: Panel, map: PointMap, scale: number, includeSeamAllowance: boolean): string[] {
  const out: string[] = [];
  const outline = samplePanelOutline(pattern, panel);
  if (outline.length < 3) return out;
  const mapAll = (pts: Vec2[]): Vec2[] => pts.map(p => map(panel.id, p));

  if (includeSeamAllowance && hasAllowance(pattern, panel.id)) {
    const cut = panelOutlineWithAllowance(pattern, panel);
    if (cut.length >= 3) out.push(`0.3 w 0.55 G [] 0 d\n${closedPath(mapAll(cut))}`);
  }

  out.push(`0.5 w 0 G [] 0 d\n${closedPath(mapAll(outline))}`);

  for (const loop of panel.holes ?? []) {
    const hole = sampleOutline(pattern, loop);
    if (hole.length >= 3) out.push(`0.4 w 0 G [2 1.5] 0 d\n${closedPath(mapAll(hole))}`);
  }

  out.push('[] 0 d\n');

  for (const id of panel.internalLineIds) {
    const entry = pattern.internalLines[id];
    if (!entry || entry.points.length < 2) continue;
    const dash = entry.kind === 'fold' ? '[3 2] 0 d' : entry.kind === 'split' ? '[1.5 1] 0 d' : '[] 0 d';
    out.push(`0.4 w 0 G ${dash}\n${openPath(mapAll(entry.points))}[] 0 d\n`);
  }

  for (const id of panel.dartIds) {
    const dart = pattern.darts[id];
    const tip = dart && pattern.points[dart.tipId];
    if (!dart || !tip) continue;
    out.push('0.4 w 0 G [2 1.5] 0 d\n');
    for (const legId of [dart.edge1Id, dart.edge2Id]) {
      const edge = pattern.edges[legId];
      if (!edge) continue;
      for (const pointId of [edge.startPointId, edge.endPointId]) {
        const p = pattern.points[pointId];
        if (p) out.push(openPath(mapAll([p.pos, tip.pos])));
      }
    }

    out.push('[] 0 d\n', circlePath(map(panel.id, tip.pos), Math.max(1.2, 0.15 * scale)));
  }

  const grain = panelGrainLine(panel, outline);
  if (grain) {
    const a = grain[0]!;
    const b = grain[1]!;
    const span = Math.max(1e-6, Math.hypot(b.x - a.x, b.y - a.y));
    const ux = (b.x - a.x) / span;
    const uy = (b.y - a.y) / span;
    const head = 0.8;
    const half = 0.35;
    out.push('0.5 w 0 G [] 0 d\n');
    out.push(openPath(mapAll([a, b])));
    for (const [end, dx, dy] of [[a, ux, uy], [b, -ux, -uy]] as const) {
      const px = -dy;
      const py = dx;
      out.push(openPath(mapAll([end, { x: end.x + dx * head + px * half, y: end.y + dy * head + py * half }])));
      out.push(openPath(mapAll([end, { x: end.x + dx * head - px * half, y: end.y + dy * head - py * half }])));
    }
  }

  return out;
}

function geometryOps(pattern: Pattern, map: PointMap, scale: number, includeSeamAllowance: boolean): string[] {
  const out: string[] = [];
  const owner = new Map<string, string>();
  for (const panel of Object.values(pattern.panels)) {
    if (panel.visible === false) continue;
    for (const id of panel.outlineEdgeIds) if (!owner.has(id)) owner.set(id, panel.id);
    for (const loop of panel.holes ?? []) for (const id of loop) if (!owner.has(id)) owner.set(id, panel.id);
  }

  for (const panel of Object.values(pattern.panels)) {
    if (panel.visible === false) continue;
    out.push(...panelGeometryOps(pattern, panel, map, scale, includeSeamAllowance));
  }

  out.push('0.4 w 0 G [] 0 d\n');
  for (const notch of Object.values(pattern.notches)) {
    const panelId = owner.get(notch.edgeId);
    if (!panelId) continue;
    const frame = edgeFrame(pattern, notch.edgeId, notch.t);
    if (!frame) continue;
    if (notch.style === 'drill') {
      const rCm = Math.max(0.05, (notch.widthMm ?? 3) / 20);
      const c = { x: frame.p.x - frame.nx * (rCm + 0.3), y: frame.p.y - frame.ny * (rCm + 0.3) };
      out.push(circlePath(map(panelId, c), rCm * scale));
    } else {
      const inner = { x: frame.p.x - frame.nx * 0.6, y: frame.p.y - frame.ny * 0.6 };
      out.push(openPath([frame.p, inner].map(p => map(panelId, p))));
      if (notch.style === 't') {
        const px = -frame.ny;
        const py = frame.nx;
        out.push(openPath([
          { x: inner.x - px * 0.3, y: inner.y - py * 0.3 },
          { x: inner.x + px * 0.3, y: inner.y + py * 0.3 },
        ].map(p => map(panelId, p))));
      }
    }
  }

  return out;
}

function annotationOps(
  pattern: Pattern, map: PointMap, scale: number,
  clampTo?: (panelId: string) => { min: Vec2; max: Vec2 } | null,
): string[] {
  const out: string[] = [];
  for (const annotation of Object.values(pattern.annotations)) {
    const panel = pattern.panels[annotation.panelId];
    if (!panel || panel.visible === false) continue;
    const box = clampTo?.(annotation.panelId);
    if (clampTo && !box) continue;
    const raw = map(annotation.panelId, annotation.pos);
    const pos = box
      ? { x: clamp(raw.x, box.min.x, box.max.x), y: clamp(raw.y, box.min.y, box.max.y) }
      : raw;
    const sizePt = clamp(((annotation.sizeMm ?? 10) / 10) * CM_PT * scale, 5, 24);
    out.push(textOps(pos, sizePt, annotation.text, annotation.angleDeg ?? 0));
  }

  return out;
}

function buildContentStream(pattern: Pattern, layout: PdfPatternLayout, options: PdfPatternOptions): string {
  const itemByPanel = new Map(layout.items.map(i => [i.panelId, i] as const));
  const toPt = (item: PdfPatternItem, p: Vec2): Vec2 => ({
    x: item.originPt.x + (p.x - item.boundsCm.min.x) * layout.scalePtPerCm,
    y: item.originPt.y - (item.boundsCm.max.y - p.y) * layout.scalePtPerCm,
  });
  const map: PointMap = (panelId, p) => {
    const item = itemByPanel.get(panelId);
    return item ? toPt(item, p) : p;
  };

  const out: string[] = geometryOps(pattern, map, layout.scalePtPerCm, !!options.includeSeamAllowance);
  out.push(...annotationOps(pattern, map, layout.scalePtPerCm, panelId => {
    const item = itemByPanel.get(panelId);
    return item
      ? { min: { x: item.originPt.x, y: item.originPt.y - item.sizePt.y }, max: { x: item.originPt.x + item.sizePt.x, y: item.originPt.y } }
      : null;
  }));

  for (const item of layout.items) {
    const label = `P${item.index + 1}`;
    out.push(textOps({ x: item.originPt.x + item.sizePt.x / 2 - FONT_SIZE * 0.4, y: item.originPt.y - item.sizePt.y / 2 },
      FONT_SIZE, label));
  }

  const mul = layout.scalePtPerCm / CM_PT;
  const ratio = Math.abs(mul - 1) < 0.005 ? '1:1' : `1:${String(Math.round(100 / mul) / 100)}`;
  out.push(textOps({ x: layout.marginPt, y: layout.marginPt * 0.45 }, FONT_SIZE,
    `OpenCloth paper pattern  ${layout.page}  Scale ${ratio}`));

  return out.join('');
}

function tileMarks(tile: PdfTile, tiling: PdfTiling): string {
  const scale = tile.scalePtPerCm;
  const left = tile.offsetPt.x + tile.clipCm.min.x * scale;
  const bottom = tile.offsetPt.y + tile.clipCm.min.y * scale;
  const w = tiling.tileCm.x * scale;
  const h = tiling.tileCm.y * scale;
  const arm = MARK_CM * CM_PT;
  const out: string[] = [`0.25 w 0.65 G [] 0 d\n${rectPath(left, bottom, w, h)}S\n`];
  out.push('0.4 w 0 G [] 0 d\n');
  for (const [cx, cy] of [[left, bottom], [left + w, bottom], [left, bottom + h], [left + w, bottom + h]] as const) {
    out.push(openPath([{ x: cx - arm, y: cy }, { x: cx + arm, y: cy }]));
    out.push(openPath([{ x: cx, y: cy - arm }, { x: cx, y: cy + arm }]));
  }

  return out.join('');
}

function buildTileContent(pattern: Pattern, tiling: PdfTiling, tile: PdfTile, options: PdfPatternOptions): string {
  const scale = tile.scalePtPerCm;
  const left = tile.offsetPt.x + tile.clipCm.min.x * scale;
  const bottom = tile.offsetPt.y + tile.clipCm.min.y * scale;
  const map: PointMap = (_panelId, p) => ({ x: tile.offsetPt.x + p.x * scale, y: tile.offsetPt.y + p.y * scale });

  const out: string[] = ['q\n', rectPath(left, bottom, tiling.tileCm.x * scale, tiling.tileCm.y * scale), 'W n\n'];
  out.push(...geometryOps(pattern, map, scale, !!options.includeSeamAllowance));
  out.push(...annotationOps(pattern, map, scale), 'Q\n');
  out.push(tileMarks(tile, tiling));

  const header = `Page ${tile.index + 1} / ${tiling.pages.length}   Row ${tile.row + 1} / ${tiling.rows}`
    + `   Col ${tile.col + 1} / ${tiling.cols}`;
  const noteX = tiling.marginPt + MARK_CM * CM_PT + 4;
  out.push(textOps({ x: noteX, y: tiling.pageHeightPt - tiling.marginPt * 0.45 }, FONT_SIZE, header));
  const footer = `OpenCloth paper pattern  ${tiling.page}  1:1  tiled`
    + `  overlap ${pdfNum(tiling.overlapCm)} cm  align corner crosses`;
  out.push(textOps({ x: noteX, y: tiling.marginPt * 0.45 }, FONT_SIZE, footer));
  return out.join('');
}

function emptyPageContent(tiling: PdfTiling): string {
  return textOps({ x: tiling.marginPt, y: tiling.pageHeightPt / 2 }, 11, 'No visible panels');
}

export function buildPatternPdf(pattern: Pattern, options: PdfPatternOptions = {}): Uint8Array {
  if (options.mode === 'tile') {
    const tiling = planPdfTiling(pattern, options);
    const pages = tiling.pages.map(tile => buildTileContent(pattern, tiling, tile, options));
    if (pages.length === 0) pages.push(emptyPageContent(tiling));
    return assemblePdf(pages, tiling.pageWidthPt, tiling.pageHeightPt);
  }

  const layout = planPatternPdfLayout(pattern, options);
  const content = buildContentStream(pattern, layout, options);
  return assemblePdf([content], layout.pageWidthPt, layout.pageHeightPt);
}
