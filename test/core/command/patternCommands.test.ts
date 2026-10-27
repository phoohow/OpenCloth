import { describe, it, expect } from 'vitest';
import { vec2, type Pattern, type Project } from '../../../src/core/model/types';
import { createDefaultProject } from '../../../src/core/model/defaults';
import { generateTShirt } from '../../../src/pattern/template/tShirtTemplate';
import { samplePanelOutline } from '../../../src/pattern/panel/panelBuilder';
import type { ProjectContext } from '../../../src/core/command/command';
import {
  AddPointOnEdgeCommand, DeleteSelectionCommand, MovePanelsCommand, MovePointsCommand,
  panelMoveGeometry, previewMove,
} from '../../../src/core/command/patternCommands';

function makeCtx(project: Project): ProjectContext {
  return { project };
}

function projectWithPattern(pattern: Pattern): Project {
  const project = createDefaultProject();
  project.pattern = pattern;
  return project;
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
    // Edge p1 -> p2 with c0 exactly at p1.
    pattern.edges['e1'] = {
      id: 'e1', type: 'bezier', startPointId: 'p1', endPointId: 'p2',
      bezier: { c0: vec2(1, 0), c1: vec2(6, 5) },
    };
    const ctx = makeCtx(projectWithPattern(pattern));

    const cmd = new MovePointsCommand(new Map([['p1', vec2(2, 1)]]));
    cmd.execute(ctx);
    expect(pattern.edges.e1.bezier!.c0).toEqual({ x: 3, y: 1 });
    expect(pattern.edges.e1.bezier!.c1).toEqual({ x: 6, y: 5 });

    cmd.undo(ctx);
    expect(pattern.edges.e1.bezier!.c0).toEqual({ x: 1, y: 0 });
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
    const handlesBefore = { ...capEdge.bezier! };
    pattern.darts['d1'] = { id: 'd1', tipId: 'tip1', edge1Id: capEdge.id, edge2Id: capEdge.id, intakeCm: 2 };
    pattern.points['tip1'] = { id: 'tip1', pos: vec2(0, 0) };
    pattern.internalLines['l1'] = { id: 'l1', kind: 'fold', points: [vec2(3, 3), vec2(4, 9)] };
    panel.dartIds = ['d1'];
    panel.internalLineIds = ['l1'];
    const ctx = makeCtx(projectWithPattern(pattern));

    new MovePanelsCommand([panel.id], vec2(10, 0)).execute(ctx);

    expect(pattern.points.tip1.pos).toEqual({ x: 10, y: 0 });
    expect(capEdge.bezier!.c0).toEqual({ x: handlesBefore.c0.x + 10, y: handlesBefore.c0.y });
    expect(capEdge.bezier!.c1).toEqual({ x: handlesBefore.c1.x + 10, y: handlesBefore.c1.y });
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

  it('rejects bezier edges', () => {
    const pattern = createEmptyTestPattern();
    pattern.edges['e1'] = {
      id: 'e1', type: 'bezier', startPointId: 'p1', endPointId: 'p2',
      bezier: { c0: vec2(1, 1), c1: vec2(2, 2) },
    };
    const ctx = makeCtx(projectWithPattern(pattern));
    expect(() => new AddPointOnEdgeCommand('e1', vec2(3, 0)).execute(ctx))
      .toThrow(/贝塞尔/);
  });

  it('reattaches seams referencing the removed edge', () => {
    const pattern = createEmptyTestPattern();
    pattern.edges['e1'] = { id: 'e1', type: 'line', startPointId: 'p1', endPointId: 'p2' };
    pattern.seams['s1'] = {
      id: 's1', type: 'normal', edgeAId: 'e1', edgeBId: 'e1',
      flipB: false, strength: 1, threadColor: '#f00', stitchVisible: true,
    };
    const ctx = makeCtx(projectWithPattern(pattern));

    const cmd = new AddPointOnEdgeCommand('e1', vec2(3, 0));
    cmd.execute(ctx);
    expect(pattern.seams.s1.edgeAId).not.toBe('e1');

    cmd.undo(ctx);
    expect(pattern.seams.s1.edgeAId).toBe('e1');
    expect(pattern.seams.s1.edgeBId).toBe('e1');
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
