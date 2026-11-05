import { describe, it, expect } from 'vitest';
import { vec2, type ArcGeom, type Pattern, type Project, type Vec2 } from '@/model/types';
import { createDefaultProject } from '@/model/defaults';
import { generateTShirt } from '@/pattern/template/tShirtTemplate';
import { panelCutBounds, samplePanelOutline } from '@/pattern/panel/panelBuilder';
import type { ProjectContext } from '@/commands/command';
import {
  AddPointOnEdgeCommand, DeleteSelectionCommand, MoveGeometryCommand, MovePanelsCommand,
  MovePanelsHeightCommand, MovePointsCommand, edgePointIds, movePanelsCommands, panelMoveGeometry,
  pointMoveGeometry, previewMove, previewPanelMove,
} from '@/commands/patternCommands';
import { arcFromThreePoints, evalArc } from '@/common/geom';

function makeCtx(project: Project): ProjectContext {
  return { project };
}

function projectWithPattern(pattern: Pattern): Project {
  const project = createDefaultProject();
  project.pattern = pattern;
  return project;
}

/** Outline vertex of a panel that sits highest in the pattern. */
function topVertexOf(pattern: Pattern, panel: Pattern['panels'][string]): string {
  return panel.outlineEdgeIds
    .flatMap(edgeId => [pattern.edges[edgeId]!.startPointId, pattern.edges[edgeId]!.endPointId])
    .reduce((best, id) => (pattern.points[id]!.pos.y > pattern.points[best]!.pos.y ? id : best));
}

describe('MovePointsCommand', () => {
  it('moves the point and restores it on undo', () => {
    const pattern = createEmptyTestPattern();
    const project = projectWithPattern(pattern);
    const ctx = makeCtx(project);

    const cmd = new MovePointsCommand(new Map([['p1', vec2(2, 1)]]));
    cmd.execute(ctx);
    expect(project.pattern.points.p1.pos).toEqual({ x: 3, y: 1 });

    cmd.undo(ctx);
    expect(project.pattern.points.p1.pos).toEqual({ x: 1, y: 0 });
  });

  it('moves a coincident bezier handle anchored at the point', () => {
    const pattern = createEmptyTestPattern();
    // Bezier edge p1 -> p2 with c0 exactly at p1.
    pattern.edges['e1'] = { id: 'e1', type: 'bezier', startPointId: 'p1', endPointId: 'p2' };
    pattern.points.p1 = { id: 'p1', pos: vec2(1, 0), kind: 'smooth', handleOut: { x: 1, y: 0 } };
    pattern.points.p2 = { id: 'p2', pos: vec2(5, 0), kind: 'smooth', handleIn: { x: 6, y: 5 } };
    const ctx = makeCtx(projectWithPattern(pattern));

    const cmd = new MovePointsCommand(new Map([['p1', vec2(2, 1)]]));
    cmd.execute(ctx);
    expect(pattern.points.p1.handleOut).toEqual({ x: 3, y: 1 });
    expect(pattern.points.p2.handleIn).toEqual({ x: 6, y: 5 });

    cmd.undo(ctx);
    expect(pattern.points.p1.handleOut).toEqual({ x: 1, y: 0 });
  });

  it('moves coincident internal-line vertices of panels owning the point', () => {
    const pattern = createEmptyTestPattern();
    pattern.panels['panel1'].internalLineIds = ['line1'];
    pattern.internalLines['line1'] = { id: 'line1', kind: 'fold', points: [vec2(1, 0), vec2(4, 5)] };
    pattern.edges['e1'] = { id: 'e1', type: 'line', startPointId: 'p1', endPointId: 'p2' };
    pattern.panels['panel1'].outlineEdgeIds = ['e1'];
    const ctx = makeCtx(projectWithPattern(pattern));

    const cmd = new MovePointsCommand(new Map([['p1', vec2(0, 3)]]));
    cmd.execute(ctx);
    expect(pattern.internalLines.line1.points[0]).toEqual({ x: 1, y: 3 });
    expect(pattern.internalLines.line1.points[1]).toEqual({ x: 4, y: 5 });

    cmd.undo(ctx);
    expect(pattern.internalLines.line1.points[0]).toEqual({ x: 1, y: 0 });
  });

  it('keeps a draped panel in place when its top vertex moves', () => {
    const pattern = generateTShirt();
    const front = Object.values(pattern.panels).find(p => p.name === '前片')!;
    const topId = topVertexOf(pattern, front);
    const topBefore = panelCutBounds(pattern, front).max.y;
    const anchorBefore = front.drape!.anchorOffsetCm ?? 0;
    const ctx = makeCtx(projectWithPattern(pattern));

    new MovePointsCommand(new Map([[topId, vec2(0, 5)]])).execute(ctx);

    // The drape anchor rides the top edge, so the panel keeps the height it is drawn at.
    const grew = panelCutBounds(pattern, front).max.y - topBefore;
    expect(grew).toBeGreaterThan(0);
    expect(front.drape!.anchorOffsetCm).toBeCloseTo(anchorBefore + grew, 6);
    expect(panelCutBounds(pattern, front).max.y - (front.drape!.anchorOffsetCm ?? 0))
      .toBeCloseTo(topBefore - anchorBefore, 6);
  });

  it('restores the drape anchor on undo', () => {
    const pattern = generateTShirt();
    const front = Object.values(pattern.panels).find(p => p.name === '前片')!;
    const topId = topVertexOf(pattern, front);
    const anchorBefore = front.drape!.anchorOffsetCm;
    const ctx = makeCtx(projectWithPattern(pattern));
    const cmd = new MovePointsCommand(new Map([[topId, vec2(0, 5)]]));

    cmd.execute(ctx);
    expect(front.drape!.anchorOffsetCm).not.toBe(anchorBefore);

    cmd.undo(ctx);
    expect(front.drape!.anchorOffsetCm).toBe(anchorBefore);
  });

  it('previews a point move with the same drape anchor as the commit', () => {
    const pattern = generateTShirt();
    const front = Object.values(pattern.panels).find(p => p.name === '前片')!;
    const topId = topVertexOf(pattern, front);
    const ctx = makeCtx(projectWithPattern(pattern));
    const delta = vec2(0, 4);

    const previewed = previewMove(pattern, pointMoveGeometry(pattern, [topId]), delta, { keepDrapeHeight: true });
    new MovePointsCommand(new Map([[topId, delta]])).execute(ctx);

    expect(previewed).toEqual(ctx.project.pattern);
  });
});

describe('MovePanelsCommand', () => {
  it('translates a curved panel outline as a rigid body', () => {
    const pattern = generateTShirt();
    const panel = Object.values(pattern.panels).find(p => p.name === '前片')!;
    const before = samplePanelOutline(pattern, panel);
    const ctx = makeCtx(projectWithPattern(pattern));
    const delta = vec2(5, 0);

    new MovePanelsCommand([panel.id], delta).execute(ctx);

    const after = samplePanelOutline(pattern, panel);
    expect(after).toHaveLength(before.length);
    for (let i = 0; i < after.length; i++) {
      expect(after[i].x).toBeCloseTo(before[i].x + delta.x, 6);
      expect(after[i].y).toBeCloseTo(before[i].y, 6);
    }
  });

  it('moves offset bezier handles, dart tips and internal-line vertices', () => {
    const pattern = generateTShirt();
    const panel = Object.values(pattern.panels).find(p => p.name === '右袖')!;
    const capEdge = pattern.edges[panel.outlineEdgeIds[3]];
    const capStart = pattern.points[capEdge.startPointId];
    const capEnd = pattern.points[capEdge.endPointId];
    const handlesBefore = { out: { ...capStart.handleOut! }, in: { ...capEnd.handleIn! } };
    pattern.darts['d1'] = { id: 'd1', tipId: 'tip1', edge1Id: capEdge.id, edge2Id: capEdge.id, intakeCm: 2 };
    pattern.points['tip1'] = { id: 'tip1', pos: vec2(0, 0) };
    pattern.internalLines['l1'] = { id: 'l1', kind: 'fold', points: [vec2(3, 3), vec2(4, 9)] };
    panel.dartIds = ['d1'];
    panel.internalLineIds = ['l1'];
    const ctx = makeCtx(projectWithPattern(pattern));

    new MovePanelsCommand([panel.id], vec2(10, 0)).execute(ctx);

    expect(pattern.points.tip1.pos).toEqual({ x: 10, y: 0 });
    expect(capStart.handleOut).toEqual({ x: handlesBefore.out.x + 10, y: handlesBefore.out.y });
    expect(capEnd.handleIn).toEqual({ x: handlesBefore.in.x + 10, y: handlesBefore.in.y });
    expect(pattern.internalLines.l1.points).toEqual([vec2(13, 3), vec2(14, 9)]);
  });

  it('leaves unselected panels untouched and restores everything on undo', () => {
    const pattern = generateTShirt();
    const front = Object.values(pattern.panels).find(p => p.name === '前片')!;
    const back = Object.values(pattern.panels).find(p => p.name === '后片')!;
    const frontBefore = samplePanelOutline(pattern, front);
    const backBefore = samplePanelOutline(pattern, back);
    const ctx = makeCtx(projectWithPattern(pattern));
    const cmd = new MovePanelsCommand([front.id], vec2(7, -3));

    cmd.execute(ctx);
    expect(samplePanelOutline(pattern, back)).toEqual(backBefore);

    cmd.undo(ctx);
    expect(samplePanelOutline(pattern, front)).toEqual(frontBefore);
    expect(samplePanelOutline(pattern, back)).toEqual(backBefore);
  });

  it('previewMove matches the committed result', () => {
    const pattern = generateTShirt();
    const panel = Object.values(pattern.panels).find(p => p.name === '左袖')!;
    const ctx = makeCtx(projectWithPattern(pattern));
    const delta = vec2(-4, 6);
    const geom = panelMoveGeometry(pattern, [panel.id]);

    const previewed = previewMove(pattern, geom, delta);
    new MovePanelsCommand([panel.id], delta).execute(ctx);

    expect(previewed).toEqual(ctx.project.pattern);
  });
});

describe('movePanelsCommands', () => {
  /** A draped panel on edge e1 (p3 -> p4) and a plain panel on edge e2 (p1 -> p2). */
  function drapedAndFlat(): Project {
    const pattern = createEmptyTestPattern();
    pattern.points.p4 = { id: 'p4', pos: vec2(0, 4) };
    pattern.edges.e1 = { id: 'e1', type: 'line', startPointId: 'p3', endPointId: 'p4' };
    pattern.edges.e2 = { id: 'e2', type: 'line', startPointId: 'p1', endPointId: 'p2' };
    pattern.panels.panel1!.outlineEdgeIds = ['e1'];
    pattern.panels.panel1!.drape = { region: 'torso', anchor: 'waist' };
    pattern.panels.panel2!.outlineEdgeIds = ['e2'];
    return projectWithPattern(pattern);
  }

  it('moves a draped panel horizontally in the pattern and vertically on the body', () => {
    const project = drapedAndFlat();
    const ctx = makeCtx(project);

    for (const command of movePanelsCommands(project.pattern, ['panel1'], vec2(3, 5))) command.execute(ctx);

    expect(project.pattern.points.p3!.pos).toEqual({ x: 8, y: 4 });
    expect(project.pattern.points.p4!.pos).toEqual({ x: 3, y: 4 });
    expect(project.pattern.panels.panel1!.drape!.anchorOffsetCm).toBe(5);
  });

  it('translates a panel without a drape as one rigid piece', () => {
    const project = drapedAndFlat();
    const ctx = makeCtx(project);

    for (const command of movePanelsCommands(project.pattern, ['panel2'], vec2(3, 5))) command.execute(ctx);

    expect(project.pattern.points.p1!.pos).toEqual({ x: 4, y: 5 });
    expect(project.pattern.points.p2!.pos).toEqual({ x: 8, y: 5 });
    expect(project.pattern.panels.panel2!.drape).toBeUndefined();
  });

  it('restores the drape height on undo', () => {
    const project = drapedAndFlat();
    const ctx = makeCtx(project);
    const command = new MovePanelsHeightCommand(['panel1'], -4);

    command.execute(ctx);
    expect(project.pattern.panels.panel1!.drape!.anchorOffsetCm).toBe(-4);
    command.undo(ctx);
    expect(project.pattern.panels.panel1!.drape!.anchorOffsetCm).toBe(0);
  });

  it('previews the same split without touching the model', () => {
    const project = drapedAndFlat();
    const preview = previewPanelMove(project.pattern, ['panel1', 'panel2'], vec2(3, 5));

    expect(project.pattern.points.p3!.pos).toEqual({ x: 5, y: 4 });
    expect(project.pattern.panels.panel1!.drape!.anchorOffsetCm).toBeUndefined();
    expect(preview.points.p3!.pos).toEqual({ x: 8, y: 4 });
    expect(preview.points.p1!.pos).toEqual({ x: 4, y: 5 });
    expect(preview.panels.panel1!.drape!.anchorOffsetCm).toBe(5);
  });
});

describe('arc edges follow their endpoints', () => {
  it('refits through the previous midpoint when one end moves', () => {
    const pattern = arcTestPattern();
    const original = pattern.edges.e1.arc!;
    const ctx = makeCtx(projectWithPattern(pattern));
    const cmd = new MovePointsCommand(new Map([['p1', vec2(0, 3)]]));

    cmd.execute(ctx);

    expect(pattern.edges.e1.type).toBe('arc');
    const arc = pattern.edges.e1.arc!;
    assertOn(arc, 0, pattern.points.p1.pos);
    assertOn(arc, 1, pattern.points.p2.pos);
    expect(Math.hypot(3 - arc.center.x, 2 - arc.center.y)).toBeCloseTo(arc.radius, 9);

    cmd.undo(ctx);
    expect(pattern.edges.e1.arc).toEqual(original);
  });

  it('stays rigid when the whole panel moves', () => {
    const pattern = arcTestPattern();
    const before = pattern.edges.e1.arc!;
    const ctx = makeCtx(projectWithPattern(pattern));

    new MovePanelsCommand(['panel1'], vec2(10, 0)).execute(ctx);

    const after = pattern.edges.e1.arc!;
    expect(after.radius).toBeCloseTo(before.radius, 9);
    expect(after.center).toEqual({ x: before.center.x + 10, y: before.center.y });
    assertOn(after, 0.5, { x: 13, y: 2 });
    assertOn(after, 0, pattern.points.p1.pos);
    assertOn(after, 1, pattern.points.p2.pos);
  });

  it('becomes a straight edge when the ends line up with the midpoint, and undo restores the arc', () => {
    const pattern = arcTestPattern();
    const original = pattern.edges.e1.arc!;
    const ctx = makeCtx(projectWithPattern(pattern));
    const cmd = new MovePointsCommand(new Map([['p1', vec2(0, 4)]]));

    cmd.execute(ctx);
    expect(pattern.edges.e1.type).toBe('line');
    expect(pattern.edges.e1.arc).toBeUndefined();

    cmd.undo(ctx);
    expect(pattern.edges.e1.type).toBe('arc');
    expect(pattern.edges.e1.arc).toEqual(original);
  });

  it('previewMove carries the refit arc', () => {
    const pattern = arcTestPattern();
    const ctx = makeCtx(projectWithPattern(pattern));
    const delta = vec2(-2, 7);
    const geom = panelMoveGeometry(pattern, ['panel1']);

    const previewed = previewMove(pattern, geom, delta);
    new MovePanelsCommand(['panel1'], delta).execute(ctx);

    expect(previewed).toEqual(ctx.project.pattern);
  });
});

describe('AddPointOnEdgeCommand', () => {
  it('splits a line edge inside a panel outline', () => {
    const pattern = createEmptyTestPattern();
    pattern.edges['e1'] = { id: 'e1', type: 'line', startPointId: 'p1', endPointId: 'p2', semantic: 'hem' };
    pattern.panels['panel1'].outlineEdgeIds = ['e1'];
    const ctx = makeCtx(projectWithPattern(pattern));

    const cmd = new AddPointOnEdgeCommand('e1', vec2(3, 0));
    cmd.execute(ctx);

    expect(pattern.edges['e1']).toBeUndefined();
    const panel = pattern.panels.panel1;
    expect(panel.outlineEdgeIds).toHaveLength(2);
    const [id1, id2] = panel.outlineEdgeIds;
    expect(pattern.edges[id1].endPointId).toBe(pattern.edges[id2].startPointId);
    const newPointId = pattern.edges[id1].endPointId;
    expect(pattern.points[newPointId].pos).toEqual({ x: 3, y: 0 });
    expect(pattern.edges[id1].semantic).toBe('hem');

    cmd.undo(ctx);
    expect(panel.outlineEdgeIds).toEqual(['e1']);
    expect(pattern.edges.e1).toBeDefined();
    expect(pattern.points[newPointId]).toBeUndefined();
  });

  it('splits bezier edges preserving the curve shape', () => {
    const pattern = createEmptyTestPattern();
    pattern.edges['e1'] = { id: 'e1', type: 'bezier', startPointId: 'p1', endPointId: 'p2' };
    pattern.points.p1 = { id: 'p1', pos: vec2(1, 0), kind: 'smooth', handleOut: { x: 1, y: 1 } };
    pattern.points.p2 = { id: 'p2', pos: vec2(5, 0), kind: 'smooth', handleIn: { x: 2, y: 2 } };
    pattern.panels.panel1.outlineEdgeIds = ['e1'];
    const ctx = makeCtx(projectWithPattern(pattern));

    const cmd = new AddPointOnEdgeCommand('e1', vec2(3, 0));
    cmd.execute(ctx);
    const pieces = pattern.panels.panel1.outlineEdgeIds;
    expect(pieces).toHaveLength(2);
    expect(pieces.every(id => pattern.edges[id]?.type === 'bezier')).toBe(true);
    const midId = pattern.edges[pieces[0]!].endPointId;
    expect(pattern.points[midId]!.handleIn).toBeDefined();
    expect(pattern.points[midId]!.handleOut).toBeDefined();

    cmd.undo(ctx);
    expect(pattern.edges.e1).toBeDefined();
    expect(pattern.points[midId]).toBeUndefined();
  });

  it('reattaches seams referencing the removed edge', () => {
    const pattern = createEmptyTestPattern();
    pattern.edges['e1'] = { id: 'e1', type: 'line', startPointId: 'p1', endPointId: 'p2' };
    pattern.seams['s1'] = {
      id: 's1', type: 'normal', a: { edgeId: 'e1', t0: 0, t1: 1 }, b: { edgeId: 'e1', t0: 0, t1: 1 },
      flip: false, strength: 1, threadColor: '#f00', stitchVisible: true,
    };
    const ctx = makeCtx(projectWithPattern(pattern));

    const cmd = new AddPointOnEdgeCommand('e1', vec2(3, 0));
    cmd.execute(ctx);
    expect(pattern.seams.s1.a.edgeId).not.toBe('e1');

    cmd.undo(ctx);
    expect(pattern.seams.s1.a.edgeId).toBe('e1');
    expect(pattern.seams.s1.b.edgeId).toBe('e1');
  });
});

describe('DeleteSelectionCommand', () => {
  it('deletes an independent panel with its edges and points', () => {
    const project = projectWithPattern(generateTShirt());
    const pattern = project.pattern;
    const panelId = Object.keys(pattern.panels)[0];
    const panel = pattern.panels[panelId];
    const edgeIds = [...panel.outlineEdgeIds];
    const pointIds = new Set(edgeIds.flatMap(id => {
      const e = pattern.edges[id];
      return [e.startPointId, e.endPointId];
    }));
    const ctx = makeCtx(project);

    const cmd = new DeleteSelectionCommand([panelId]);
    cmd.execute(ctx);
    expect(ctx.project.pattern.panels[panelId]).toBeUndefined();
    expect(ctx.project.pattern.edges[edgeIds[0]]).toBeUndefined();
    for (const pid of pointIds) expect(ctx.project.pattern.points[pid]).toBeUndefined();

    cmd.undo(ctx);
    expect(ctx.project.pattern.panels[panelId]).toBeDefined();
    expect(ctx.project.pattern.edges[edgeIds[0]]).toBeDefined();
    const firstPointId = [...pointIds][0];
    expect(ctx.project.pattern.points[firstPointId]).toBeDefined();
  });

  it('throws when another panel shares an edge', () => {
    const pattern = createEmptyTestPattern();
    pattern.edges['e1'] = { id: 'e1', type: 'line', startPointId: 'p1', endPointId: 'p2' };
    pattern.panels.panel1.outlineEdgeIds = ['e1'];
    pattern.panels.panel2.outlineEdgeIds = ['e1'];
    const ctx = makeCtx(projectWithPattern(pattern));

    expect(() => new DeleteSelectionCommand(['panel1']).execute(ctx))
      .toThrow(/共用/);
    // Model untouched.
    expect(pattern.panels.panel1).toBeDefined();
    expect(pattern.edges.e1).toBeDefined();
  });

  it('throws when another panel shares only a point', () => {
    const pattern = createEmptyTestPattern();
    pattern.edges['e1'] = { id: 'e1', type: 'line', startPointId: 'p1', endPointId: 'p2' };
    pattern.edges['e2'] = { id: 'e2', type: 'line', startPointId: 'p2', endPointId: 'p3' };
    pattern.panels.panel1.outlineEdgeIds = ['e1'];
    pattern.panels.panel2.outlineEdgeIds = ['e2'];
    const ctx = makeCtx(projectWithPattern(pattern));

    expect(() => new DeleteSelectionCommand(['panel1']).execute(ctx))
      .toThrow(/共用/);
    expect(pattern.panels.panel1).toBeDefined();
  });
});

describe('edge move', () => {
  it('lists both endpoints of the given edges once', () => {
    const pattern = createEmptyTestPattern();
    pattern.edges['e1'] = { id: 'e1', type: 'line', startPointId: 'p1', endPointId: 'p2' };
    pattern.edges['e2'] = { id: 'e2', type: 'line', startPointId: 'p2', endPointId: 'p3' };

    expect(edgePointIds(pattern, ['e1', 'e2', 'missing'])).toEqual(['p1', 'p2', 'p3']);
  });

  it('translates the points an edge hangs on and restores them on undo', () => {
    const pattern = createEmptyTestPattern();
    pattern.edges['e1'] = { id: 'e1', type: 'line', startPointId: 'p1', endPointId: 'p2' };
    const ctx = makeCtx(projectWithPattern(pattern));

    const geom = pointMoveGeometry(pattern, edgePointIds(pattern, ['e1']));
    const cmd = new MoveGeometryCommand(geom, vec2(1, 2), { keepDrapeHeight: true });
    cmd.execute(ctx);
    expect(pattern.points.p1!.pos).toEqual({ x: 2, y: 2 });
    expect(pattern.points.p2!.pos).toEqual({ x: 6, y: 2 });
    expect(pattern.points.p3!.pos).toEqual({ x: 5, y: 4 });

    cmd.undo(ctx);
    expect(pattern.points.p1!.pos).toEqual({ x: 1, y: 0 });
    expect(pattern.points.p2!.pos).toEqual({ x: 5, y: 0 });
  });

  it('shifts an arc with both ends instead of refitting it', () => {
    const pattern = arcTestPattern();
    const center = { ...pattern.edges['e1']!.arc!.center };
    const ctx = makeCtx(projectWithPattern(pattern));

    const geom = pointMoveGeometry(pattern, edgePointIds(pattern, ['e1']));
    const cmd = new MoveGeometryCommand(geom, vec2(2, 1));
    cmd.execute(ctx);

    expect(pattern.edges['e1']!.type).toBe('arc');
    expect(pattern.edges['e1']!.arc!.center).toEqual({ x: center.x + 2, y: center.y + 1 });
    expect(pattern.edges['e1']!.arc!.radius).toBeCloseTo(2, 9);
  });
});

describe('internal line vertex drag', () => {
  /** One panel holding the given internal line. */
  const linePattern = (points: Vec2[]): Pattern => {
    const pattern = createEmptyTestPattern();
    pattern.internalLines.l1 = { id: 'l1', kind: 'fold', points };
    pattern.panels.panel1!.internalLineIds = ['l1'];
    return pattern;
  };

  it('moves only the picked vertex and restores it on undo', () => {
    const pattern = linePattern([vec2(2, 2), vec2(5, 5), vec2(8, 2)]);
    const ctx = makeCtx(projectWithPattern(pattern));
    const geom = { pointIds: [], lineVertices: [{ lineId: 'l1', index: 1 }] };

    const preview = previewMove(pattern, geom, vec2(1, -2));
    expect(preview.internalLines.l1!.points[1]).toEqual(vec2(6, 3));
    expect(pattern.internalLines.l1!.points[1]).toEqual(vec2(5, 5));

    const cmd = new MoveGeometryCommand(geom, vec2(1, -2), { label: '移动内部线顶点' });
    cmd.execute(ctx);
    expect(pattern.internalLines.l1!.points).toEqual([vec2(2, 2), vec2(6, 3), vec2(8, 2)]);
    expect(pattern.points.p1!.pos).toEqual(vec2(1, 0));

    cmd.undo(ctx);
    expect(pattern.internalLines.l1!.points).toEqual([vec2(2, 2), vec2(5, 5), vec2(8, 2)]);
  });

  it('keeps a closed ring closed when either end moves', () => {
    const pattern = linePattern([vec2(2, 2), vec2(8, 2), vec2(8, 8), vec2(2, 2)]);
    const ctx = makeCtx(projectWithPattern(pattern));
    const geom = { pointIds: [], lineVertices: [{ lineId: 'l1', index: 0 }, { lineId: 'l1', index: 3 }] };

    const cmd = new MoveGeometryCommand(geom, vec2(0, 1));
    cmd.execute(ctx);
    expect(pattern.internalLines.l1!.points[0]).toEqual(vec2(2, 3));
    expect(pattern.internalLines.l1!.points[3]).toEqual(vec2(2, 3));
    expect(pattern.internalLines.l1!.points[1]).toEqual(vec2(8, 2));

    cmd.undo(ctx);
    expect(pattern.internalLines.l1!.points[0]).toEqual(vec2(2, 2));
    expect(pattern.internalLines.l1!.points[3]).toEqual(vec2(2, 2));
  });
});

/** Panel edge e1 is a semicircle from p1(1,0) to p2(5,0) through (3,2). */
function arcTestPattern(): Pattern {
  const pattern = createEmptyTestPattern();
  pattern.edges['e1'] = {
    id: 'e1', type: 'arc', startPointId: 'p1', endPointId: 'p2',
    arc: arcFromThreePoints(vec2(1, 0), vec2(3, 2), vec2(5, 0))!,
  };
  pattern.panels.panel1.outlineEdgeIds = ['e1'];
  return pattern;
}

/** Asserts the arc passes within rounding of the expected point at fraction t. */
function assertOn(arc: ArcGeom, t: number, expected: Vec2): void {
  const at = evalArc(arc, t);
  expect(at.x).toBeCloseTo(expected.x, 9);
  expect(at.y).toBeCloseTo(expected.y, 9);
}

/** Two panels plus points p1(1,0), p2(5,0), p3(5,4). */
function createEmptyTestPattern(): Pattern {
  const project = createDefaultProject();
  const pattern = project.pattern;
  pattern.points.p1 = { id: 'p1', pos: vec2(1, 0) };
  pattern.points.p2 = { id: 'p2', pos: vec2(5, 0) };
  pattern.points.p3 = { id: 'p3', pos: vec2(5, 4) };
  const mkPanel = (id: string) => {
    pattern.panels[id] = {
      id, name: id, outlineEdgeIds: [], dartIds: [], internalLineIds: [],
      seamAllowanceCm: 0, fabricId: 'f', meshResolutionCm: 3,
      visible: true, locked: false,
    };
  };
  mkPanel('panel1');
  mkPanel('panel2');
  return pattern;
}
