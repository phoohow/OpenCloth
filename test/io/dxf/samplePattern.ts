import type { Pattern, PatternEdge, PatternPoint, Vec2 } from '@/model/types';
import { adaptiveSampleBezier, edgeCurve } from '@/pattern/geom/bezier';
import { adaptiveSampleArc } from '@/common/geom';
import { ensureCCW } from '@/common/geom';
import { sampleEdge } from '@/pattern/geom/edgeSample';

/** Straight or bezier loop edge: [from, to] plus optional bezier control points. */
type LoopEdge = [Vec2, Vec2] | { from: Vec2; to: Vec2; c0: Vec2; c1: Vec2 };

/** Builds one closed chain of line/bezier edges; returns point and edge ids in order. */
function addLoop(pattern: Pattern, prefix: string, edges: LoopEdge[]): string[] {
  const full: { from: Vec2; to: Vec2; c0?: Vec2; c1?: Vec2 }[] = edges.map(e =>
    Array.isArray(e) ? { from: e[0], to: e[1] } : e);
  const pointIdAt = (p: Vec2, i: number): string => {
    const id = `${prefix}_p${i}`;
    const point: PatternPoint = { id, pos: p, kind: 'corner' };
    const outEdge = full[i];
    const inEdge = full[(i - 1 + full.length) % full.length];
    if (outEdge?.c0) { point.kind = 'smooth'; point.handleOut = { ...outEdge.c0 }; }
    if (inEdge?.c1) { point.kind = 'smooth'; point.handleIn = { ...inEdge.c1 }; }
    pattern.points[id] = point;
    return id;
  };
  const ids: string[] = [];
  full.forEach((e, i) => {
    const start = pointIdAt(e.from, i % full.length);
    const end = i + 1 < full.length ? pointIdAt(e.to, i + 1) : `${prefix}_p0`;
    const id = `${prefix}_e${i}`;
    const edge: PatternEdge = {
      id,
      type: e.c0 && e.c1 ? 'bezier' : 'line',
      startPointId: start,
      endPointId: end,
      semantic: 'free',
    };
    pattern.edges[id] = edge;
    ids.push(id);
  });
  return ids;
}

/** Deterministic 3-panel pattern: rectangle, bezier-curved panel and an L-shape with a hole. */
export function buildSamplePattern(): Pattern {
  const pattern: Pattern = {
    points: {}, edges: {}, darts: {}, internalLines: {}, panels: {}, seams: {},
    notches: {}, annotations: {}, measurements: {},
    prints: {}, topstitches: {}, trims: {},
  };

  const frontEdges = addLoop(pattern, 'front', [
    [{ x: 0, y: 0 }, { x: 40, y: 0 }],
    [{ x: 40, y: 0 }, { x: 40, y: 60 }],
    [{ x: 40, y: 60 }, { x: 0, y: 60 }],
    [{ x: 0, y: 60 }, { x: 0, y: 0 }],
  ]);
  pattern.panels.front = {
    id: 'front', name: '前片', outlineEdgeIds: frontEdges, dartIds: [], internalLineIds: ['front_fold'],
    holes: [], seamAllowanceCm: 1, fabricId: 'fabric_default', meshResolutionCm: 1.5,
    grainAngleDeg: 90, visible: true, locked: false,
  };
  pattern.internalLines['front_fold'] = { id: 'front_fold', points: [{ x: 5, y: 5 }, { x: 5, y: 55 }], kind: 'fold' };
  pattern.notches['front_notch'] = { id: 'front_notch', edgeId: 'front_e0', t: 0.5, style: 'v' };
  pattern.annotations['front_anno'] = { id: 'front_anno', panelId: 'front', text: '前片', pos: { x: 20, y: 30 }, sizeMm: 10 };

  const sleeveEdges = addLoop(pattern, 'sleeve', [
    [{ x: 100, y: 0 }, { x: 120, y: 0 }],
    [{ x: 120, y: 0 }, { x: 120, y: 30 }],
    { from: { x: 120, y: 30 }, to: { x: 100, y: 0 }, c0: { x: 105, y: 35 }, c1: { x: 95, y: 10 } },
  ]);
  pattern.panels.sleeve = {
    id: 'sleeve', name: '袖片', outlineEdgeIds: sleeveEdges, dartIds: [], internalLineIds: [],
    holes: [], seamAllowanceCm: 0, fabricId: 'fabric_default', meshResolutionCm: 1.5,
    visible: true, locked: false,
  };
  pattern.notches['sleeve_drill'] = { id: 'sleeve_drill', edgeId: 'sleeve_e0', t: 0.25, style: 'drill', widthMm: 3 };
  pattern.annotations['sleeve_anno'] = { id: 'sleeve_anno', panelId: 'sleeve', text: '袖片', pos: { x: 112, y: 10 }, sizeMm: 10 };

  const pocketEdges = addLoop(pattern, 'pocket', [
    [{ x: 200, y: 0 }, { x: 230, y: 0 }],
    [{ x: 230, y: 0 }, { x: 230, y: 10 }],
    [{ x: 230, y: 10 }, { x: 210, y: 10 }],
    [{ x: 210, y: 10 }, { x: 210, y: 25 }],
    [{ x: 210, y: 25 }, { x: 200, y: 25 }],
    [{ x: 200, y: 25 }, { x: 200, y: 0 }],
  ]);
  const holeEdges = addLoop(pattern, 'pocket_hole', [
    [{ x: 202, y: 2 }, { x: 206, y: 2 }],
    [{ x: 206, y: 2 }, { x: 206, y: 6 }],
    [{ x: 206, y: 6 }, { x: 202, y: 6 }],
    [{ x: 202, y: 6 }, { x: 202, y: 2 }],
  ]);
  pattern.panels.pocket = {
    id: 'pocket', name: '口袋', outlineEdgeIds: pocketEdges, dartIds: [], internalLineIds: [],
    holes: [holeEdges], seamAllowanceCm: 0, fabricId: 'fabric_default', meshResolutionCm: 1.5,
    visible: true, locked: false,
  };

  return pattern;
}

/** Finely sampled closed polygon of a pattern edge loop. */
export function finePolygon(pattern: Pattern, edgeIds: string[]): Vec2[] {
  const pts: Vec2[] = [];
  for (const edgeId of edgeIds) {
    const edge = pattern.edges[edgeId];
    if (!edge) continue;
    const p0 = pattern.points[edge.startPointId]!.pos;
    const p1 = pattern.points[edge.endPointId]!.pos;
    let samples: Vec2[];
    if (edge.type === 'arc' && edge.arc) samples = adaptiveSampleArc(edge.arc, 0.002);
    else if (edge.type === 'bezier') {
      const curve = edgeCurve(pattern, edge);
      samples = curve ? adaptiveSampleBezier(curve, 0.002) : [p0, p1];
    } else samples = [p0, p1];
    for (const p of samples) {
      const last = pts[pts.length - 1];
      if (last && Math.hypot(p.x - last.x, p.y - last.y) < 1e-9) continue;
      pts.push(p);
    }
  }
  if (pts.length > 1) {
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) < 1e-6) pts.pop();
  }
  return ensureCCW(pts);
}

/** Symmetric maximum point-to-polyline distance between two closed polygons. */
export function hausdorff(a: Vec2[], b: Vec2[]): number {
  const d = (p: Vec2, poly: Vec2[]): number => {
    let best = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const q = poly[(i + 1) % poly.length];
      const ex = q.x - poly[i].x;
      const ey = q.y - poly[i].y;
      const len2 = ex * ex + ey * ey;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - poly[i].x) * ex + (p.y - poly[i].y) * ey) / len2));
      best = Math.min(best, Math.hypot(p.x - (poly[i].x + ex * t), p.y - (poly[i].y + ey * t)));
    }
    return best;
  };
  return Math.max(
    ...a.map(p => d(p, b)),
    ...b.map(p => d(p, a)),
  );
}

/** Samples a panel outline through the public edge sampler (for round-trip checks). */
export function parsedOutline(pattern: Pattern, panelId: string): Vec2[] {
  const panel = pattern.panels[panelId];
  const pts: Vec2[] = [];
  for (const edgeId of panel.outlineEdgeIds) {
    for (const p of sampleEdge(pattern, edgeId)) {
      const last = pts[pts.length - 1];
      if (last && Math.hypot(p.x - last.x, p.y - last.y) < 1e-9) continue;
      pts.push(p);
    }
  }
  if (pts.length > 1 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < 1e-6) pts.pop();
  return ensureCCW(pts);
}
