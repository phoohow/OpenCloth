import type { Pattern, Vec2 } from '@/model/types';

/** Print, topstitch and trim geometry shared with the engine. */
export {
  panelFrame, printCenter, printFrame, rotatedFrame, topstitchRows, trimRadiusCm,
} from '@/pattern/panel';

/** How a picked polyline leaves the model: a drawing line, a split cut, or a closed hole. */
export type PolylineMode = 'line' | 'split' | 'hole';

/** Intake width applied when a dart is drawn by clicking; editable afterwards in the panel. */
export const DEFAULT_DART_INTAKE_CM = 2;

/** Arc-length fraction where a new notch lands on its edge; editable afterwards by dragging. */
export const NOTCH_MID_T = 0.5;

/** One dart leg: a position on an outline edge. */
export interface DartLeg {
  edgeId: string;
  t: number;
}

/**
 * The two picks ordered so the first edge ends where the second begins, which is the
 * adjacency CreateDartCommand requires. Null when the edges are the same or not neighbours.
 */
export function orderedDartLegs(pattern: Pattern, first: DartLeg, second: DartLeg): { leg1: DartLeg; leg2: DartLeg } | null {
  if (first.edgeId === second.edgeId) return null;
  const e1 = pattern.edges[first.edgeId];
  const e2 = pattern.edges[second.edgeId];
  if (!e1 || !e2) return null;
  if (e1.endPointId === e2.startPointId) return { leg1: first, leg2: second };
  if (e2.endPointId === e1.startPointId) return { leg1: second, leg2: first };
  return null;
}

/** One side of a seam being drawn: its edge interval and the end the stitching starts from. */
export interface SeamSide {
  edgeId: string;
  t0: number;
  t1: number;
  /** Sewing runs from the low-t end when true, from the high-t end when false; unset until picked. */
  startLow?: boolean;
}

/** Pointer state machine of the drafting tools; one gesture at a time, cleared on tool switch. */
export type DraftState =
  | null
  | { tool: 'pen'; points: Vec2[]; cursor: Vec2; curve: boolean }
  | { tool: 'shape'; shape: 'rect' | 'circle' | 'ellipse'; start: Vec2; current: Vec2 }
  | { tool: 'polyline'; mode: PolylineMode; panelId: string; points: Vec2[]; cursor: Vec2 }
  | { tool: 'dart'; panelId: string; leg1: { edgeId: string; t: number } | null; leg2: { edgeId: string; t: number } | null; cursor: Vec2 }
  | { tool: 'seam'; sides: SeamSide[]; drag: { edgeId: string; start: Vec2; current: Vec2 } | null }
  | { tool: 'measure'; pointAId: string | null; cursor: Vec2 }
  | { tool: 'handleDrag'; pointId: string; which: 'in' | 'out'; cursor: Vec2 };

/**
 * Loop through a freehand stroke: repeated positions are dropped, including a last point that lands
 * on the first, so a double click or a snapped closing point cannot add a zero-length edge.
 */
export function cleanDraftLoop(points: readonly Vec2[]): Vec2[] {
  const loop: Vec2[] = [];
  for (const point of points) {
    const previous = loop[loop.length - 1];
    if (previous && Math.hypot(previous.x - point.x, previous.y - point.y) < 1e-6) continue;
    loop.push(point);
  }
  while (loop.length > 1) {
    const first = loop[0]!, last = loop[loop.length - 1]!;
    if (Math.hypot(first.x - last.x, first.y - last.y) >= 1e-6) break;
    loop.pop();
  }
  return loop;
}

/** Whether a draft leaves the tool armed for the next stroke instead of finishing. */
export function draftIsIdle(draft: DraftState): boolean {
  if (!draft) return true;
  switch (draft.tool) {
    case 'pen': return draft.points.length === 0;
    case 'polyline': return draft.points.length === 0;
    case 'seam': return draft.sides.length === 0;
    case 'measure': return !draft.pointAId;
    default: return true;
  }
}

/** Rect/ellipse/circle outline corners from a drag rectangle; square/circle with shift. */
export function shapeFrame(start: Vec2, current: Vec2, shape: 'rect' | 'circle' | 'ellipse', square: boolean): { min: Vec2; max: Vec2 } {
  let dx = current.x - start.x;
  let dy = current.y - start.y;
  if (square && shape !== 'ellipse') {
    const m = Math.min(Math.abs(dx), Math.abs(dy));
    dx = Math.sign(dx || 1) * m;
    dy = Math.sign(dy || 1) * m;
  }
  if (shape === 'circle') {
    const r = Math.hypot(dx, dy);
    return { min: { x: start.x - r, y: start.y - r }, max: { x: start.x + r, y: start.y + r } };
  }
  return {
    min: { x: Math.min(start.x, start.x + dx), y: Math.min(start.y, start.y + dy) },
    max: { x: Math.max(start.x, start.x + dx), y: Math.max(start.y, start.y + dy) },
  };
}
