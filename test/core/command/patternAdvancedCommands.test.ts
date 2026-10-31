import { describe, it, expect } from 'vitest';
import type { Pattern, Vec2 } from '../../../src/core/model/types';
import type { ProjectContext } from '../../../src/core/command/command';
import { createEmptyPattern } from '../../../src/core/model/defaults';
import { validatePattern } from '../../../src/core/model/validatePattern';
import {
  AddInternalLineCommand, BreakPointCommand, ConnectPointsCommand, CreateCircleCommand, CreateEllipseCommand,
  MergeCollinearEdgesCommand, OffsetInternalLineCommand, PanelFromInternalLoopCommand, RhombusDartCommand,
  SetArcParamsCommand, SetEdgeAngleCommand, SetEdgeLengthCommand, SimplifyCurveCommand,
} from '../../../src/core/command/patternCommands';
import { edgeLength, pointAtT, sampleEdge } from '../../../src/pattern/geom/edgeSample';
import { arcFromThreePoints, arcSpan } from '../../../src/pattern/geom/arc';
import { samplePanelOutline } from '../../../src/pattern/panel/panelBuilder';
import { distance } from '../../../src/pattern/geom/vec2';
import { ctxOf, addSquare } from './fixtures';

/** Executes, checks topology, then undoes and compares against the pre-execute snapshot. */
function undoRestores(ctx: ProjectContext, cmd: { execute(c: ProjectContext): void; undo(c: ProjectContext): void }): void {
  const before = structuredClone(ctx.project.pattern);
  cmd.execute(ctx);
  expect(validatePattern(ctx.project.pattern)).toEqual([]);
  cmd.undo(ctx);
  expect(ctx.project.pattern).toEqual(before);
}

function squareCtx(size = 10): { ctx: ProjectContext; panelId: string } {
  const pattern = createEmptyPattern();
  const panelId = addSquare(pattern, 'sq', 0, 0, size);
  return { ctx: ctxOf(pattern), panelId };
}

/** Adds a polygon panel, reusing an existing point whose position already matches. */
function addPanel(pattern: Pattern, prefix: string, pts: Vec2[]): string {
  const pointIds = pts.map((pos, i) => {
    const shared = Object.keys(pattern.points).find(id =>
      Math.hypot(pattern.points[id].pos.x - pos.x, pattern.points[id].pos.y - pos.y) <= 1e-9);
    if (shared) return shared;
    const id = `${prefix}_p${i}`;
    pattern.points[id] = { id, pos, kind: 'corner' };
    return id;
  });
  const edgeIds: string[] = [];
  for (let i = 0; i < pointIds.length; i++) {
    const id = `${prefix}_e${i}`;
    pattern.edges[id] = { id, type: 'line', startPointId: pointIds[i], endPointId: pointIds[(i + 1) % pointIds.length] };
    edgeIds.push(id);
  }
  const panelId = `${prefix}_panel`;
  pattern.panels[panelId] = {
    id: panelId, name: prefix, outlineEdgeIds: edgeIds, dartIds: [], internalLineIds: [],
    seamAllowanceCm: 1, fabricId: 'f', meshResolutionCm: 3, visible: true, locked: false,
  };
  return panelId;
}

/** One panel whose outline runs through two triangles touching at the shared vertex. */
function addPinchedPanel(pattern: Pattern): string {
  const ids = ['v', 'k0', 'k1', 'v', 'k2', 'k3'];
  pattern.points.v = { id: 'v', pos: { x: 0, y: 0 }, kind: 'corner' };
  const pos: Vec2[] = [{ x: 2, y: 0 }, { x: 0, y: 2 }, { x: -2, y: 0 }, { x: 0, y: -2 }];
  pos.forEach((p, i) => { pattern.points[`k${i}`] = { id: `k${i}`, pos: p, kind: 'corner' }; });
  const edges: string[] = [];
  for (let i = 0; i < 6; i++) {
    const id = `pe${i}`;
    pattern.edges[id] = { id, type: 'line', startPointId: ids[i], endPointId: ids[(i + 1) % 6] };
    edges.push(id);
  }
  pattern.panels.pinch_panel = {
    id: 'pinch_panel', name: 'pinch', outlineEdgeIds: edges, dartIds: [], internalLineIds: [],
    seamAllowanceCm: 1, fabricId: 'f', meshResolutionCm: 3, visible: true, locked: false,
  };
  return 'v';
}

function outlineOf(pattern: Pattern, panelId: string): string[] {
  return [...pattern.panels[panelId].outlineEdgeIds];
}

/** Asserts every arc edge still passes through both of its endpoints. */
function assertArcsAttached(pattern: Pattern): void {
  for (const edge of Object.values(pattern.edges)) {
    if (edge.type !== 'arc' || !edge.arc) continue;
    for (const pointId of [edge.startPointId, edge.endPointId]) {
      const at = pattern.points[pointId].pos;
      expect(Math.hypot(at.x - edge.arc.center.x, at.y - edge.arc.center.y)).toBeCloseTo(edge.arc.radius, 6);
    }
  }
}

/** Four quarter-arc panel centred on the origin. */
function circleCtx(): { ctx: ProjectContext; panelId: string } {
  const pattern = createEmptyPattern();
  const ctx = ctxOf(pattern);
  new CreateCircleCommand(5, { x: 0, y: 0 }).execute(ctx);
  return { ctx, panelId: Object.values(pattern.panels)[0].id };
}

/** Panel p0(0,0) p1(4,0) p2(7,0) p3(10,0) p4(10,10) p5(0,10): three collinear edges first. */
function collinearCtx(): { ctx: ProjectContext; chain: string[] } {
  const pattern = createEmptyPattern();
  const panelId = addPanel(pattern, 'cl', [
    { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 7, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 },
  ]);
  return { ctx: ctxOf(pattern), chain: outlineOf(pattern, panelId).slice(0, 3) };
}

/** Pie-slice panel whose arc runs through `steps` straight edges of a radius-10 arc. */
function arcPanelCtx(steps: number, spanDeg: number): { ctx: ProjectContext; chain: string[] } {
  const pattern = createEmptyPattern();
  const arc: Vec2[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (spanDeg * Math.PI / 180) * (i / steps);
    arc.push({ x: 10 * Math.cos(a), y: 10 * Math.sin(a) });
  }
  const panelId = addPanel(pattern, 'arc', [{ x: 0, y: 0 }, ...arc]);
  return { ctx: ctxOf(pattern), chain: outlineOf(pattern, panelId).slice(1, steps + 1) };
}

/** Degrees between the chords of two edges at their shared vertex. */
function chordAngle(pattern: Pattern, edgeId: string, otherEdgeId: string): number {
  const edge = pattern.edges[edgeId];
  const other = pattern.edges[otherEdgeId];
  const shared = [edge.startPointId, edge.endPointId]
    .find(id => [other.startPointId, other.endPointId].includes(id))!;
  const far = (e: Pattern['edges'][string]): Vec2 => pattern.points[e.startPointId === shared ? e.endPointId : e.startPointId].pos;
  const anchor = pattern.points[shared].pos;
  const a = sub(far(edge), anchor);
  const b = sub(far(other), anchor);
  return Math.abs((Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y) * 180) / Math.PI);
}

function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

describe('BreakPointCommand', () => {
  it('splits a pinched vertex into two panels', () => {
    const pattern = createEmptyPattern();
    const sharedId = addPinchedPanel(pattern);
    const ctx = ctxOf(pattern);
    undoRestores(ctx, new BreakPointCommand(sharedId));
    const cmd = new BreakPointCommand(sharedId);
    cmd.execute(ctx);
    const panels = Object.values(pattern.panels);
    expect(panels).toHaveLength(2);
    expect(panels.map(p => p.outlineEdgeIds.length)).toEqual([3, 3]);
    expect(validatePattern(pattern)).toEqual([]);
    cmd.undo(ctx);
    expect(Object.values(pattern.panels)).toHaveLength(1);
  });

  it('detaches two panels that share one corner', () => {
    const pattern = createEmptyPattern();
    addPanel(pattern, 'a', [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]);
    addPanel(pattern, 'b', [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 20, y: 20 }, { x: 10, y: 20 }]);
    const ctx = ctxOf(pattern);
    const cmd = new BreakPointCommand('a_p2', ['b_e0', 'b_e3']);
    cmd.execute(ctx);
    expect(validatePattern(pattern)).toEqual([]);
    const points = (panelId: string) => new Set(outlineOf(pattern, panelId)
      .flatMap(id => [pattern.edges[id].startPointId, pattern.edges[id].endPointId]));
    const aPoints = points('a_panel');
    const bPoints = points('b_panel');
    expect([...aPoints].filter(id => bPoints.has(id))).toEqual([]);
    expect(pattern.panels.b_panel.outlineEdgeIds.every(id => ![...aPoints].includes(pattern.edges[id].startPointId))).toBe(true);
    cmd.undo(ctx);
    expect(pattern.edges.b_e0.startPointId).toBe('a_p2');
  });

  it('rejects an edge that does not pass the vertex', () => {
    const pattern = createEmptyPattern();
    const sharedId = addPinchedPanel(pattern);
    const ctx = ctxOf(pattern);
    const before = structuredClone(pattern);
    expect(() => new BreakPointCommand(sharedId, ['pe0', 'pe4']).execute(ctx)).toThrow(/未经过该顶点/);
    expect(pattern).toEqual(before);
  });
});

describe('ConnectPointsCommand', () => {
  it('welds back what a break separated', () => {
    const pattern = createEmptyPattern();
    addPanel(pattern, 'a', [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]);
    addPanel(pattern, 'b', [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 20, y: 20 }, { x: 10, y: 20 }]);
    const ctx = ctxOf(pattern);
    new BreakPointCommand('a_p2', ['b_e0', 'b_e3']).execute(ctx);
    const detached = pattern.edges.b_e0.startPointId;
    expect(detached).not.toBe('a_p2');
    const cmd = new ConnectPointsCommand('a_p2', detached);
    cmd.execute(ctx);
    expect(validatePattern(pattern)).toEqual([]);
    expect(pattern.edges.b_e0.startPointId).toBe('a_p2');
    expect(pattern.points[detached]).toBeUndefined();
    cmd.undo(ctx);
    expect(pattern.edges.b_e0.startPointId).toBe(detached);
    expect(Object.keys(pattern.panels)).toHaveLength(2);
  });

  it('welds the two vertices of a broken pinch into one', () => {
    const pattern = createEmptyPattern();
    const sharedId = addPinchedPanel(pattern);
    const ctx = ctxOf(pattern);
    new BreakPointCommand(sharedId).execute(ctx);
    const [first, second] = Object.values(pattern.panels);
    const idA = pattern.edges[first.outlineEdgeIds[0]].startPointId;
    const idB = pattern.edges[second.outlineEdgeIds[0]].startPointId;
    const cmd = new ConnectPointsCommand(idA, idB);
    cmd.execute(ctx);
    expect(validatePattern(pattern)).toEqual([]);
    expect(pattern.edges[second.outlineEdgeIds[0]].startPointId).toBe(idA);
    expect(pattern.points[idB]).toBeUndefined();
    cmd.undo(ctx);
    expect(pattern.edges[second.outlineEdgeIds[0]].startPointId).toBe(idB);
  });

  it('rejects a join that crosses the outline', () => {
    const pattern = createEmptyPattern();
    addSquare(pattern, 'b', 0, 0, 10);
    addSquare(pattern, 'a', -15, 0, 10);
    const ctx = ctxOf(pattern);
    const before = structuredClone(pattern);
    expect(() => new ConnectPointsCommand('a_p2', 'b_p2').execute(ctx)).toThrow(/自相交/);
    expect(pattern).toEqual(before);
  });

  it('rejects a vertex that is not a free end', () => {
    const pattern = createEmptyPattern();
    const sharedId = addPinchedPanel(pattern);
    const ctx = ctxOf(pattern);
    expect(() => new ConnectPointsCommand(sharedId, 'k0').execute(ctx)).toThrow(/开放端点/);
  });
});

describe('SetEdgeLengthCommand', () => {
  it('slides the end vertex and lands the length at 0.01 cm', () => {
    const { ctx, panelId } = squareCtx();
    const pattern = ctx.project.pattern;
    const edgeId = outlineOf(pattern, panelId)[0];
    const startId = pattern.edges[edgeId].startPointId;
    const cmd = new SetEdgeLengthCommand(edgeId, 12.5);
    cmd.execute(ctx);
    expect(Math.abs(edgeLength(pattern, edgeId) - 12.5)).toBeLessThan(0.01);
    expect(pattern.points[startId].pos).toEqual({ x: 0, y: 0 });
    new SetEdgeLengthCommand(edgeId, 3.27).execute(ctx);
    expect(Math.abs(edgeLength(pattern, edgeId) - 3.27)).toBeLessThan(0.01);
    cmd.undo(ctx);
    expect(edgeLength(pattern, edgeId)).toBeCloseTo(10, 6);
  });

  it('scales an arc edge to the target arc length', () => {
    const { ctx, panelId } = circleCtx();
    const pattern = ctx.project.pattern;
    const edgeId = outlineOf(pattern, panelId).find(id => pattern.edges[id].type === 'arc')!;
    const radius = pattern.edges[edgeId].arc!.radius;
    const cmd = new SetEdgeLengthCommand(edgeId, 9);
    cmd.execute(ctx);
    expect(Math.abs(edgeLength(pattern, edgeId) - 9)).toBeLessThan(0.01);
    expect(pattern.edges[edgeId].arc!.radius).toBeGreaterThan(radius);
    expect(validatePattern(pattern)).toEqual([]);
    cmd.undo(ctx);
    expect(pattern.edges[edgeId].arc!.radius).toBeCloseTo(radius, 6);
  });

  it('scales a curve by its chord', () => {
    const pattern = createEmptyPattern();
    const ctx = ctxOf(pattern);
    new CreateEllipseCommand(5, 5, { x: 0, y: 0 }).execute(ctx);
    const panel = Object.values(pattern.panels)[0];
    const edgeId = outlineOf(pattern, panel.id)[0];
    const edge = pattern.edges[edgeId];
    const oldLength = edgeLength(pattern, edgeId);
    const oldChord = distance(pattern.points[edge.startPointId].pos, pattern.points[edge.endPointId].pos);
    const startBefore = { ...pattern.points[edge.startPointId].pos };
    const cmd = new SetEdgeLengthCommand(edgeId, 8);
    cmd.execute(ctx);
    const chordAfter = distance(pattern.points[edge.startPointId].pos, pattern.points[edge.endPointId].pos);
    expect(chordAfter).toBeCloseTo(oldChord * (8 / oldLength), 6);
    expect(pattern.points[edge.startPointId].pos).toEqual(startBefore);
    expect(pattern.points[edge.startPointId].handleOut).toBeDefined();
    cmd.undo(ctx);
    expect(edgeLength(pattern, edgeId)).toBeCloseTo(oldLength, 6);
  });

  it('keeps the arcs meeting the moved vertex attached', () => {
    const { ctx, panelId } = circleCtx();
    const pattern = ctx.project.pattern;
    const arcId = outlineOf(pattern, panelId).find(id => pattern.edges[id].type === 'arc')!;

    new SetEdgeLengthCommand(arcId, 9).execute(ctx);

    expect(validatePattern(pattern)).toEqual([]);
    assertArcsAttached(pattern);
  });

  it('rejects a non-positive length', () => {
    const { ctx, panelId } = squareCtx();
    const edgeId = outlineOf(ctx.project.pattern, panelId)[0];
    const before = structuredClone(ctx.project.pattern);
    expect(() => new SetEdgeLengthCommand(edgeId, 0).execute(ctx)).toThrow(/正数/);
    expect(ctx.project.pattern).toEqual(before);
  });
});

describe('SetEdgeAngleCommand', () => {
  it('rotates the edge about the shared vertex and keeps its length', () => {
    const { ctx, panelId } = squareCtx();
    const pattern = ctx.project.pattern;
    const [e0, e1] = outlineOf(pattern, panelId);
    const farId = pattern.edges[e0].startPointId;
    const length = edgeLength(pattern, e0);
    const cmd = new SetEdgeAngleCommand(e0, e1, 60);
    cmd.execute(ctx);
    expect(Math.abs(chordAngle(pattern, e0, e1) - 60)).toBeLessThan(1e-6);
    expect(distance(pattern.points[farId].pos, { x: 10, y: 0 })).toBeCloseTo(length, 6);
    expect(validatePattern(pattern)).toEqual([]);
    cmd.undo(ctx);
    expect(Math.abs(chordAngle(pattern, e0, e1) - 90)).toBeLessThan(1e-6);
  });

  it('carries the arcs meeting the rotated vertex', () => {
    const { ctx, panelId } = circleCtx();
    const pattern = ctx.project.pattern;
    const [a, b] = outlineOf(pattern, panelId);

    new SetEdgeAngleCommand(a, b, 60).execute(ctx);

    expect(validatePattern(pattern)).toEqual([]);
    assertArcsAttached(pattern);
  });

  it('rejects edges without a shared vertex', () => {
    const { ctx, panelId } = squareCtx();
    const [e0, , e2] = outlineOf(ctx.project.pattern, panelId);
    expect(() => new SetEdgeAngleCommand(e0, e2, 45).execute(ctx)).toThrow(/公共顶点/);
  });
});

describe('MergeCollinearEdgesCommand', () => {
  it('merges the chain and maps seam intervals proportionally', () => {
    const { ctx, chain } = collinearCtx();
    const pattern = ctx.project.pattern;
    pattern.seams.seam_mid = {
      id: 'seam_mid', type: 'free',
      a: { edgeId: 'cl_e1', t0: 0.25, t1: 0.75, anchorT: 0.5 },
      b: { edgeId: 'cl_e4', t0: 0, t1: 1 }, flip: false, strength: 0.8, threadColor: '#f00', stitchVisible: true,
    };
    pattern.seams.seam_head = {
      id: 'seam_head', type: 'normal', a: { edgeId: 'cl_e0', t0: 0, t1: 1 },
      b: { edgeId: 'cl_e5', t0: 0, t1: 1 }, flip: true, strength: 0.8, threadColor: '#f00', stitchVisible: true,
    };
    pattern.seams.seam_tail = {
      id: 'seam_tail', type: 'normal', a: { edgeId: 'cl_e2', t0: 0, t1: 1 },
      b: { edgeId: 'cl_e3', t0: 0, t1: 1 }, flip: false, strength: 0.8, threadColor: '#f00', stitchVisible: true,
    };
    const cmd = new MergeCollinearEdgesCommand(chain);
    cmd.execute(ctx);
    expect(validatePattern(pattern)).toEqual([]);
    expect(cmd.mergedEdgeId).toBe('cl_e0');
    expect(outlineOf(pattern, 'cl_panel')).toEqual(['cl_e0', 'cl_e3', 'cl_e4', 'cl_e5']);
    expect(edgeLength(pattern, 'cl_e0')).toBeCloseTo(10, 6);
    expect(pattern.points.cl_p1).toBeUndefined();
    expect(pattern.points.cl_p2).toBeUndefined();
    expect(pattern.seams.seam_mid.a.edgeId).toBe('cl_e0');
    expect(pattern.seams.seam_mid.a.t0).toBeCloseTo(0.475, 10);
    expect(pattern.seams.seam_mid.a.t1).toBeCloseTo(0.625, 10);
    expect(pattern.seams.seam_mid.a.anchorT).toBeCloseTo(0.55, 10);
    expect(pattern.seams.seam_head.a).toMatchObject({ edgeId: 'cl_e0', t0: 0 });
    expect(pattern.seams.seam_head.a.t1).toBeCloseTo(0.4, 10);
    expect(pattern.seams.seam_tail.a.t0).toBeCloseTo(0.7, 10);
    expect(pattern.seams.seam_tail.a.t1).toBe(1);
    cmd.undo(ctx);
    expect(outlineOf(pattern, 'cl_panel')).toHaveLength(6);
    expect(edgeLength(pattern, 'cl_e0')).toBeCloseTo(4, 6);
    expect(pattern.seams.seam_mid.a.edgeId).toBe('cl_e1');
  });

  it('rejects a chain that is not straight', () => {
    const pattern = createEmptyPattern();
    addPanel(pattern, 'bend', [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }]);
    const ctx = ctxOf(pattern);
    expect(() => new MergeCollinearEdgesCommand(['bend_e0', 'bend_e1']).execute(ctx)).toThrow(/同一直线/);
  });
});

describe('SimplifyCurveCommand', () => {
  it('refits an arc polyline with fewer cubic edges inside the tolerance', () => {
    const { ctx, chain } = arcPanelCtx(6, 30);
    const pattern = ctx.project.pattern;
    const before = outlineOf(pattern, 'arc_panel');
    const cmd = new SimplifyCurveCommand(chain);
    cmd.execute(ctx);
    expect(validatePattern(pattern)).toEqual([]);
    const after = outlineOf(pattern, 'arc_panel');
    expect(after).toHaveLength(before.length - chain.length + 1);
    const fitted = after.slice(1, after.length - 1);
    for (const id of fitted) {
      expect(pattern.edges[id].type).toBe('bezier');
      const mid = pointAtT(pattern, id, 0.5)!;
      expect(Math.abs(Math.hypot(mid.x, mid.y) - 10)).toBeLessThan(0.05);
      expect(pattern.points[pattern.edges[id].startPointId].handleOut).toBeDefined();
      expect(pattern.points[pattern.edges[id].endPointId].handleIn).toBeDefined();
    }
    expect(edgeLength(pattern, 'arc_e0')).toBeCloseTo(10, 6);
    cmd.undo(ctx);
    expect(outlineOf(pattern, 'arc_panel')).toEqual(before);
  });

  it('refits a bezier chain inside the tolerance', () => {
    const pattern = createEmptyPattern();
    const ctx = ctxOf(pattern);
    new CreateEllipseCommand(8, 8, { x: 0, y: 0 }).execute(ctx);
    const panel = Object.values(pattern.panels)[0];
    const chain = outlineOf(pattern, panel.id).slice(0, 3);
    new SimplifyCurveCommand(chain, { maxDeviationCm: 0.5 }).execute(ctx);
    expect(validatePattern(pattern)).toEqual([]);
    const after = outlineOf(pattern, panel.id);
    expect(after).toHaveLength(3);
    for (const id of after) {
      if (pattern.edges[id].type !== 'bezier') continue;
      const mid = pointAtT(pattern, id, 0.5)!;
      expect(Math.abs(Math.hypot(mid.x, mid.y) - 8)).toBeLessThan(0.5);
    }
  });

  it('honours a target control count', () => {
    const { ctx, chain } = arcPanelCtx(6, 30);
    const pattern = ctx.project.pattern;
    new SimplifyCurveCommand(chain, { maxControls: 2 }).execute(ctx);
    expect(validatePattern(pattern)).toEqual([]);
    expect(outlineOf(pattern, 'arc_panel')).toHaveLength(3);
  });

  it('turns a circular bezier edge into an arc', () => {
    const pattern = createEmptyPattern();
    const ctx = ctxOf(pattern);
    new CreateEllipseCommand(5, 5, { x: 0, y: 0 }).execute(ctx);
    const panel = Object.values(pattern.panels)[0];
    const edgeId = outlineOf(pattern, panel.id)[0];
    const cmd = new SimplifyCurveCommand([edgeId]);
    cmd.execute(ctx);
    expect(pattern.edges[edgeId].type).toBe('arc');
    expect(Math.abs(edgeLength(pattern, edgeId) - Math.PI * 5 / 2)).toBeLessThan(0.05);
    expect(validatePattern(pattern)).toEqual([]);
    cmd.undo(ctx);
    expect(pattern.edges[edgeId].type).toBe('bezier');
  });

  it('rejects a tolerance that allows no reduction', () => {
    const pattern = createEmptyPattern();
    const panelId = addPanel(pattern, 'bend', [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]);
    const ctx = ctxOf(pattern);
    const chain = outlineOf(pattern, panelId).slice(0, 2);
    const before = structuredClone(pattern);
    expect(() => new SimplifyCurveCommand(chain, { maxDeviationCm: 0.00001 }).execute(ctx)).toThrow(/减少曲线控制点/);
    expect(pattern).toEqual(before);
  });

  it('rejects a target control count below the chain ends', () => {
    const { ctx, chain } = arcPanelCtx(6, 30);
    expect(() => new SimplifyCurveCommand(chain, { maxControls: 1 }).execute(ctx)).toThrow(/目标点数/);
  });

  it('rejects a curve that is neither a line nor an arc', () => {
    const pattern = createEmptyPattern();
    addPanel(pattern, 'wave', [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 5 }]);
    const edge = pattern.edges.wave_e0;
    edge.type = 'bezier';
    pattern.points[edge.startPointId].kind = 'smooth';
    pattern.points[edge.startPointId].handleOut = { x: 14, y: 12 };
    pattern.points[edge.endPointId].kind = 'smooth';
    pattern.points[edge.endPointId].handleIn = { x: 8, y: -6 };
    const ctx = ctxOf(pattern);
    expect(() => new SimplifyCurveCommand([edge.id]).execute(ctx)).toThrow(/无法简化曲线/);
  });
});

describe('OffsetInternalLineCommand', () => {
  it('copies an outline edge inward at each distance', () => {
    const { ctx, panelId } = squareCtx(10);
    const pattern = ctx.project.pattern;
    const edgeId = outlineOf(pattern, panelId)[0];
    const cmd = new OffsetInternalLineCommand(edgeId, [2, 3], { kind: 'fold' });
    cmd.execute(ctx);
    expect(validatePattern(pattern)).toEqual([]);
    const lines = pattern.panels[panelId].internalLineIds.map(id => pattern.internalLines[id]);
    expect(lines).toHaveLength(2);
    expect(lines[0].kind).toBe('fold');
    expect(lines.map(l => l.points[0].y)).toEqual([2, 3]);
    expect(lines[1].points.map(p => p.x)).toEqual([0, 10]);
    cmd.undo(ctx);
    expect(pattern.panels[panelId].internalLineIds).toEqual([]);
  });

  it('rejects an offset that leaves the panel', () => {
    const { ctx, panelId } = squareCtx(10);
    const edgeId = outlineOf(ctx.project.pattern, panelId)[0];
    expect(() => new OffsetInternalLineCommand(edgeId, [20]).execute(ctx)).toThrow(/超出版片轮廓/);
  });
});

describe('PanelFromInternalLoopCommand', () => {
  it('cuts the loop out and stitches the new panel to it', () => {
    const { ctx, panelId } = squareCtx(20);
    const pattern = ctx.project.pattern;
    const loop: Vec2[] = [{ x: 5, y: 5 }, { x: 10, y: 5 }, { x: 10, y: 10 }, { x: 5, y: 10 }, { x: 5, y: 5 }];
    new AddInternalLineCommand(panelId, loop, 'split').execute(ctx);
    const lineId = pattern.panels[panelId].internalLineIds[0];
    const cmd = new PanelFromInternalLoopCommand(panelId, lineId);
    cmd.execute(ctx);
    expect(validatePattern(pattern)).toEqual([]);
    const source = pattern.panels[panelId];
    expect(source.holes).toHaveLength(1);
    expect(source.holes![0]).toHaveLength(4);
    const created = pattern.panels[cmd.newPanelId];
    expect(created.outlineEdgeIds).toHaveLength(4);
    const sourceMaxX = Math.max(...samplePanelOutline(pattern, source).map(p => p.x));
    expect(Math.min(...samplePanelOutline(pattern, created).map(p => p.x))).toBeGreaterThan(sourceMaxX);
    const seams = Object.values(pattern.seams);
    expect(seams).toHaveLength(4);
    expect(seams.every(s => s.flip)).toBe(true);
    expect(seams.every(s => created.outlineEdgeIds.includes(s.a.edgeId))).toBe(true);
    expect(seams.every(s => source.holes![0].includes(s.b.edgeId))).toBe(true);
    expect(pattern.internalLines[lineId].kind).toBe('split');
    const newPanelId = cmd.newPanelId;
    cmd.undo(ctx);
    expect(pattern.panels[newPanelId]).toBeUndefined();
    expect(pattern.panels[panelId].holes).toBeUndefined();
    expect(Object.values(pattern.seams)).toHaveLength(0);
  });

  it('rejects an open internal line', () => {
    const { ctx, panelId } = squareCtx(20);
    const pattern = ctx.project.pattern;
    new AddInternalLineCommand(panelId, [{ x: 5, y: 5 }, { x: 10, y: 10 }], 'split').execute(ctx);
    const lineId = pattern.panels[panelId].internalLineIds[0];
    expect(() => new PanelFromInternalLoopCommand(panelId, lineId).execute(ctx)).toThrow(/闭合环/);
  });
});

describe('RhombusDartCommand', () => {
  it('adds a diamond dart whose legs are outline edges', () => {
    const { ctx, panelId } = squareCtx(10);
    const pattern = ctx.project.pattern;
    const edgeId = outlineOf(pattern, panelId)[0];
    pattern.seams.seam_base = {
      id: 'seam_base', type: 'free',
      a: { edgeId, t0: 0.75, t1: 1 }, b: { edgeId: 'sq_e2', t0: 0, t1: 1 },
      flip: false, strength: 0.8, threadColor: '#f00', stitchVisible: true,
    };
    const cmd = new RhombusDartCommand(panelId, edgeId, 0.5, 2, 3);
    cmd.execute(ctx);
    expect(validatePattern(pattern)).toEqual([]);
    const panel = pattern.panels[panelId];
    expect(panel.outlineEdgeIds).toHaveLength(7);
    expect(panel.dartIds).toEqual([cmd.dartId]);
    expect(panel.internalLineIds).toHaveLength(2);
    const dart = pattern.darts[cmd.dartId];
    expect(dart.intakeCm).toBe(2);
    expect(panel.outlineEdgeIds).toContain(dart.edge1Id);
    expect(panel.outlineEdgeIds).toContain(dart.edge2Id);
    expect(pattern.points[dart.tipId].pos).toEqual({ x: 5, y: 3 });
    expect(edgeLength(pattern, dart.edge1Id)).toBeCloseTo(Math.hypot(1, 3), 6);
    expect(pattern.internalLines[panel.internalLineIds[0]].points).toHaveLength(2);
    expect(pattern.seams.seam_base.a.t0).toBe(0.75);
    expect(panel.outlineEdgeIds).toContain(pattern.seams.seam_base.a.edgeId);
    cmd.undo(ctx);
    expect(outlineOf(pattern, panelId)).toHaveLength(4);
    expect(Object.keys(pattern.darts)).toEqual([]);
  });

  it('rejects an intake wider than the edge', () => {
    const { ctx, panelId } = squareCtx(10);
    const edgeId = outlineOf(ctx.project.pattern, panelId)[0];
    const before = structuredClone(ctx.project.pattern);
    expect(() => new RhombusDartCommand(panelId, edgeId, 0.5, 24, 3).execute(ctx)).toThrow(/省量超出边长/);
    expect(ctx.project.pattern).toEqual(before);
  });
});

describe('SetArcParamsCommand', () => {
  it('changes the radius while both endpoints stay put', () => {
    const { ctx } = circleCtx();
    const pattern = ctx.project.pattern;
    const panelId = Object.values(pattern.panels)[0].id;
    const edgeId = outlineOf(pattern, panelId)[0];
    const edge = pattern.edges[edgeId];
    const start = structuredClone(pattern.points[edge.startPointId].pos);
    const end = structuredClone(pattern.points[edge.endPointId].pos);
    const before = structuredClone(pattern);

    const cmd = new SetArcParamsCommand(edgeId, { radiusCm: 9 });
    cmd.execute(ctx);
    expect(validatePattern(pattern)).toEqual([]);
    expect(pattern.points[edge.startPointId].pos).toEqual(start);
    expect(pattern.points[edge.endPointId].pos).toEqual(end);
    expect(edge.arc!.radius).toBeCloseTo(9, 9);
    expect(distance(edge.arc!.center, start)).toBeCloseTo(9, 9);
    expect(distance(edge.arc!.center, end)).toBeCloseTo(9, 9);

    cmd.undo(ctx);
    expect(pattern).toEqual(before);
  });

  it('keeps a clockwise arc clockwise when the center angle changes', () => {
    const pattern = createEmptyPattern();
    const points = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    points.forEach((pos, i) => { pattern.points[`p${i}`] = { id: `p${i}`, pos }; });
    for (let i = 1; i < 4; i++) {
      pattern.edges[`e${i}`] = { id: `e${i}`, type: 'line', startPointId: `p${i}`, endPointId: `p${(i + 1) % 4}` };
    }
    pattern.edges.e0 = { id: 'e0', type: 'arc', startPointId: 'p0', endPointId: 'p1', arc: arcFromThreePoints(points[0], { x: 5, y: 2 }, points[1])! };
    pattern.panels.panel = {
      id: 'panel', name: '逆向弧', outlineEdgeIds: ['e0', 'e1', 'e2', 'e3'], dartIds: [], internalLineIds: [],
      seamAllowanceCm: 0, fabricId: 'f', meshResolutionCm: 3, visible: true, locked: false,
    };
    const ctx = ctxOf(pattern);
    const edge = pattern.edges.e0;
    expect(edge.arc!.ccw).toBe(false);
    const start = structuredClone(pattern.points.p0.pos);
    const end = structuredClone(pattern.points.p1.pos);

    new SetArcParamsCommand('e0', { sweepDeg: 120 }).execute(ctx);
    expect(validatePattern(pattern)).toEqual([]);
    expect(edge.arc!.ccw).toBe(false);
    expect(arcSpan(edge.arc!)).toBeLessThan(0);
    expect(Math.abs(arcSpan(edge.arc!)) * 180 / Math.PI).toBeCloseTo(120, 6);
    expect(pattern.points.p0.pos).toEqual(start);
    expect(pattern.points.p1.pos).toEqual(end);
    expect(distance(edge.arc!.center, start)).toBeCloseTo(edge.arc!.radius, 9);
  });

  it('clamps a radius below half the chord and rejects invalid values', () => {
    const { ctx } = circleCtx();
    const pattern = ctx.project.pattern;
    const panelId = Object.values(pattern.panels)[0].id;
    const edgeId = outlineOf(pattern, panelId)[0];
    const edge = pattern.edges[edgeId];
    const start = pattern.points[edge.startPointId].pos;
    const end = pattern.points[edge.endPointId].pos;
    const chord = distance(start, end);

    new SetArcParamsCommand(edgeId, { radiusCm: 0.1 }).execute(ctx);
    expect(edge.arc!.radius).toBeCloseTo(chord / 2, 9);
    expect(Math.abs(arcSpan(edge.arc!))).toBeCloseTo(Math.PI, 9);

    const before = structuredClone(pattern);
    expect(() => new SetArcParamsCommand(edgeId, { radiusCm: 0 }).execute(ctx)).toThrow(/半径/);
    expect(() => new SetArcParamsCommand(edgeId, { sweepDeg: 360 }).execute(ctx)).toThrow(/圆心角/);
    expect(() => new SetArcParamsCommand(edgeId, {}).execute(ctx)).toThrow(/只/);
    expect(() => new SetArcParamsCommand('missing_edge', { radiusCm: 4 }).execute(ctx)).toThrow(/边不存在/);
    expect(pattern).toEqual(before);
  });
});

describe('advanced command labels', () => {
  it('are Chinese menu labels', () => {
    expect(new BreakPointCommand('x').label).toBe('断开顶点');
    expect(new ConnectPointsCommand('x', 'y').label).toBe('连接端点');
    expect(new SetEdgeLengthCommand('x', 1).label).toBe('修改边长');
    expect(new SetEdgeAngleCommand('x', 'y', 30).label).toBe('修改边夹角');
    expect(new MergeCollinearEdgesCommand(['x']).label).toBe('合并共线边');
    expect(new SimplifyCurveCommand(['x']).label).toBe('简化曲线');
    expect(new OffsetInternalLineCommand('x', [1]).label).toBe('生成等距内部线');
    expect(new PanelFromInternalLoopCommand('x', 'y').label).toBe('内部线成片');
    expect(new RhombusDartCommand('x', 'y', 0.5, 2, 3).label).toBe('创建菱形省');
  });
});

/** Sampling stays continuous across the rebuilt outline. */
describe('merged outline sampling', () => {
  it('keeps one straight run over the merged edge', () => {
    const { ctx, chain } = collinearCtx();
    new MergeCollinearEdgesCommand(chain).execute(ctx);
    const pattern = ctx.project.pattern;
    const pts = outlineOf(pattern, 'cl_panel').flatMap(id => sampleEdge(pattern, id));
    expect(pts.length).toBeGreaterThan(3);
    expect(edgeLength(pattern, outlineOf(pattern, 'cl_panel')[0])).toBeCloseTo(10, 6);
  });
});
