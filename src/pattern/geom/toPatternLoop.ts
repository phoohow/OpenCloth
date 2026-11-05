import { genId } from '@/common/id';
import type { EdgeSemantic, Pattern, PatternEdge, Vec2 } from '@/model/types';

import { distance, ensureCCW } from '@/common/geom';

/** Edge ids and vertex ids of a closed loop inserted into a pattern. */
export interface EdgeLoop {
  /** Line edges in traversal order; `edgeIds[i]` runs from `pointIds[i]` to the next point. */
  edgeIds: string[];
  /** Loop vertices in the same order as the edges. */
  pointIds: string[];
}

export interface PolygonLoopOptions {
  /** Builds an edge record with a fresh id; plain line edges are generated when absent. */
  makeEdge?: (startId: string, endId: string) => PatternEdge;
  /** Semantic assigned to created edges that do not carry one. */
  semantic?: EdgeSemantic;
  /** Vertices within this distance of a candidate point reuse that point. Defaults to 1e-6. */
  mergeTolerance?: number;
  /** Coincident-point candidate set: the panel's own loop points, or every pattern point. */
  mergeScope?: 'panel' | 'pattern';
  /** Exterior winding for the loop; hole loops use 'cw'. Defaults to 'ccw'. */
  winding?: 'ccw' | 'cw';
}

interface Candidate {
  id: string;
  pos: Vec2;
}

/** Existing non-construction points a new loop may merge with, scoped per options. */
function candidatePoints(pattern: Pattern, panelId: string, scope: 'panel' | 'pattern'): Candidate[] {
  const usable = (id: string): Candidate | null => {
    const point = pattern.points[id];
    return point && !point.construction ? { id, pos: point.pos } : null;
  };
  if (scope === 'pattern' || !pattern.panels[panelId]) {
    return Object.keys(pattern.points).map(usable).filter((c): c is Candidate => c !== null);
  }
  const panel = pattern.panels[panelId];
  const ids = new Set<string>();
  for (const edgeId of [...panel.outlineEdgeIds, ...(panel.holes ?? []).flat()]) {
    const edge = pattern.edges[edgeId];
    if (edge) { ids.add(edge.startPointId); ids.add(edge.endPointId); }
  }
  return [...ids].map(usable).filter((c): c is Candidate => c !== null);
}

/**
 * Inserts a closed polygon as a new edge loop in the pattern: registers merged or fresh
 * points and line edges, winding-normalized per `options.winding`. Panel wiring stays
 * with the caller.
 */
export function polygonToEdgeLoop(
  pattern: Pattern,
  panelId: string,
  polygon: Vec2[],
  options: PolygonLoopOptions = {},
): EdgeLoop {
  const tol = options.mergeTolerance ?? 1e-6;
  if (polygon.length < 3) return { edgeIds: [], pointIds: [] };

  let ring = ensureCCW(polygon.map(p => ({ ...p })));
  if (options.winding === 'cw') ring = ring.reverse();
  if (ring.length > 1 && distance(ring[0], ring[ring.length - 1]) <= tol) ring.pop();

  const candidates = candidatePoints(pattern, panelId, options.mergeScope ?? 'panel');
  const pointIds: string[] = [];
  for (const pos of ring) {
    const hit = candidates.find(c => distance(c.pos, pos) <= tol);
    if (hit) {
      pointIds.push(hit.id);
      continue;
    }
    const id = genId('pt');
    pattern.points[id] = { id, pos, kind: 'corner' };
    candidates.push({ id, pos });
    pointIds.push(id);
  }

  // Repeated vertices collapse; a loop needs at least three distinct corners.
  const distinct = pointIds.filter((id, i) => id !== pointIds[(i + 1) % pointIds.length]);
  if (distinct.length < 3) return { edgeIds: [], pointIds: distinct };

  const edgeIds: string[] = [];
  for (let i = 0; i < distinct.length; i++) {
    const a = distinct[i];
    const b = distinct[(i + 1) % distinct.length];
    const edge = options.makeEdge
      ? options.makeEdge(a, b)
      : { id: genId('edge'), type: 'line' as const, startPointId: a, endPointId: b };
    if (options.semantic && !edge.semantic) edge.semantic = options.semantic;
    pattern.edges[edge.id] = edge;
    edgeIds.push(edge.id);
  }
  return { edgeIds, pointIds: distinct };
}
