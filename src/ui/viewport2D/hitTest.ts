import type { Pattern, Vec2 } from '@/model/types';
import { sampleEdge, sampleEdgeInterval } from '@/pattern/panel';
import { pointAtT } from '@/pattern/geom';
import { elementNodeId, idsOfKind, parseElementNodeId, type PatternElementKind } from '@/model';
import { NOTCH_MID_T, printFrame, topstitchRows, trimRadiusCm } from '@/ui/viewport2D/tools';

/** Production symbols that sit inside a panel outline, so they are picked before the panel fill. */
export const PRODUCTION_KINDS: PatternElementKind[] = ['trim', 'print', 'topstitch'];

/** Pattern marks inside a panel body, picked after edges and before the panel fill. */
export const MARK_KINDS: PatternElementKind[] = ['seam', 'dart', 'internal', 'measurement'];

/** Drag affordance of what sits under the pointer: a draggable symbol, a movable panel, or nothing. */
export type PressRole = 'grab' | 'move' | null;

/** Element kinds the select tool pre-highlights through their sampled geometry. */
export type ElementHoverKind =
  | 'dart' | 'seam' | 'notch' | 'annotation' | 'measurement' | 'print' | 'topstitch' | 'trim';

const ELEMENT_HOVER_KINDS = new Set<PatternElementKind>([
  'dart', 'seam', 'notch', 'annotation', 'measurement', 'print', 'topstitch', 'trim',
]);

/** Whether a picked element kind gets its own hover highlight. */
export function isElementHoverKind(kind: PatternElementKind): kind is ElementHoverKind {
  return ELEMENT_HOVER_KINDS.has(kind);
}

/** Elements a press would pick, drawn as a pre-highlight before the press. */
export type HoverTarget =
  | { kind: 'point'; id: string }
  | { kind: 'internalVertex'; lineId: string; index: number }
  | { kind: 'edge'; id: string }
  | { kind: 'internal'; id: string }
  | { kind: 'panel'; id: string }
  | { kind: 'element'; elementKind: ElementHoverKind; id: string };

/** Stable key of a hover target, so pointer moves over one element do not restart renders. */
export function hoverTargetKey(target: HoverTarget | null): string {
  if (!target) return '';
  if (target.kind === 'internalVertex') return `${target.kind}:${target.lineId}:${target.index}`;
  if (target.kind === 'element') return `${target.kind}:${target.elementKind}:${target.id}`;
  return `${target.kind}:${target.id}`;
}

/** Tools that place a mark or production element on existing geometry. */
export type PlacementTool = 'notch' | 'annotation' | 'measure' | 'dart' | 'topstitch' | 'trim';

const PLACEMENT_TOOLS = new Set<PlacementTool>([
  'notch', 'annotation', 'measure', 'dart', 'topstitch', 'trim',
]);

/** Whether a tool highlights the object its press would act on. */
export function isPlacementTool(tool: string): tool is PlacementTool {
  return PLACEMENT_TOOLS.has(tool as PlacementTool);
}

/** Landing point of the mark a tool would place, drawn as a ghost before the press. */
export interface MarkHint { kind: 'notch' | 'annotation'; pos: Vec2 }

/** Stable key of a mark hint, so pointer moves within one spot do not restart renders. */
export function markHintKey(hint: MarkHint | null): string {
  return hint ? `${hint.kind}:${hint.pos.x}:${hint.pos.y}` : '';
}

/** Internal-line vertices one drag moves together; a closed ring pairs its two ends. */
export interface InternalLineVertexHit {
  lineId: string;
  indices: number[];
}

/** One element's hit geometry: disjoint sampled strokes, whether one encloses an area, and its pick padding. */
interface ElementGeometry {
  id: string;
  /** Independent polylines; no segment joins the end of one to the start of the next. */
  paths: Vec2[][];
  /** Closed outlines also hit-tested by containing the target. */
  closed?: boolean;
  /** Radius in cm a pick may miss the sampled point by, for symbols drawn with a size. */
  radius?: number;
}

/** Axis-aligned bounds in world centimeters. */
export interface Rect { min: Vec2; max: Vec2 }

/** Ray-casting point-in-polygon test. */
export function pointInPolygon(poly: Vec2[], p: Vec2): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** Pattern point addressed by id during hit-testing. */
export interface NamedPoint { id: string; pos: Vec2 }

/** Id of the nearest point within radius; null when none qualifies. */
export function nearestPointWithinRadius(
  points: readonly NamedPoint[], target: Vec2, radius: number,
): string | null {
  let bestId: string | null = null;
  let bestDist = radius;
  for (const pt of points) {
    const d = Math.hypot(pt.pos.x - target.x, pt.pos.y - target.y);
    if (d <= bestDist) {
      bestDist = d;
      bestId = pt.id;
    }
  }
  return bestId;
}

/** A curve control handle targeted by a press: its point, which side, and where it sits. */
export interface HandleHit { pointId: string; which: 'in' | 'out'; pos: Vec2 }

/**
 * Control handle of one of the given points under a press. A handle only wins when the press is
 * nearer to it than to every vertex, so a short handle never swallows a press aimed at a vertex.
 */
export function pickPointHandle(
  pattern: Pattern, pointIds: readonly string[], target: Vec2, radius: number,
): HandleHit | null {
  let nearestVertex = Infinity;
  for (const point of Object.values(pattern.points)) {
    nearestVertex = Math.min(nearestVertex, Math.hypot(point.pos.x - target.x, point.pos.y - target.y));
  }
  let best: { hit: HandleHit; distance: number } | null = null;
  for (const pointId of pointIds) {
    const point = pattern.points[pointId];
    if (!point) continue;
    for (const which of ['in', 'out'] as const) {
      const handle = which === 'in' ? point.handleIn : point.handleOut;
      if (!handle) continue;
      const distance = Math.hypot(handle.x - target.x, handle.y - target.y);
      if (distance > radius || distance >= nearestVertex) continue;
      if (best && best.distance <= distance) continue;
      best = { hit: { pointId, which, pos: { x: handle.x, y: handle.y } }, distance };
    }
  }
  return best?.hit ?? null;
}

/** Closest point on segment a-b to p, with its clamped parameter. */
export function projectOnSegment(p: Vec2, a: Vec2, b: Vec2): { point: Vec2; t: number } {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return { point: { x: a.x + dx * t, y: a.y + dy * t }, t };
}

/** Edge under the cursor, with the projected position on it. */
export interface EdgeHit {
  edgeId: string;
  /** Projected position on the edge polyline. */
  point: Vec2;
  /** Approximate parameter along the full edge, 0..1. */
  t: number;
  distance: number;
}

/** Nearest hit among the sampled polylines of the given edges, within radius. */
export function nearestEdgeSegment(
  pattern: Pattern, edgeIds: readonly string[], target: Vec2, radius: number,
): EdgeHit | null {
  let best: EdgeHit | null = null;
  for (const edgeId of edgeIds) {
    const pts = sampleEdge(pattern, edgeId);
    const segCount = pts.length - 1;
    if (segCount < 1) continue;
    for (let i = 0; i < segCount; i++) {
      const { point, t } = projectOnSegment(target, pts[i], pts[i + 1]);
      const distance = Math.hypot(target.x - point.x, target.y - point.y);
      if (distance > radius || (best && best.distance <= distance)) continue;
      best = { edgeId, point, t: (i + t) / segCount, distance };
    }
  }
  return best;
}

/** Panel whose outline or hole loop contains the edge. */
export function panelIdOfEdge(pattern: Pattern, edgeId: string): string | null {
  for (const panel of Object.values(pattern.panels)) {
    if (panel.outlineEdgeIds.includes(edgeId)) return panel.id;
    if ((panel.holes ?? []).some(loop => loop.includes(edgeId))) return panel.id;
  }
  return null;
}

/** Visible panel under a world point: its outline first, then one of its edges. */
export function visiblePanelUnderPoint(
  pattern: Pattern, outlines: ReadonlyMap<string, Vec2[]>, target: Vec2, radius: number,
): string | null {
  for (const [panelId, polygon] of outlines) {
    if (!pattern.panels[panelId]?.visible) continue;
    if (pointInPolygon(polygon, target)) return panelId;
  }
  const hit = nearestEdgeSegment(pattern, Object.keys(pattern.edges), target, radius);
  if (!hit) return null;
  const ownerId = panelIdOfEdge(pattern, hit.edgeId);
  return ownerId && pattern.panels[ownerId]?.visible ? ownerId : null;
}

/** Panels whose outline edges reference the point. */
export function panelsOfPoint(pattern: Pattern, pointId: string): string[] {
  const result: string[] = [];
  for (const panel of Object.values(pattern.panels)) {
    for (const edgeId of panel.outlineEdgeIds) {
      const edge = pattern.edges[edgeId];
      if (edge && (edge.startPointId === pointId || edge.endPointId === pointId)) {
        result.push(panel.id);
        break;
      }
    }
  }
  return result;
}

/** Whether the points' bounding box overlaps the rect. */
export function rectIntersectsBBox(rect: Rect, points: readonly Vec2[]): boolean {
  if (points.length === 0) return false;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return maxX >= rect.min.x && minX <= rect.max.x && maxY >= rect.min.y && minY <= rect.max.y;
}

/** Element rows of the given kinds whose geometry the marquee rect covers. Panels stay plain scene ids. */
export function elementsInRect(
  pattern: Pattern, rect: Rect, kinds: readonly PatternElementKind[],
): string[] {
  const rows: string[] = [];
  for (const kind of kinds) {
    for (const element of elementGeometry(pattern, kind)) {
      const covered = element.paths.some(path => path.some(p =>
        p.x >= rect.min.x && p.x <= rect.max.x && p.y >= rect.min.y && p.y <= rect.max.y));
      if (covered) rows.push(kind === 'panel' ? element.id : elementNodeId(kind, element.id));
    }
  }
  return rows;
}

/** Nearest element of the given kinds within radius, as a selection row. */
export function pickElements(
  pattern: Pattern, target: Vec2, radius: number, kinds: readonly PatternElementKind[],
): string | null {
  let best: { row: string; distance: number } | null = null;
  for (const kind of kinds) {
    for (const element of elementGeometry(pattern, kind)) {
      const distance = element.closed && element.paths.some(path => pointInPolygon(path, target))
        ? 0
        : Math.max(0, distanceToPaths(element.paths, target) - (element.radius ?? 0));
      if (distance > radius || (best && best.distance <= distance)) continue;
      best = { row: elementNodeId(kind, element.id), distance };
    }
  }
  return best?.row ?? null;
}

/** Shortest distance from a point to any of the disjoint sampled strokes. */
function distanceToPaths(paths: readonly Vec2[][], target: Vec2): number {
  let best = Infinity;
  for (const path of paths) best = Math.min(best, distanceToPolyline(path, target));
  return best;
}

/** Shortest distance from a point to a polyline; a single point measures to itself. */
function distanceToPolyline(points: readonly Vec2[], target: Vec2): number {
  if (points.length === 0) return Infinity;
  if (points.length === 1) return Math.hypot(target.x - points[0].x, target.y - points[0].y);
  let best = Infinity;
  for (let i = 0; i + 1 < points.length; i++) {
    const hit = projectOnSegment(target, points[i], points[i + 1]).point;
    best = Math.min(best, Math.hypot(target.x - hit.x, target.y - hit.y));
  }
  return best;
}

/**
 * Sampled strokes of every element of one kind, in object-id order. Panels list their outline
 * corners; the marquee rule and the pick rule both read this, so they stay in step.
 */
function elementGeometry(pattern: Pattern, kind: PatternElementKind): ElementGeometry[] {
  switch (kind) {
    case 'panel':
      return Object.values(pattern.panels).map(panel => ({
        id: panel.id,
        paths: [panel.outlineEdgeIds
          .map(edgeId => pattern.edges[edgeId] && pattern.points[pattern.edges[edgeId]!.startPointId])
          .filter((p): p is NonNullable<typeof p> => !!p)
          .map(p => p.pos)],
      }));
    case 'point':
      return Object.values(pattern.points).map(point => ({ id: point.id, paths: [[point.pos]] }));
    case 'edge':
      return Object.values(pattern.edges).map(edge => ({ id: edge.id, paths: [sampleEdge(pattern, edge.id)] }));
    case 'internal':
      return Object.values(pattern.internalLines ?? {}).map(line => ({ id: line.id, paths: [line.points] }));
    case 'dart':
      return Object.values(pattern.darts).map(dart => {
        const tip = pattern.points[dart.tipId]?.pos;
        const legs = [sampleEdge(pattern, dart.edge1Id), sampleEdge(pattern, dart.edge2Id)];
        return {
          id: dart.id,
          paths: tip ? [[tip, ...legs[0]!], [tip, ...legs[1]!]] : legs,
        };
      });
    case 'seam':
      return Object.values(pattern.seams)
        .filter(seam => seam.stitchVisible !== false)
        .map(seam => ({
          id: seam.id,
          paths: [sampleEdgeInterval(pattern, seam.a.edgeId, seam.a.t0, seam.a.t1),
            sampleEdgeInterval(pattern, seam.b.edgeId, seam.b.t0, seam.b.t1)],
        }));
    case 'notch':
      return Object.values(pattern.notches ?? {}).map(notch => {
        const at = pointAtT(pattern, notch.edgeId, notch.t);
        return { id: notch.id, paths: [at ? [at] : []] };
      });
    case 'annotation':
      return Object.values(pattern.annotations ?? {}).map(note => ({ id: note.id, paths: [[note.pos]] }));
    case 'print':
      return Object.values(pattern.prints ?? {})
        .filter(print => print.visible)
        .map(print => {
          const frame = printFrame(pattern, print);
          return frame
            ? { id: print.id, paths: [[...frame, frame[0]!]], closed: true }
            : { id: print.id, paths: [] };
        });
    case 'topstitch':
      return Object.values(pattern.topstitches ?? {})
        .filter(stitch => stitch.visible)
        .map(stitch => ({ id: stitch.id, paths: topstitchRows(pattern, stitch) }));
    case 'trim':
      return Object.values(pattern.trims ?? {})
        .filter(trim => trim.visible)
        .map(trim => ({ id: trim.id, paths: [[trim.pos]], radius: trimRadiusCm(trim) }));
    case 'measurement':
      return Object.values(pattern.measurements ?? {}).map(measurement => {
        const a = measurement.refs.pointAId && pattern.points[measurement.refs.pointAId];
        const b = measurement.refs.pointBId && pattern.points[measurement.refs.pointBId];
        const points = a && b ? [a.pos, b.pos] : (measurement.refs.edgeId ? sampleEdge(pattern, measurement.refs.edgeId) : []);
        return { id: measurement.id, paths: [points] };
      });
  }
}

/** Sampled strokes of one element, for its hover pre-highlight. */
export function elementHoverPaths(
  pattern: Pattern, kind: ElementHoverKind, id: string,
): { paths: Vec2[][]; closed?: boolean; radius?: number } | null {
  const element = elementGeometry(pattern, kind).find(candidate => candidate.id === id);
  return element ? { paths: element.paths, closed: element.closed, radius: element.radius } : null;
}

/** Panel that owns an internal line. */
function internalLineOwnerId(pattern: Pattern, lineId: string): string | null {
  for (const panel of Object.values(pattern.panels)) {
    if (panel.internalLineIds.includes(lineId)) return panel.id;
  }
  return null;
}

/** Nearest vertex of a selected internal line; the two ends of a closed ring move as one. */
export function pickInternalLineVertex(
  pattern: Pattern, selection: readonly string[], target: Vec2, radius: number,
): InternalLineVertexHit | null {
  let best: InternalLineVertexHit | null = null;
  let bestDistance = radius;
  for (const lineId of idsOfKind(selection, 'internal')) {
    const line = pattern.internalLines[lineId];
    if (!line) continue;
    const ownerId = internalLineOwnerId(pattern, lineId);
    if (ownerId && pattern.panels[ownerId]?.locked) continue;
    const last = line.points.length - 1;
    const closed = line.points.length > 2 && Math.hypot(
      line.points[0].x - line.points[last].x, line.points[0].y - line.points[last].y,
    ) < 1e-6;
    line.points.forEach((p, index) => {
      const distance = Math.hypot(p.x - target.x, p.y - target.y);
      if (distance > bestDistance || (best && distance >= bestDistance)) return;
      const indices = closed && (index === 0 || index === last) ? [0, last] : [index];
      best = { lineId, indices };
      bestDistance = distance;
    });
  }
  return best;
}

/**
 * Element under the pointer in the select tool's press order. Every object a press would pick
 * reports its own highlight, so nothing behind the frontmost object lights up by mistake.
 */
export function pickHoverTarget(
  pattern: Pattern, outlines: ReadonlyMap<string, Vec2[]>, selection: readonly string[],
  target: Vec2, radius: number,
): HoverTarget | null {
  const handle = pickPointHandle(pattern, idsOfKind(selection, 'point'), target, radius);
  if (handle) return { kind: 'point', id: handle.pointId };
  const pointId = nearestPointWithinRadius(Object.values(pattern.points), target, radius);
  if (pointId) return { kind: 'point', id: pointId };
  const vertex = pickInternalLineVertex(pattern, selection, target, radius);
  if (vertex) return { kind: 'internalVertex', lineId: vertex.lineId, index: vertex.indices[0]! };

  const mark = pickElements(pattern, target, radius, ['notch', 'annotation']);
  if (mark) return elementHover(mark);
  for (const printId of idsOfKind(selection, 'print')) {
    const print = pattern.prints?.[printId];
    const frame = print?.visible ? printFrame(pattern, print) : null;
    if (frame?.some(corner => Math.hypot(corner.x - target.x, corner.y - target.y) <= radius)) {
      return { kind: 'element', elementKind: 'print', id: printId };
    }
  }
  const production = pickElements(pattern, target, radius, PRODUCTION_KINDS);
  if (production) return elementHover(production);

  const edge = nearestEdgeSegment(pattern, Object.keys(pattern.edges), target, radius);
  if (edge) return { kind: 'edge', id: edge.edgeId };
  const markRow = pickElements(pattern, target, radius, MARK_KINDS);
  if (markRow) {
    const element = parseElementNodeId(markRow);
    if (element?.kind === 'internal') return { kind: 'internal', id: element.id };
    return elementHover(markRow);
  }
  const panelId = visiblePanelUnderPoint(pattern, outlines, target, radius);
  return panelId ? { kind: 'panel', id: panelId } : null;
}

/** Hover target of a picked element row, or null for kinds without their own highlight. */
function elementHover(row: string): HoverTarget | null {
  const element = parseElementNodeId(row);
  if (!element || !isElementHoverKind(element.kind)) return null;
  return { kind: 'element', elementKind: element.kind, id: element.id };
}

/**
 * Hover highlight and landing preview of a placement tool, using the same picks as its press so
 * only places where a click would act light up. `placed` is the snapped annotation position.
 */
export function pickPlacementFeedback(
  tool: PlacementTool,
  pattern: Pattern, outlines: ReadonlyMap<string, Vec2[]>, points: readonly NamedPoint[],
  target: Vec2, radius: number, placed: Vec2 | null = null,
): { hover: HoverTarget | null; hint: MarkHint | null } {
  if (tool === 'notch' || tool === 'dart' || tool === 'topstitch') {
    const edge = nearestEdgeSegment(pattern, Object.keys(pattern.edges), target, radius);
    if (!edge) return { hover: null, hint: null };
    const hint: MarkHint | null = tool === 'notch'
      ? { kind: 'notch', pos: pointAtT(pattern, edge.edgeId, NOTCH_MID_T) ?? edge.point }
      : null;
    return { hover: { kind: 'edge', id: edge.edgeId }, hint };
  }
  if (tool === 'annotation' || tool === 'trim') {
    const panelId = visiblePanelUnderPoint(pattern, outlines, target, radius);
    if (!panelId) return { hover: null, hint: null };
    const hint: MarkHint | null = tool === 'annotation' ? { kind: 'annotation', pos: placed ?? target } : null;
    return { hover: { kind: 'panel', id: panelId }, hint };
  }
  const pointId = nearestPointWithinRadius(points, target, radius);
  return { hover: pointId ? { kind: 'point', id: pointId } : null, hint: null };
}

/**
 * Drag affordance of a press at `target` in the select tool, in the pick order of the click
 * handler: control handle, vertex, internal-line vertex, notch or annotation, print corner,
 * production symbol, edge, inner mark, panel. Only objects whose drag would really start report a
 * role, so a locked panel or a selectable-but-fixed mark reports none.
 */
export function pickPressRole(
  pattern: Pattern, outlines: ReadonlyMap<string, Vec2[]>, selection: readonly string[],
  target: Vec2, radius: number,
): PressRole {
  if (pickPointHandle(pattern, idsOfKind(selection, 'point'), target, radius)) return 'grab';

  const pointId = nearestPointWithinRadius(Object.values(pattern.points), target, radius);
  if (pointId) {
    const owners = panelsOfPoint(pattern, pointId).filter(id => pattern.panels[id]?.visible);
    return owners.some(id => !pattern.panels[id]?.locked) ? 'grab' : null;
  }
  if (pickInternalLineVertex(pattern, selection, target, radius)) return 'grab';

  for (const notch of Object.values(pattern.notches ?? {})) {
    const at = pointAtT(pattern, notch.edgeId, notch.t);
    if (!at || Math.hypot(at.x - target.x, at.y - target.y) > radius) continue;
    const ownerId = panelIdOfEdge(pattern, notch.edgeId);
    return ownerId && !pattern.panels[ownerId]?.locked ? 'grab' : null;
  }
  for (const note of Object.values(pattern.annotations ?? {})) {
    if (Math.hypot(note.pos.x - target.x, note.pos.y - target.y) <= radius) return null;
  }

  for (const printId of idsOfKind(selection, 'print')) {
    const print = pattern.prints?.[printId];
    if (!print?.visible) continue;
    const frame = printFrame(pattern, print);
    if (frame?.some(corner => Math.hypot(corner.x - target.x, corner.y - target.y) <= radius)) return 'grab';
  }

  // Everything below sits on a panel, so a target outside the visible panels can skip the rest.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [panelId, polygon] of outlines) {
    if (!pattern.panels[panelId]?.visible) continue;
    for (const p of polygon) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (target.x < minX - radius || target.x > maxX + radius
    || target.y < minY - radius || target.y > maxY + radius) return null;

  const productionRow = pickElements(pattern, target, radius, PRODUCTION_KINDS);
  if (productionRow) {
    const element = parseElementNodeId(productionRow);
    if (!element || element.kind === 'topstitch') return null;
    const ownerId = element.kind === 'trim' ? pattern.trims?.[element.id]?.panelId : pattern.prints?.[element.id]?.panelId;
    return ownerId && !pattern.panels[ownerId]?.locked ? 'grab' : null;
  }
  // A press on an edge drags the vertices it hangs on.
  const edgeHit = nearestEdgeSegment(pattern, Object.keys(pattern.edges), target, radius);
  if (edgeHit) {
    const ownerId = panelIdOfEdge(pattern, edgeHit.edgeId);
    return ownerId && pattern.panels[ownerId]?.locked ? null : 'grab';
  }
  if (pickElements(pattern, target, radius, MARK_KINDS)) return null;

  const panelId = visiblePanelUnderPoint(pattern, outlines, target, radius);
  return panelId && !pattern.panels[panelId]?.locked ? 'move' : null;
}
