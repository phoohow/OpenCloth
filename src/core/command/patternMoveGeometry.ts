import type { Panel, Pattern, Vec2 } from '../model/types';

/** Coincidence tolerance in cm for treating two positions as the same spot. */
const EPS = 1e-6;
const near = (a: Vec2, b: Vec2): boolean => Math.hypot(a.x - b.x, a.y - b.y) < EPS;
const moved = (p: Vec2, d: Vec2): Vec2 => ({ x: p.x + d.x, y: p.y + d.y });

/** One translated value plus the key needed to restore it. */
export type MoveRecord =
  | { kind: 'point'; id: string; old: Vec2 }
  | { kind: 'handle'; edgeId: string; which: 'c0' | 'c1'; old: Vec2 }
  | { kind: 'internal'; lineId: string; index: number; old: Vec2 };

/** Everything a translation moves as one unit: points, curve handles and line vertices. */
export interface MoveGeometry {
  /** Pattern point ids to translate. */
  pointIds: string[];
  /** Bezier control points that move with their owning edge. */
  handles: Array<{ edgeId: string; which: 'c0' | 'c1' }>;
  /** Internal-line vertices, addressed by line id and position in its point list. */
  lineVertices: Array<{ lineId: string; index: number }>;
}

const emptyGeometry = (): MoveGeometry => ({ pointIds: [], handles: [], lineVertices: [] });

/** Panels whose outline references the point. */
function panelsOfPoint(pattern: Pattern, pointId: string): Panel[] {
  return Object.values(pattern.panels).filter(p =>
    p.outlineEdgeIds.some(eid => {
      const e = pattern.edges[eid];
      return e && (e.startPointId === pointId || e.endPointId === pointId);
    }));
}

/**
 * Points with the given translations, plus the bezier handles sitting exactly on them
 * and the internal-line vertices coincident with them inside panels referencing them.
 */
export function pointMoveGeometry(pattern: Pattern, pointIds: readonly string[]): MoveGeometry {
  const geom = emptyGeometry();
  const seen = new Set<string>();
  const claim = (key: string): boolean => {
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };

  for (const pointId of pointIds) {
    const point = pattern.points[pointId];
    if (!point || !claim(`point:${pointId}`)) continue;
    geom.pointIds.push(pointId);
    const at = point.pos;

    for (const edge of Object.values(pattern.edges)) {
      if (edge.type !== 'bezier' || !edge.bezier) continue;
      if (edge.startPointId === pointId && near(edge.bezier.c0, at) && claim(`handle:${edge.id}:c0`)) {
        geom.handles.push({ edgeId: edge.id, which: 'c0' });
      }
      if (edge.endPointId === pointId && near(edge.bezier.c1, at) && claim(`handle:${edge.id}:c1`)) {
        geom.handles.push({ edgeId: edge.id, which: 'c1' });
      }
    }

    for (const panel of panelsOfPoint(pattern, pointId)) {
      for (const lineId of panel.internalLineIds) {
        const line = pattern.internalLines[lineId];
        if (!line) continue;
        line.points.forEach((p, i) => {
          if (near(p, at) && claim(`internal:${lineId}:${i}`)) {
            geom.lineVertices.push({ lineId, index: i });
          }
        });
      }
    }
  }
  return geom;
}

/**
 * All geometry owned by the given panels: outline vertices, their bezier handles,
 * dart tips and legs, and every internal-line vertex.
 */
export function panelMoveGeometry(pattern: Pattern, panelIds: readonly string[]): MoveGeometry {
  const points = new Set<string>();
  const handles = new Set<string>();
  const lineVertices = new Set<string>();

  const claimEdge = (edgeId: string): void => {
    const edge = pattern.edges[edgeId];
    if (!edge) return;
    points.add(edge.startPointId);
    points.add(edge.endPointId);
    if (edge.type === 'bezier' && edge.bezier) {
      handles.add(`${edge.id}:c0`);
      handles.add(`${edge.id}:c1`);
    }
  };

  for (const panelId of panelIds) {
    const panel = pattern.panels[panelId];
    if (!panel) continue;
    for (const edgeId of panel.outlineEdgeIds) claimEdge(edgeId);
    for (const dartId of panel.dartIds) {
      const dart = pattern.darts[dartId];
      if (!dart) continue;
      points.add(dart.tipId);
      claimEdge(dart.edge1Id);
      claimEdge(dart.edge2Id);
    }
    for (const lineId of panel.internalLineIds) {
      const line = pattern.internalLines[lineId];
      if (!line) continue;
      line.points.forEach((_, i) => lineVertices.add(`${lineId}:${i}`));
    }
  }

  return {
    pointIds: [...points].filter(id => !!pattern.points[id]),
    handles: [...handles].flatMap(key => {
      const [edgeId, which] = key.split(':');
      return [{ edgeId, which: which as 'c0' | 'c1' }];
    }),
    lineVertices: [...lineVertices].map(key => {
      const [lineId, index] = key.split(':');
      return { lineId, index: Number(index) };
    }),
  };
}

/** Applies the translation to the pattern in place and returns the values needed for undo. */
export function translateGeometry(pattern: Pattern, geom: MoveGeometry, delta: Vec2): MoveRecord[] {
  const records: MoveRecord[] = [];

  for (const id of geom.pointIds) {
    const point = pattern.points[id];
    if (!point) continue;
    records.push({ kind: 'point', id, old: { ...point.pos } });
    point.pos = moved(point.pos, delta);
  }

  for (const handle of geom.handles) {
    const edge = pattern.edges[handle.edgeId];
    if (!edge?.bezier) continue;
    const old = edge.bezier[handle.which];
    records.push({ kind: 'handle', edgeId: handle.edgeId, which: handle.which, old: { ...old } });
    edge.bezier = { ...edge.bezier, [handle.which]: moved(old, delta) };
  }

  for (const vertex of geom.lineVertices) {
    const line = pattern.internalLines[vertex.lineId];
    const old = line?.points[vertex.index];
    if (!line || !old) continue;
    records.push({ kind: 'internal', lineId: vertex.lineId, index: vertex.index, old: { ...old } });
    line.points = line.points.map((p, i) => (i === vertex.index ? moved(p, delta) : p));
  }

  return records;
}

/** Restores the values captured by translateGeometry. */
export function restoreGeometry(pattern: Pattern, records: MoveRecord[]): void {
  for (const rec of records) {
    if (rec.kind === 'point') {
      const point = pattern.points[rec.id];
      if (point) point.pos = { ...rec.old };
    } else if (rec.kind === 'handle') {
      const edge = pattern.edges[rec.edgeId];
      if (edge?.bezier) edge.bezier = { ...edge.bezier, [rec.which]: { ...rec.old } };
    } else {
      const line = pattern.internalLines[rec.lineId];
      if (line) line.points = line.points.map((p, i) => (i === rec.index ? { ...rec.old } : p));
    }
  }
}

/** Copy of the pattern with the geometry translated, for the live drag preview. */
export function previewMove(pattern: Pattern, geom: MoveGeometry, delta: Vec2): Pattern {
  const copy = structuredClone(pattern);
  translateGeometry(copy, geom, delta);
  return copy;
}
