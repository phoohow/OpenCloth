import { describe, it, expect } from 'vitest';
import { CommandHistory, type ProjectContext } from '../../../src/core/command/command';
import type { Pattern, Vec2 } from '../../../src/core/model/types';
import { createEmptyPattern } from '../../../src/core/model/defaults';
import { validatePattern } from '../../../src/core/model/validatePattern';
import {
  AddInternalLineCommand, OutlineSplitCommand, MergePanelsCommand, OutlineHoleCommand,
  RemoveHoleCommand, CreateDartCommand, MoveDartTipCommand, TransferDartCommand,
  MirrorPanelCommand, SyncMirrorCommand, ScalePanelCommand, MovePointsCommand, SetEdgeLengthCommand,
} from '../../../src/core/command/patternCommands';
import { ctxOf, addSquare } from './fixtures';
import { computeBBox } from '../../../src/pattern/geom/vec2';
import { samplePanelOutline } from '../../../src/pattern/panel/panelBuilder';

function squareCtx(size = 10): { ctx: ProjectContext; panelId: string } {
  const p = createEmptyPattern();
  const panelId = addSquare(p, 'sq', 0, 0, size);
  return { ctx: ctxOf(p), panelId };
}

function undoRestores(ctx: ProjectContext, cmd: { execute(c: ProjectContext): void; undo(c: ProjectContext): void }): Pattern {
  const before = structuredClone(ctx.project.pattern);
  cmd.execute(ctx);
  expect(validatePattern(ctx.project.pattern)).toEqual([]);
  const after = structuredClone(ctx.project.pattern);
  cmd.undo(ctx);
  expect(ctx.project.pattern).toEqual(before);
  return after;
}

/** Outline vertex positions of one panel, in outline order. */
function outlinePoints(pattern: Pattern, panelId: string): Vec2[] {
  return pattern.panels[panelId].outlineEdgeIds.flatMap(id => {
    const edge = pattern.edges[id];
    return [pattern.points[edge.startPointId].pos, pattern.points[edge.endPointId].pos];
  }).map(pos => ({ ...pos }));
}

describe('structure commands', () => {
  it('add internal line inside the panel', () => {
    const { ctx, panelId } = squareCtx();
    undoRestores(ctx, new AddInternalLineCommand(panelId, [{ x: 3, y: 3 }, { x: 7, y: 7 }], 'fold'));
    const panel = ctx.project.pattern.panels[panelId];
    expect(panel.internalLineIds).toHaveLength(0);
  });

  it('rejects an internal line that leaves the outline', () => {
    const { ctx, panelId } = squareCtx();
    const before = structuredClone(ctx.project.pattern);
    expect(() => new AddInternalLineCommand(panelId, [{ x: 3, y: 3 }, { x: 50, y: 50 }]).execute(ctx))
      .toThrow(/轮廓内/);
    expect(ctx.project.pattern).toEqual(before);
  });

  it('split divides a panel into two', () => {
    const { ctx, panelId } = squareCtx();
    const before = structuredClone(ctx.project.pattern);
    const cmd = new OutlineSplitCommand(panelId, [{ x: 5, y: 0 }, { x: 5, y: 10 }]);
    cmd.execute(ctx);
    expect(validatePattern(ctx.project.pattern)).toEqual([]);
    expect(Object.keys(ctx.project.pattern.panels)).toHaveLength(2);
    cmd.undo(ctx);
    expect(ctx.project.pattern).toEqual(before);
  });

  it('split rejects a cut shorter than two points', () => {
    const { ctx, panelId } = squareCtx();
    const before = structuredClone(ctx.project.pattern);
    expect(() => new OutlineSplitCommand(panelId, [{ x: 5, y: 0 }]).execute(ctx)).toThrow(/2 个点/);
    expect(ctx.project.pattern).toEqual(before);
  });

  it('merge unites two overlapping panels', () => {
    const p = createEmptyPattern();
    const a = addSquare(p, 'a', 0, 0, 10);
    const b = addSquare(p, 'b', 5, 0, 10);
    const ctx = ctxOf(p);
    const before = structuredClone(p);
    const cmd = new MergePanelsCommand([a, b]);
    cmd.execute(ctx);
    expect(Object.keys(ctx.project.pattern.panels)).toHaveLength(1);
    expect(validatePattern(ctx.project.pattern)).toEqual([]);
    cmd.undo(ctx);
    expect(ctx.project.pattern).toEqual(before);
  });

  it('hole add and remove round-trips', () => {
    const { ctx, panelId } = squareCtx(20);
    const loop = [{ x: 8, y: 8 }, { x: 12, y: 8 }, { x: 12, y: 12 }, { x: 8, y: 12 }];
    const cmd = new OutlineHoleCommand(panelId, loop);
    cmd.execute(ctx);
    const panel = ctx.project.pattern.panels[panelId];
    expect(panel.holes).toHaveLength(1);
    expect(validatePattern(ctx.project.pattern)).toEqual([]);
    cmd.undo(ctx);
    expect(ctx.project.pattern.panels[panelId].holes).toBeUndefined();
    const addAgain = new OutlineHoleCommand(panelId, loop);
    addAgain.execute(ctx);
    const freshLoop = [...ctx.project.pattern.panels[panelId].holes![0]];
    const rm = new RemoveHoleCommand(panelId, freshLoop);
    rm.execute(ctx);
    expect(validatePattern(ctx.project.pattern)).toEqual([]);
    expect(ctx.project.pattern.panels[panelId].holes).toBeUndefined();
  });

  it('rejects a hole outside the outline', () => {
    const { ctx, panelId } = squareCtx(10);
    expect(() => new OutlineHoleCommand(panelId, [{ x: 20, y: 20 }, { x: 24, y: 20 }, { x: 22, y: 24 }]).execute(ctx))
      .toThrow(/轮廓内/);
  });

  it('create dart inserts a tip vertex and undoes', () => {
    const { ctx, panelId } = squareCtx();
    const panel = ctx.project.pattern.panels[panelId];
    const edge1 = panel.outlineEdgeIds[0];
    const edge2 = panel.outlineEdgeIds[1];
    const cmd = new CreateDartCommand(panelId, edge1, 0.5, edge2, 0.5, 2);
    const before = structuredClone(ctx.project.pattern);
    cmd.execute(ctx);
    expect(validatePattern(ctx.project.pattern)).toEqual([]);
    const dart = Object.values(ctx.project.pattern.darts)[0];
    expect(dart.intakeCm).toBe(2);
    expect(ctx.project.pattern.points[dart.tipId]).toBeDefined();
    cmd.undo(ctx);
    expect(ctx.project.pattern).toEqual(before);
  });

  it('move dart tip', () => {
    const { ctx, panelId } = squareCtx();
    const panel = ctx.project.pattern.panels[panelId];
    new CreateDartCommand(panelId, panel.outlineEdgeIds[0], 0.5, panel.outlineEdgeIds[1], 0.5, 2).execute(ctx);
    const dartId = Object.keys(ctx.project.pattern.darts)[0];
    undoRestores(ctx, new MoveDartTipCommand(dartId, { x: 6, y: 6 }));
  });

  it('transfer dart re-anchors a leg', () => {
    const { ctx, panelId } = squareCtx();
    const panel = ctx.project.pattern.panels[panelId];
    new CreateDartCommand(panelId, panel.outlineEdgeIds[0], 0.5, panel.outlineEdgeIds[1], 0.5, 2).execute(ctx);
    const dartId = Object.keys(ctx.project.pattern.darts)[0];
    const target = panel.outlineEdgeIds[2];
    undoRestores(ctx, new TransferDartCommand(dartId, target, 0.5));
  });

  it('mirror creates a linked panel', () => {
    const { ctx, panelId } = squareCtx();
    const cmd = new MirrorPanelCommand(panelId, 'y');
    const before = structuredClone(ctx.project.pattern);
    cmd.execute(ctx);
    expect(validatePattern(ctx.project.pattern)).toEqual([]);
    const mirrorId = cmd.mirroredPanelId;
    expect(ctx.project.pattern.panels[mirrorId].symmetry?.linkedPanelId).toBe(panelId);
    cmd.undo(ctx);
    expect(ctx.project.pattern).toEqual(before);
  });

  it('sync mirror rebuilds from the moved source', () => {
    const { ctx, panelId } = squareCtx();
    new MirrorPanelCommand(panelId, 'y').execute(ctx);
    const mirrorId = Object.values(ctx.project.pattern.panels).find(p => p.symmetry && p.id !== panelId)!.id;
    // Move a source outline vertex.
    const firstEdge = ctx.project.pattern.panels[panelId].outlineEdgeIds[0];
    const startId = ctx.project.pattern.edges[firstEdge].startPointId;
    ctx.project.pattern.points[startId].pos = { x: 1, y: 0 };
    const cmd = new SyncMirrorCommand(panelId);
    const before = structuredClone(ctx.project.pattern);
    cmd.execute(ctx);
    expect(validatePattern(ctx.project.pattern)).toEqual([]);
    const mirroredPanel = ctx.project.pattern.panels[mirrorId];
    const mirroredEdge = ctx.project.pattern.edges[mirroredPanel.outlineEdgeIds.at(-1)!];
    expect(ctx.project.pattern.points[mirroredEdge.endPointId].pos).toEqual({ x: -1, y: 0 });
    cmd.undo(ctx);
    expect(ctx.project.pattern).toEqual(before);
  });

  it('auto-syncs the mirror after a source edit and undoes both sides', () => {
    const { ctx, panelId } = squareCtx();
    new MirrorPanelCommand(panelId, 'y').execute(ctx);
    const mirrorId = Object.values(ctx.project.pattern.panels).find(p => p.symmetry && p.id !== panelId)!.id;
    const before = structuredClone(ctx.project.pattern);

    const history = new CommandHistory();
    history.execute(new MovePointsCommand(new Map([['sq_p0', { x: 1, y: 0 }]])), ctx);
    expect(validatePattern(ctx.project.pattern)).toEqual([]);
    expect(history.lastLabel).toBe('移动点');
    expect(outlinePoints(ctx.project.pattern, mirrorId)).toContainEqual({ x: -1, y: 0 });

    history.undo(ctx);
    expect(ctx.project.pattern).toEqual(before);
  });

  it('auto-syncs after a snapshot command and restores both on undo', () => {
    const { ctx, panelId } = squareCtx();
    new MirrorPanelCommand(panelId, 'y').execute(ctx);
    const mirrorId = Object.values(ctx.project.pattern.panels).find(p => p.symmetry && p.id !== panelId)!.id;
    const before = structuredClone(ctx.project.pattern);

    const cmd = new SetEdgeLengthCommand(ctx.project.pattern.panels[panelId].outlineEdgeIds[0], 12);
    cmd.execute(ctx);
    expect(validatePattern(ctx.project.pattern)).toEqual([]);
    expect(outlinePoints(ctx.project.pattern, mirrorId)).toContainEqual({ x: -12, y: 0 });

    cmd.undo(ctx);
    expect(ctx.project.pattern).toEqual(before);
  });

  it('auto-syncs the source when the mirror side is edited', () => {
    const { ctx, panelId } = squareCtx();
    new MirrorPanelCommand(panelId, 'y').execute(ctx);
    const mirrorId = Object.values(ctx.project.pattern.panels).find(p => p.symmetry && p.id !== panelId)!.id;
    const mirrorPoint = ctx.project.pattern.panels[mirrorId].outlineEdgeIds
      .map(id => ctx.project.pattern.edges[id].startPointId)
      .find(id => ctx.project.pattern.points[id].pos.x === -10)!;

    const history = new CommandHistory();
    history.execute(new MovePointsCommand(new Map([[mirrorPoint, { x: 1, y: 0 }]])), ctx);
    expect(validatePattern(ctx.project.pattern)).toEqual([]);
    expect(outlinePoints(ctx.project.pattern, panelId)).toContainEqual({ x: 9, y: 10 });
  });

  it('stops syncing once the symmetry link is removed', () => {
    const { ctx, panelId } = squareCtx();
    new MirrorPanelCommand(panelId, 'y').execute(ctx);
    const mirrorId = Object.values(ctx.project.pattern.panels).find(p => p.symmetry && p.id !== panelId)!.id;
    delete ctx.project.pattern.panels[panelId].symmetry;
    delete ctx.project.pattern.panels[mirrorId].symmetry;
    const mirrorBefore = outlinePoints(ctx.project.pattern, mirrorId);

    const history = new CommandHistory();
    history.execute(new MovePointsCommand(new Map([['sq_p0', { x: 2, y: 0 }]])), ctx);
    expect(outlinePoints(ctx.project.pattern, mirrorId)).toEqual(mirrorBefore);
  });

  it('scales a panel to the target box and undoes', () => {
    const { ctx, panelId } = squareCtx();
    const pattern = ctx.project.pattern;
    pattern.internalLines['sq_line'] = { id: 'sq_line', kind: 'decor', points: [{ x: 2, y: 2 }, { x: 8, y: 2 }] };
    pattern.panels[panelId].internalLineIds.push('sq_line');
    pattern.annotations['sq_note'] = { id: 'sq_note', panelId, text: '前中', pos: { x: 5, y: 5 }, sizeMm: 4 };

    const cmd = new ScalePanelCommand(panelId, 20, 5);
    const before = structuredClone(pattern);
    cmd.execute(ctx);
    expect(validatePattern(ctx.project.pattern)).toEqual([]);
    // Bounding box 0..10 scales about (5, 5) by x2 horizontally and y0.5 vertically.
    expect(ctx.project.pattern.points['sq_p0'].pos).toEqual({ x: -5, y: 2.5 });
    expect(ctx.project.pattern.points['sq_p2'].pos).toEqual({ x: 15, y: 7.5 });
    expect(ctx.project.pattern.internalLines['sq_line'].points).toEqual([{ x: -1, y: 3.5 }, { x: 11, y: 3.5 }]);
    expect(ctx.project.pattern.annotations['sq_note'].pos).toEqual({ x: 5, y: 5 });
    cmd.undo(ctx);
    expect(ctx.project.pattern).toEqual(before);
  });

  it('scaling a panel rescales its grading deltas', () => {
    const { ctx, panelId } = squareCtx();
    ctx.project.pattern.points['sq_p2'].grading = { size_L: { x: 2, y: 4 } };
    new ScalePanelCommand(panelId, 20, 5).execute(ctx);
    expect(ctx.project.pattern.points['sq_p2'].grading).toEqual({ size_L: { x: 4, y: 2 } });
  });

  it('arc edges only allow a uniform scale', () => {
    const { ctx, panelId } = squareCtx();
    const edge = ctx.project.pattern.edges['sq_e0'];
    edge.type = 'arc';
    edge.arc = { center: { x: 5, y: 0 }, radius: 5, startAngle: Math.PI, endAngle: 0, ccw: true };
    const before = structuredClone(ctx.project.pattern);
    expect(() => new ScalePanelCommand(panelId, 20, 5).execute(ctx)).toThrow(/等比/);
    expect(ctx.project.pattern).toEqual(before);

    const box = computeBBox(samplePanelOutline(ctx.project.pattern, ctx.project.pattern.panels[panelId]));
    const width = box.max.x - box.min.x;
    const height = box.max.y - box.min.y;
    new ScalePanelCommand(panelId, width * 2, height * 2).execute(ctx);
    expect(validatePattern(ctx.project.pattern)).toEqual([]);
    const centre = { x: (box.min.x + box.max.x) / 2, y: (box.min.y + box.max.y) / 2 };
    expect(ctx.project.pattern.edges['sq_e0'].arc!.radius).toBeCloseTo(10, 6);
    expect(ctx.project.pattern.edges['sq_e0'].arc!.center).toEqual({
      x: centre.x + (5 - centre.x) * 2,
      y: centre.y + (0 - centre.y) * 2,
    });
  });

  it('rejects a locked panel and a panel sharing vertices', () => {
    const { ctx, panelId } = squareCtx();
    ctx.project.pattern.panels[panelId].locked = true;
    expect(() => new ScalePanelCommand(panelId, 20, 20).execute(ctx)).toThrow(/锁定/);
    ctx.project.pattern.panels[panelId].locked = false;

    const other = ctx.project.pattern;
    other.edges['other_e0'] = { id: 'other_e0', type: 'line', startPointId: 'other_p0', endPointId: 'sq_p1' };
    other.points['other_p0'] = { id: 'other_p0', pos: { x: -10, y: 10 } };
    other.panels.other_panel = {
      id: 'other_panel', name: '邻片', outlineEdgeIds: ['other_e0'], dartIds: [], internalLineIds: [],
      seamAllowanceCm: 1, fabricId: 'f', meshResolutionCm: 3, visible: true, locked: false,
    };
    expect(() => new ScalePanelCommand(panelId, 20, 20).execute(ctx)).toThrow(/共用顶点/);
    expect(ctx.project.pattern.points['sq_p1'].pos).toEqual({ x: 10, y: 0 });
  });
});
