import type { Pattern, PatternPoint, Vec2 } from '@/model/types';
import type { BodyLandmarks } from '@/avatar';
import { panelCutBounds } from '@/pattern/panel';
import { drapeHeightOffsetCm } from '@/pattern/drape';

/** Shifted copy of a pattern point; handles ride along with the anchor. */
function shiftPoint(point: PatternPoint, dy: number): PatternPoint {
  if (dy === 0) return point;
  return {
    ...point,
    pos: { x: point.pos.x, y: point.pos.y + dy },
    ...(point.handleIn ? { handleIn: { ...point.handleIn, y: point.handleIn.y + dy } } : {}),
    ...(point.handleOut ? { handleOut: { ...point.handleOut, y: point.handleOut.y + dy } } : {}),
  };
}

/**
 * Vertical offsets in centimeters from each panel's pattern y to the height the 3D pane puts it at.
 * A panel without a drape is built flat at its pattern coordinates, so its offset is zero.
 */
export function panelHeightOffsets(pattern: Pattern, body: BodyLandmarks): Map<string, number> {
  const offsets = new Map<string, number>();
  for (const panel of Object.values(pattern.panels)) {
    if (!panel.drape) {
      offsets.set(panel.id, 0);
      continue;
    }
    offsets.set(panel.id, drapeHeightOffsetCm(panel, panelCutBounds(pattern, panel).max.y, body));
  }
  return offsets;
}

/**
 * Offsets after a panel-move preview: a draped panel rides its anchor shift, so its offset moves
 * by the same `dy`, while a flat panel stays at zero. Panels outside `panelIds` keep `base`.
 * Lets the drag path skip resampling every draped outline per frame.
 */
export function panelMoveOffsets(
  pattern: Pattern, base: ReadonlyMap<string, number>, panelIds: readonly string[], dy: number,
): ReadonlyMap<string, number> {
  const offsets = new Map(base);
  for (const id of panelIds) {
    const panel = pattern.panels[id];
    if (!panel) continue;
    offsets.set(id, panel.drape ? (base.get(id) ?? 0) + dy : 0);
  }
  return offsets;
}

/** Point id to the vertical offset of the panel it belongs to; shared points take the first panel. */
export function pointHeightOffsets(
  pattern: Pattern, offsets: ReadonlyMap<string, number>,
): Map<string, number> {
  const result = new Map<string, number>();
  const claim = (pointId: string, dy: number): void => {
    if (!result.has(pointId)) result.set(pointId, dy);
  };
  for (const panel of Object.values(pattern.panels)) {
    const dy = offsets.get(panel.id) ?? 0;
    for (const loop of [panel.outlineEdgeIds, ...(panel.holes ?? [])]) {
      for (const edgeId of loop) {
        const edge = pattern.edges[edgeId];
        if (!edge) continue;
        claim(edge.startPointId, dy);
        claim(edge.endPointId, dy);
      }
    }
    for (const dartId of panel.dartIds) {
      const tipId = pattern.darts[dartId]?.tipId;
      if (tipId) claim(tipId, dy);
    }
  }
  return result;
}

/** Vertical offset of one point, taken from the first panel whose outline or dart uses it. */
export function pointHeightOffsetCm(
  pattern: Pattern, pointId: string, offsets: ReadonlyMap<string, number>,
): number {
  for (const panel of Object.values(pattern.panels)) {
    const dy = offsets.get(panel.id) ?? 0;
    for (const edgeId of [panel.outlineEdgeIds, ...(panel.holes ?? [])].flat()) {
      const edge = pattern.edges[edgeId];
      if (edge && (edge.startPointId === pointId || edge.endPointId === pointId)) return dy;
    }
    for (const dartId of panel.dartIds) {
      if (pattern.darts[dartId]?.tipId === pointId) return dy;
    }
  }
  return 0;
}

/** Vertical offset of the panel an element belongs to. */
export function panelOffsetCm(offsets: ReadonlyMap<string, number>, panelId: string | null | undefined): number {
  return (panelId ? offsets.get(panelId) : 0) ?? 0;
}

/**
 * Copy of the pattern with every piece moved to the height the 3D pane places it at, so pattern y
 * reads as centimetres above the ground on both sides. Ids are unchanged, which keeps picking,
 * snapping and every id-based command working on the copy.
 */
export function toHeightPattern(pattern: Pattern, offsets: ReadonlyMap<string, number>): Pattern {
  const pointOffsets = pointHeightOffsets(pattern, offsets);
  const ofPanel = (panelId: string): number => offsets.get(panelId) ?? 0;

  const points: Record<string, PatternPoint> = {};
  for (const [id, point] of Object.entries(pattern.points)) {
    points[id] = shiftPoint(point, pointOffsets.get(id) ?? 0);
  }

  const edges = { ...pattern.edges };
  for (const [id, edge] of Object.entries(pattern.edges)) {
    const dy = pointOffsets.get(edge.startPointId) ?? 0;
    if (!edge.arc || dy === 0) continue;
    edges[id] = { ...edge, arc: { ...edge.arc, center: { ...edge.arc.center, y: edge.arc.center.y + dy } } };
  }

  const internalLines = { ...pattern.internalLines };
  const annotations = { ...pattern.annotations };
  const trims = { ...pattern.trims };
  for (const panel of Object.values(pattern.panels)) {
    const dy = ofPanel(panel.id);
    if (dy === 0) continue;
    for (const lineId of panel.internalLineIds) {
      const line = pattern.internalLines[lineId];
      if (line) internalLines[lineId] = { ...line, points: line.points.map(p => ({ x: p.x, y: p.y + dy })) };
    }
  }
  for (const [id, note] of Object.entries(pattern.annotations)) {
    const dy = ofPanel(note.panelId);
    if (dy !== 0) annotations[id] = { ...note, pos: { x: note.pos.x, y: note.pos.y + dy } };
  }
  for (const [id, trim] of Object.entries(pattern.trims)) {
    const dy = ofPanel(trim.panelId);
    if (dy !== 0) trims[id] = { ...trim, pos: { x: trim.pos.x, y: trim.pos.y + dy } };
  }
  return {
    ...pattern,
    points,
    edges,
    internalLines,
    annotations,
    trims,
  };
}

/** Pattern-space point from a point picked in the height view. */
export function toPatternPoint(p: Vec2, offsetCm: number): Vec2 {
  return offsetCm === 0 ? p : { x: p.x, y: p.y - offsetCm };
}

/** Pattern-space points from points picked in the height view. */
export function toPatternPoints(ps: readonly Vec2[], offsetCm: number): Vec2[] {
  return offsetCm === 0 ? ps.map(p => ({ ...p })) : ps.map(p => toPatternPoint(p, offsetCm));
}
