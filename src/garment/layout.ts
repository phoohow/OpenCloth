import type { BodyLandmarks } from '@/avatar';
import type { Panel, Pattern, Vec2 } from '@/model/types';

import { computeBBox } from '@/base/geom';
import { drapeHeightOffsetCm } from '@/garment/drapePlacement';
import { vec2 } from '@/model/types';
import { samplePanelOutline } from '@/pattern/panel';

interface SheetPiece {
  panel: Panel;
  box: { min: Vec2; max: Vec2 };
  centreX: number;
  top: number;
  bottom: number;
  width: number;
}

const rowWidth = (row: SheetPiece[], gapCm: number): number =>
  row.reduce((sum, piece) => sum + piece.width, 0) + gapCm * (row.length - 1);

function offsetPanel(pattern: Pattern, panel: Panel, dx: number, dy: number): void {
  const moved = new Set<string>();
  const shiftIds = [...panel.outlineEdgeIds, ...(panel.holes ?? []).flat()];
  for (const edgeId of shiftIds) {
    const edge = pattern.edges[edgeId];
    if (!edge) continue;
    if (edge.arc) edge.arc = { ...edge.arc, center: vec2(edge.arc.center.x + dx, edge.arc.center.y + dy) };
    for (const pointId of [edge.startPointId, edge.endPointId]) {
      if (moved.has(pointId)) continue;
      moved.add(pointId);
      const point = pattern.points[pointId];
      if (!point) continue;
      point.pos = vec2(point.pos.x + dx, point.pos.y + dy);
      if (point.handleIn) point.handleIn = { ...point.handleIn, x: point.handleIn.x + dx, y: point.handleIn.y + dy };
      if (point.handleOut) point.handleOut = { ...point.handleOut, x: point.handleOut.x + dx, y: point.handleOut.y + dy };
    }
  }

  for (const lineId of panel.internalLineIds) {
    const line = pattern.internalLines[lineId];
    if (!line) continue;
    line.points = line.points.map(p => vec2(p.x + dx, p.y + dy));
  }

  for (const trim of Object.values(pattern.trims ?? {})) {
    if (trim.panelId !== panel.id) continue;
    trim.pos = vec2(trim.pos.x + dx, trim.pos.y + dy);
  }
}

function panelBBox(pattern: Pattern, panel: Panel): { min: Vec2; max: Vec2 } {
  return computeBBox(samplePanelOutline(pattern, panel));
}

function columnOf(panel: Panel): number {
  const drape = panel.drape;
  if (!drape) return 1;
  if (drape.region === 'arm' || drape.region === 'leg') {
    return drape.side === 'left' ? 0 : 3;
  }

  return drape.zone === 'back' ? 2 : 1;
}

function packRows(pieces: SheetPiece[]): SheetPiece[][] {
  const byTop = [...pieces].sort((a, b) => b.top - a.top || b.bottom - a.bottom);
  const bands: Array<{ top: number; bottom: number; pieces: SheetPiece[] }> = [];
  for (const piece of byTop) {
    const band = bands[bands.length - 1];
    const overlap = band ? Math.min(band.top, piece.top) - Math.max(band.bottom, piece.bottom) : 0;
    const shorter = band ? Math.min(band.top - band.bottom, piece.top - piece.bottom) : 0;
    if (band && overlap > shorter * 0.5) {
      band.pieces.push(piece);
      band.top = Math.max(band.top, piece.top);
      band.bottom = Math.min(band.bottom, piece.bottom);
    } else {
      bands.push({ top: piece.top, bottom: piece.bottom, pieces: [piece] });
    }
  }

  return bands.map(band => band.pieces.sort((a, b) => a.centreX - b.centreX));
}

export function layoutByHeight(pattern: Pattern, body: BodyLandmarks, gapCm = 6): void {
  const columns: SheetPiece[][] = [[], [], [], []];
  for (const panel of Object.values(pattern.panels)) {
    if (panel.outlineEdgeIds.length < 3) continue;
    const box = panelBBox(pattern, panel);
    const offset = panel.drape ? drapeHeightOffsetCm(panel, box.max.y, body) : 0;
    delete panel.sheetLiftCm;
    columns[columnOf(panel)]!.push({
      panel,
      box,
      centreX: (box.min.x + box.max.x) / 2,
      top: box.max.y + offset,
      bottom: box.min.y + offset,
      width: box.max.x - box.min.x,
    });
  }

  const laid = columns
    .filter(pieces => pieces.length > 0)
    .map((pieces) => {
      const rows = packRows(pieces);
      return { rows, width: Math.max(...rows.map(row => rowWidth(row, gapCm))) };
    });

  const total = laid.reduce((sum, column) => sum + column.width, 0) + gapCm * (laid.length - 1);
  let left = -total / 2;
  for (const column of laid) {
    const centre = left + column.width / 2;
    let previousBottom = Infinity;
    let lift = 0;
    for (const row of column.rows) {
      const lowest = Math.max(...row.map(piece => piece.top));
      const wanted = previousBottom - gapCm;
      if (lowest > wanted) lift += wanted - lowest;
      previousBottom = Math.min(...row.map(piece => piece.bottom)) + lift;
      let x = centre - rowWidth(row, gapCm) / 2;
      for (const piece of row) {
        offsetPanel(pattern, piece.panel, x - piece.box.min.x, 0);
        if (lift !== 0) piece.panel.sheetLiftCm = lift;
        x += piece.width + gapCm;
      }
    }

    left += column.width + gapCm;
  }
}

export function appendPattern(target: Pattern, source: Pattern, gapCm = 8): void {
  const panels = Object.values(source.panels);
  const existingBoxes = Object.values(target.panels).map(panel => panelBBox(target, panel));

  for (const [id, point] of Object.entries(source.points)) target.points[id] = point;
  for (const [id, edge] of Object.entries(source.edges)) target.edges[id] = edge;
  for (const [id, dart] of Object.entries(source.darts)) target.darts[id] = dart;
  for (const [id, line] of Object.entries(source.internalLines)) target.internalLines[id] = line;
  for (const [id, seam] of Object.entries(source.seams)) target.seams[id] = seam;
  for (const [id, panel] of Object.entries(source.panels)) target.panels[id] = panel;
  for (const [id, print] of Object.entries(source.prints)) target.prints[id] = print;
  for (const [id, stitch] of Object.entries(source.topstitches)) target.topstitches[id] = stitch;
  for (const [id, trim] of Object.entries(source.trims)) target.trims[id] = trim;
  const extras = ['notches', 'annotations', 'measurements'] as const;
  for (const key of extras) {
    const src = (source as unknown as Record<string, Record<string, never>>)[key] ?? {};
    const dst = ((target as unknown as Record<string, Record<string, never>>)[key] ??= {});
    for (const [id, value] of Object.entries(src)) dst[id] = value;
  }

  if (existingBoxes.length === 0) return;
  const targetMaxX = Math.max(...existingBoxes.map(box => box.max.x));
  const sourceMinX = Math.min(...panels.map(panel => panelBBox(target, panel).min.x));
  const dx = targetMaxX + gapCm - sourceMinX;
  for (const panel of panels) offsetPanel(target, panel, dx, 0);
}
