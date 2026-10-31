import type { ArcGeom, EdgeType, Panel, Pattern, Vec2 } from '../model/types';
import { arcFromThreePoints, evalArc } from '../../pattern/geom/arc';

/** Coincidence tolerance in cm for treating two positions as the same spot. */
const EPS = 1e-6;
const near = (a: Vec2, b: Vec2): boolean => Math.hypot(a.x - b.x, a.y - b.y) < EPS;
const moved = (p: Vec2, d: Vec2): Vec2 => ({ x: p.x + d.x, y: p.y + d.y });

/** One translated value plus the key needed to restore it. */
export type MoveRecord =
  | { kind: 'point'; id: string; old: { pos: Vec2; handleIn?: Vec2; handleOut?: Vec2; kind?: string } }
  | { kind: 'internal'; lineId: string; index: number; old: Vec2 }
  | { kind: 'arc'; edgeId: string; old: { type: EdgeType; arc?: ArcGeom } };

/** Everything a translation moves as one unit: points (with their handles) and line vertices. */
export interface MoveGeometry {
  /** Pattern point ids to translate. */
  pointIds: string[];
  /** Internal-line vertices, addressed by line id and position in its point list. */
  lineVertices: Array<{ lineId: string; index: number }>;
}

const emptyGeometry = (): MoveGeometry => ({ pointIds: [], lineVertices: [] });

/** Panels whose outline references the point. */
function panelsOfPoint(pattern: Pattern, pointId: string): Panel[] {
  return Object.values(pattern.panels).filter(p =>
    p.outlineEdgeIds.some(eid => {
      const e = pattern.edges[eid];
      return e && (e.startPointId === pointId || e.endPointId === pointId);
    }));
}

/**
 * Points with the given translations, plus the internal-line vertices coincident with them
 * inside panels referencing them. Curve handles ride along as part of their anchor point.
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
 * All geometry owned by the given panels: outline vertices (handles ride along),
 * dart tips and legs, and every internal-line vertex.
 */
export function panelMoveGeometry(pattern: Pattern, panelIds: readonly string[]): MoveGeometry {
  const points = new Set<string>();
  const lineVertices = new Set<string>();

  const claimEdge = (edgeId: string): void => {
    const edge = pattern.edges[edgeId];
    if (!edge) return;
    points.add(edge.startPointId);
    points.add(edge.endPointId);
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
    lineVertices: [...lineVertices].map(key => {
      const [lineId, index] = key.split(':');
      return { lineId, index: Number(index) };
    }),
  };
}

/** Applies the translation to the pattern in place and returns the values needed for undo. */
export function translateGeometry(pattern: Pattern, geom: MoveGeometry, delta: Vec2): MoveRecord[] {
  const records: MoveRecord[] = [];
  const movedIds = new Set(geom.pointIds);

  for (const id of geom.pointIds) {
    const point = pattern.points[id];
    if (!point) continue;
    records.push({
      kind: 'point',
      id,
      old: {
        pos: { ...point.pos },
        handleIn: point.handleIn ? { ...point.handleIn } : undefined,
        handleOut: point.handleOut ? { ...point.handleOut } : undefined,
        kind: point.kind,
      },
    });
    point.pos = moved(point.pos, delta);
    if (point.handleIn) point.handleIn = moved(point.handleIn, delta);
    if (point.handleOut) point.handleOut = moved(point.handleOut, delta);
  }

  for (const vertex of geom.lineVertices) {
    const line = pattern.internalLines[vertex.lineId];
    const old = line?.points[vertex.index];
    if (!line || !old) continue;
    records.push({ kind: 'internal', lineId: vertex.lineId, index: vertex.index, old: { ...old } });
    line.points = line.points.map((p, i) => (i === vertex.index ? moved(p, delta) : p));
  }

  refitArcs(pattern, movedIds, { translation: delta }, records);

  return records;
}

/**
 * Keeps every arc edge attached to the vertices that moved. Both ends riding the same translation
 * shift the center; one end moving refits the arc through its midpoint at wherever that midpoint
 * lands, and endpoints pulled onto it become a straight edge.
 */
export function refitArcs(
  pattern: Pattern,
  movedIds: ReadonlySet<string>,
  options: { translation?: Vec2; midpoint?: (arc: ArcGeom) => Vec2 } = {},
  records?: MoveRecord[],
): void {
  const midpointOf = options.midpoint ?? (arc => evalArc(arc, 0.5));
  for (const edge of Object.values(pattern.edges)) {
    if (edge.type !== 'arc' || !edge.arc) continue;
    const startMoved = movedIds.has(edge.startPointId);
    const endMoved = movedIds.has(edge.endPointId);
    if (!startMoved && !endMoved) continue;
    records?.push({ kind: 'arc', edgeId: edge.id, old: { type: edge.type, arc: { ...edge.arc, center: { ...edge.arc.center } } } });
    const start = pattern.points[edge.startPointId]?.pos;
    const end = pattern.points[edge.endPointId]?.pos;
    if (!start || !end) continue;
    if (options.translation && startMoved && endMoved) {
      edge.arc = { ...edge.arc, center: moved(edge.arc.center, options.translation) };
      continue;
    }
    const refit = arcFromThreePoints(start, midpointOf(edge.arc), end);
    if (refit) edge.arc = refit;
    else {
      edge.type = 'line';
      delete edge.arc;
    }
  }
}

/** Restores the values captured by translateGeometry. */
export function restoreGeometry(pattern: Pattern, records: MoveRecord[]): void {
  for (const rec of records) {
    if (rec.kind === 'point') {
      const point = pattern.points[rec.id];
      if (!point) continue;
      point.pos = { ...rec.old.pos };
      point.handleIn = rec.old.handleIn ? { ...rec.old.handleIn } : undefined;
      point.handleOut = rec.old.handleOut ? { ...rec.old.handleOut } : undefined;
      point.kind = rec.old.kind as Pattern['points'][string]['kind'];
    } else if (rec.kind === 'arc') {
      const edge = pattern.edges[rec.edgeId];
      if (!edge) continue;
      edge.type = rec.old.type;
      if (rec.old.arc) edge.arc = { ...rec.old.arc, center: { ...rec.old.arc.center } };
      else delete edge.arc;
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
