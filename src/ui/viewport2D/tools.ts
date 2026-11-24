import type { Pattern, Vec2 } from '@/model/types';

import { nearlyEqual2 } from '@/base/math';

export {
  panelFrame, printCenter, printFrame, rotatedFrame, topstitchRows, trimRadiusCm,
} from '@/pattern/panel';

export const DEFAULT_DART_INTAKE_CM = 2;

export const NOTCH_MID_T = 0.5;

export type PolylineMode = 'line' | 'split' | 'hole';

export interface DartLeg {
  edgeId: string;
  t: number;
}

export interface SeamSide {
  edgeId: string;
  t0: number;
  t1: number;
  startLow?: boolean;
}

export type DraftState =
  | null
  | { tool: 'pen'; points: Vec2[]; cursor: Vec2; curve: boolean }
  | { tool: 'shape'; shape: 'rect' | 'circle' | 'ellipse'; start: Vec2; current: Vec2 }
  | { tool: 'polyline'; mode: PolylineMode; panelId: string; points: Vec2[]; cursor: Vec2 }
  | { tool: 'dart'; panelId: string; leg1: { edgeId: string; t: number } | null; leg2: { edgeId: string; t: number } | null; cursor: Vec2 }
  | { tool: 'seam'; sides: SeamSide[]; drag: { edgeId: string; start: Vec2; current: Vec2 } | null }
  | { tool: 'measure'; pointAId: string | null; cursor: Vec2 }
  | { tool: 'handleDrag'; pointId: string; which: 'in' | 'out'; cursor: Vec2 };

export function orderedDartLegs(pattern: Pattern, first: DartLeg, second: DartLeg): { leg1: DartLeg; leg2: DartLeg } | null {
  if (first.edgeId === second.edgeId) return null;
  const e1 = pattern.edges[first.edgeId];
  const e2 = pattern.edges[second.edgeId];
  if (!e1 || !e2) return null;
  if (e1.endPointId === e2.startPointId) return { leg1: first, leg2: second };
  if (e2.endPointId === e1.startPointId) return { leg1: second, leg2: first };
  return null;
}

export function cleanDraftLoop(points: readonly Vec2[]): Vec2[] {
  const loop: Vec2[] = [];
  for (const point of points) {
    const previous = loop[loop.length - 1];
    if (previous && nearlyEqual2(previous, point)) continue;
    loop.push(point);
  }

  while (loop.length > 1) {
    const first = loop[0]!, last = loop[loop.length - 1]!;
    if (!nearlyEqual2(first, last)) break;
    loop.pop();
  }

  return loop;
}

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
