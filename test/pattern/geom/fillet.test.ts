import { describe, it, expect } from 'vitest';
import type { Pattern, PatternEdge } from '@/model/types';
import { genId } from '@/common/id';
import { createEmptyPattern } from '@/model/defaults';
import { filletCorner, filletCorners } from '@/pattern/geom/fillet';
import { evalArc } from '@/common/geom';
import { edgeCurve } from '@/pattern/geom/bezier';
import { edgeLength } from '@/pattern/geom/edgeSample';
import { distance } from '@/common/geom';

const makeEdge = (s: string, e: string): PatternEdge => ({
  id: genId('edge'), type: 'line', startPointId: s, endPointId: e,
});

/** 10x10 counter-clockwise square panel outline. */
function squarePattern(): Pattern {
  const p = createEmptyPattern();
  const ids = ['p0', 'p1', 'p2', 'p3'];
  const pos = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  ids.forEach((id, i) => { p.points[id] = { id, pos: pos[i], kind: 'corner' }; });
  const order = ['p0', 'p1', 'p2', 'p3', 'p0'];
  for (let i = 0; i < 4; i++) {
    const e = makeEdge(order[i], order[i + 1]);
    e.semantic = 'sideSeam';
    e.seamAllowanceCm = 1.5;
    p.edges[e.id] = e;
  }
  p.panels.panel = {
    id: 'panel', name: 'sq', outlineEdgeIds: Object.keys(p.edges), dartIds: [],
    internalLineIds: [], seamAllowanceCm: 1, fabricId: 'f', meshResolutionCm: 2,
    visible: true, locked: false,
  };
  return p;
}

describe('filletCorner', () => {
  it('直角线线圆角给出精确切点与相切圆弧', () => {
    const p = squarePattern();
    const e0 = Object.values(p.edges).find(e => e.endPointId === 'p1')!;
    const e1 = Object.values(p.edges).find(e => e.startPointId === 'p1')!;
    const r = filletCorner(p, 'p1', 2, makeEdge);
    expect(r).not.toBeNull();
    const [keptIn, fillet, keptOut] = r!.edges;

    // Tangent points 2cm from the corner along each edge.
    expect(p.points[keptIn.endPointId].pos.x).toBeCloseTo(8, 6);
    expect(p.points[keptIn.endPointId].pos.y).toBeCloseTo(0, 6);
    expect(p.points[keptOut.startPointId].pos.x).toBeCloseTo(10, 6);
    expect(p.points[keptOut.startPointId].pos.y).toBeCloseTo(2, 6);
    expect(fillet.type).toBe('arc');
    expect(fillet.arc!.radius).toBeCloseTo(2, 6);

    // Arc endpoints coincide with the trimmed edges, giving tangent continuity.
    const arcStart = evalArc(fillet.arc!, 0);
    expect(arcStart.x).toBeCloseTo(8, 6);
    expect(arcStart.y).toBeCloseTo(0, 6);
    const arcEnd = evalArc(fillet.arc!, 1);
    expect(arcEnd.x).toBeCloseTo(10, 6);
    expect(arcEnd.y).toBeCloseTo(2, 6);
    expect(fillet.arc!.center.x).toBeCloseTo(8, 6);
    expect(fillet.arc!.center.y).toBeCloseTo(2, 6);

    // Old edges removed, new edges registered.
    expect(p.edges[e0.id]).toBeUndefined();
    expect(p.edges[e1.id]).toBeUndefined();
    for (const e of r!.edges) expect(p.edges[e.id]).toBe(e);
    expect(r!.newPointIds).toHaveLength(2);
  });

  it('切向连续：圆弧在切点处与相邻直线方向一致', () => {
    const p = squarePattern();
    const r = filletCorner(p, 'p1', 2, makeEdge)!;
    const [keptIn, fillet] = r.edges;
    // Walk the arc from its start and check the initial travel direction is +x.
    const a = evalArc(fillet.arc!, 0);
    const b = evalArc(fillet.arc!, 0.001);
    expect(b.x - a.x).toBeGreaterThan(0);
    expect(Math.abs(b.y - a.y)).toBeLessThan(1e-4);
    // Kept inbound edge still ends at the arc start.
    expect(keptIn.endPointId).toBe(fillet.startPointId);
    expect(r.edges[2].startPointId).toBe(fillet.endPointId);
  });

  it('保留原边的语义与缝份属性', () => {
    const p = squarePattern();
    const r = filletCorner(p, 'p1', 1, makeEdge)!;
    expect(r.edges[0].semantic).toBe('sideSeam');
    expect(r.edges[0].seamAllowanceCm).toBe(1.5);
    expect(r.edges[2].semantic).toBe('sideSeam');
    // The fillet arc itself carries no semantic.
    expect(r.edges[1].semantic).toBeUndefined();
  });

  it('半径超出相邻边长时返回 null 且不改动图样', () => {
    const p = squarePattern();
    const before = Object.keys(p.edges).sort().join(',');
    expect(filletCorner(p, 'p1', 11, makeEdge)).toBeNull();
    expect(Object.keys(p.edges).sort().join(',')).toBe(before);
    expect(Object.keys(p.points)).toHaveLength(4);
  });

  it('平角（180°）不构成圆角返回 null', () => {
    const p = createEmptyPattern();
    const ids = ['a', 'b', 'c'];
    const pos = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }];
    ids.forEach((id, i) => { p.points[id] = { id, pos: pos[i], kind: 'corner' }; });
    for (const [s, e] of [['a', 'b'], ['b', 'c']]) {
      const edge = makeEdge(s, e);
      p.edges[edge.id] = edge;
    }
    expect(filletCorner(p, 'b', 1, makeEdge)).toBeNull();
  });

  it('开口端点（仅两条边不齐全）返回 null', () => {
    const p = createEmptyPattern();
    p.points.a = { id: 'a', pos: { x: 0, y: 0 } };
    p.points.b = { id: 'b', pos: { x: 5, y: 0 } };
    const e = makeEdge('a', 'b');
    p.edges[e.id] = e;
    expect(filletCorner(p, 'a', 1, makeEdge)).toBeNull();
  });

  it('贝塞尔邻边：切点落在曲线上并拆分为新的贝塞尔边', () => {
    const p = squarePattern();
    const e1 = Object.values(p.edges).find(e => e.startPointId === 'p1' && e.endPointId === 'p2')!;
    e1.type = 'bezier';
    p.points.p1.handleOut = { x: 14, y: 4 };
    p.points.p2.handleIn = { x: 12, y: 10 };
    // Original control points, captured before the fillet rewrites the handles.
    const original = { p0: { x: 10, y: 0 }, c0: { x: 14, y: 4 }, c1: { x: 12, y: 10 }, p1: { x: 10, y: 10 } };

    const r = filletCorner(p, 'p1', 2, makeEdge);
    expect(r).not.toBeNull();
    const [keptIn, fillet, keptOut] = r!.edges;

    expect(keptIn.type).toBe('line');
    expect(keptOut.type).toBe('bezier');
    expect(fillet.type).toBe('arc');
    expect(edgeCurve(p, keptOut)).not.toBeNull();

    // Outbound tangent point sits on the original curve.
    const tout = p.points[keptOut.startPointId].pos;
    let minDist = Infinity;
    for (let i = 0; i <= 40; i++) {
      minDist = Math.min(minDist, distance(bezierPoint(original, i / 40), tout));
    }
    expect(minDist).toBeLessThan(0.25);

    // The trimmed curve starts at the tangent point and the fillet arc ends on it.
    expect(edgeCurve(p, keptOut)!.p0).toBe(tout);
    const arcEnd = evalArc(fillet.arc!, 1);
    expect(arcEnd.x).toBeCloseTo(tout.x, 3);
    expect(arcEnd.y).toBeCloseTo(tout.y, 3);
  });

  it('圆弧邻边：切点保持在原圆上', () => {
    const p = squarePattern();
    const e3 = Object.values(p.edges).find(e => e.startPointId === 'p3' && e.endPointId === 'p0')!;
    const center = { x: -3, y: 5 };
    const radius = Math.hypot(3, 5);
    e3.type = 'arc';
    e3.arc = {
      center, radius,
      startAngle: Math.atan2(10 - 5, 0 + 3),
      endAngle: Math.atan2(0 - 5, 0 + 3),
      ccw: true,
    };

    const r = filletCorner(p, 'p0', 2, makeEdge);
    expect(r).not.toBeNull();
    const [keptIn, fillet, keptOut] = r!.edges;
    expect(keptIn.type).toBe('arc');
    expect(keptIn.arc!.radius).toBeCloseTo(radius, 6);
    const tin = p.points[keptIn.endPointId].pos;
    expect(distance(center, tin)).toBeCloseTo(radius, 6);
    expect(fillet.type).toBe('arc');
    expect(keptOut.type).toBe('line');
    expect(keptOut.startPointId).toBe(fillet.endPointId);
  });
});

describe('filletCorners', () => {
  it('四角全部圆角化并闭合', () => {
    const p = squarePattern();
    const edgeIds = Object.keys(p.edges);
    const r = filletCorners(p, ['p0', 'p1', 'p2', 'p3'], 1, makeEdge);
    expect(r).not.toBeNull();
    // Four trimmed lines plus four quarter arcs remain live.
    expect(r!.edges).toHaveLength(8);
    expect(r!.edges.filter(e => e.type === 'arc')).toHaveLength(4);
    expect(r!.newPointIds).toHaveLength(8);
    for (const old of edgeIds) expect(p.edges[old]).toBeUndefined();
    for (const e of r!.edges) expect(p.edges[e.id]).toBe(e);

    // Outline stays closed: every end point has exactly one edge leaving it.
    const starts = new Map<string, number>();
    for (const e of r!.edges) starts.set(e.startPointId, (starts.get(e.startPointId) ?? 0) + 1);
    for (const e of r!.edges) expect(starts.get(e.endPointId)).toBe(1);

    // Perimeter ≈ 40 - 8 + 2π ≈ 38.28.
    let total = 0;
    for (const e of r!.edges) total += edgeLength(p, e.id);
    expect(total).toBeCloseTo(40 - 8 + 2 * Math.PI, 1);
  });

  it('相邻两角依次圆角化，中间边两端各留切点', () => {
    const p = squarePattern();
    const r = filletCorners(p, ['p1', 'p2'], 2, makeEdge);
    expect(r).not.toBeNull();
    expect(r!.edges).toHaveLength(5);
    // The edge between p1 and p2 got trimmed on both sides to length 6.
    const shared = r!.edges.find(e => e.type === 'line'
      && Math.abs(distance(p.points[e.startPointId].pos, p.points[e.endPointId].pos) - 6) < 1e-6);
    expect(shared).toBeDefined();
  });

  it('任一角失败时返回 null', () => {
    const p = squarePattern();
    expect(filletCorners(p, ['p1', 'p2'], 30, makeEdge)).toBeNull();
  });
});

// Cubic evaluation for the curve-adjacency check.
function bezierPoint(b: { p0: { x: number; y: number }; c0: { x: number; y: number }; c1: { x: number; y: number }; p1: { x: number; y: number } }, t: number) {
  const mt = 1 - t;
  return {
    x: mt ** 3 * b.p0.x + 3 * mt * mt * t * b.c0.x + 3 * mt * t * t * b.c1.x + t ** 3 * b.p1.x,
    y: mt ** 3 * b.p0.y + 3 * mt * mt * t * b.c0.y + 3 * mt * t * t * b.c1.y + t ** 3 * b.p1.y,
  };
}
