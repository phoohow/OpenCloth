import { describe, it, expect } from 'vitest';
import type { SizeDef } from '@/model/types';
import { createEmptyPattern } from '@/model/defaults';
import { validatePattern } from '@/model/validatePattern';
import {
  SetPointGradingCommand, SetPointsGradingCommand, ApplySizeCommand, resolveSize, validateGrading,
} from '@/commands/patternCommands';
import { ctxOf, addSquare } from './fixtures';
import { gradingPasteMap, gradingPasteTargets } from '@/pattern/grading/grading';
import { arcFromThreePoints, evalArc } from '@/common/geom';
import { vec2 } from '@/model/types';

function squareCtx() {
  const p = createEmptyPattern();
  const panelId = addSquare(p, 'sq', 0, 0, 10);
  return { ctx: ctxOf(p), panelId };
}

const M: SizeDef = { id: 'size_M', label: 'M', seq: 1, isBase: true };
const L: SizeDef = { id: 'size_L', label: 'L', seq: 2 };

describe('grading commands', () => {
  it('set one point grading and undo', () => {
    const { ctx } = squareCtx();
    const before = structuredClone(ctx.project.pattern);
    const p1 = ctx.project.pattern.panels['sq_panel'].outlineEdgeIds;
    const pointId = ctx.project.pattern.edges[p1[1]].startPointId;
    const cmd = new SetPointGradingCommand(pointId, L.id, { x: 2, y: 0 });
    cmd.execute(ctx);
    expect(ctx.project.pattern.points[pointId].grading?.[L.id]).toEqual({ x: 2, y: 0 });
    cmd.undo(ctx);
    expect(ctx.project.pattern).toEqual(before);
  });

  it('batch grading is one undo step', () => {
    const { ctx } = squareCtx();
    const before = structuredClone(ctx.project.pattern);
    const edges = ctx.project.pattern.panels['sq_panel'].outlineEdgeIds;
    const pRight = ctx.project.pattern.edges[edges[1]].startPointId;
    const pTopRight = ctx.project.pattern.edges[edges[2]].startPointId;
    const cmd = new SetPointsGradingCommand({ [pRight]: { [L.id]: { x: 3, y: 0 } }, [pTopRight]: { [L.id]: { x: 3, y: 0 } } });
    cmd.execute(ctx);
    expect(validatePattern(ctx.project.pattern)).toEqual([]);
    cmd.undo(ctx);
    expect(ctx.project.pattern).toEqual(before);
  });

  it('apply size shifts geometry and undoes exactly', () => {
    const { ctx } = squareCtx();
    const edges = ctx.project.pattern.panels['sq_panel'].outlineEdgeIds;
    const pRight = ctx.project.pattern.edges[edges[1]].startPointId;
    const pTopRight = ctx.project.pattern.edges[edges[2]].startPointId;
    new SetPointsGradingCommand({ [pRight]: { [L.id]: { x: 3, y: 0 } }, [pTopRight]: { [L.id]: { x: 3, y: 0 } } }).execute(ctx);
    ctx.project.activeSizeId = M.id;
    const beforeApply = structuredClone(ctx.project.pattern);
    const applied = new ApplySizeCommand(L.id);
    applied.execute(ctx);
    expect(ctx.project.activeSizeId).toBe(L.id);
    expect(ctx.project.pattern.points[pRight].pos.x).toBeCloseTo(13, 6);
    // Back to M then to L returns the same resolved geometry (base cancels out).
    const atL = structuredClone(ctx.project.pattern);
    new ApplySizeCommand(M.id).execute(ctx);
    expect(ctx.project.pattern.points[pRight].pos.x).toBeCloseTo(10, 6);
    new ApplySizeCommand(L.id).execute(ctx);
    expect(ctx.project.pattern).toEqual(atL);
    applied.undo(ctx);
    expect(ctx.project.pattern).toEqual(beforeApply);
    expect(ctx.project.activeSizeId).toBe(M.id);
  });

  it('resolveSize is a pure derive', () => {
    const { ctx } = squareCtx();
    const edges = ctx.project.pattern.panels['sq_panel'].outlineEdgeIds;
    const pRight = ctx.project.pattern.edges[edges[1]].startPointId;
    new SetPointGradingCommand(pRight, L.id, { x: 4, y: 1 }).execute(ctx);
    const base = structuredClone(ctx.project.pattern);
    const r = resolveSize(ctx.project.pattern, undefined, L.id);
    expect(ctx.project.pattern).toEqual(base);
    expect(r.points[pRight].pos).toEqual({ x: 14, y: 1 });
  });

  it('pasting a copied delta writes every selected point in one step', () => {
    const { ctx } = squareCtx();
    const edges = ctx.project.pattern.panels['sq_panel'].outlineEdgeIds;
    const pRight = ctx.project.pattern.edges[edges[1]].startPointId;
    const pTopRight = ctx.project.pattern.edges[edges[2]].startPointId;
    const pLeft = ctx.project.pattern.edges[edges[3]].startPointId;
    const pattern = ctx.project.pattern;

    const map = gradingPasteMap(pattern, L.id, { x: 2, y: 1 }, [pRight, pTopRight], pLeft);
    expect(Object.keys(map).sort()).toEqual([pRight, pTopRight].sort());
    const cmd = new SetPointsGradingCommand(map);
    const before = structuredClone(pattern);
    cmd.execute(ctx);
    expect(pattern.points[pRight].grading?.[L.id]).toEqual({ x: 2, y: 1 });
    expect(pattern.points[pLeft].grading?.[L.id]).toBeUndefined();
    cmd.undo(ctx);
    expect(pattern).toEqual(before);
  });

  it('paste targets fall back to the copied row and drop deleted points', () => {
    const { ctx } = squareCtx();
    const pattern = ctx.project.pattern;
    const edges = pattern.panels['sq_panel'].outlineEdgeIds;
    const pRight = pattern.edges[edges[1]].startPointId;
    const pTopRight = pattern.edges[edges[2]].startPointId;

    expect(gradingPasteTargets(pattern, [], pTopRight)).toEqual([pTopRight]);
    expect(gradingPasteTargets(pattern, [pRight, 'gone'], pTopRight)).toEqual([pRight]);
    expect(Object.keys(gradingPasteMap(pattern, L.id, { x: 1, y: 0 }, ['gone'], pTopRight))).toEqual([pTopRight]);
  });

  it('arc edges stay attached to their graded endpoints', () => {
    const { ctx } = squareCtx();
    const pattern = ctx.project.pattern;
    const edge = pattern.edges['sq_e1'];
    edge.type = 'arc';
    edge.arc = arcFromThreePoints(vec2(10, 0), vec2(12, 5), vec2(10, 10))!;
    new SetPointsGradingCommand({
      sq_p1: { [L.id]: { x: 3, y: 0 } },
      sq_p2: { [L.id]: { x: 3, y: 2 } },
    }).execute(ctx);

    const resolved = resolveSize(pattern, undefined, L.id);
    const arc = resolved.edges['sq_e1'].arc!;
    expect(resolved.edges['sq_e1'].type).toBe('arc');
    for (const [t, expected] of [[0, vec2(13, 0)], [0.5, vec2(15, 6)], [1, vec2(13, 12)]] as const) {
      const at = evalArc(arc, t);
      expect(at.x).toBeCloseTo(expected.x, 9);
      expect(at.y).toBeCloseTo(expected.y, 9);
    }
  });

  it('validateGrading reports non-monotonic edge length', () => {
    const { ctx } = squareCtx();
    const edges = ctx.project.pattern.panels['sq_panel'].outlineEdgeIds;
    const pRight = ctx.project.pattern.edges[edges[1]].startPointId;
    const pTopRight = ctx.project.pattern.edges[edges[2]].startPointId;
    new SetPointsGradingCommand({ [pRight]: { [L.id]: { x: 4, y: 0 } }, [pTopRight]: { [L.id]: { x: 4, y: 0 } } }).execute(ctx);
    expect(validateGrading(ctx.project.pattern, [M, L])).toEqual([]);
    // Make the right side shrink from M to L.
    new SetPointsGradingCommand({ [pRight]: { [L.id]: { x: -4, y: 0 } }, [pTopRight]: { [L.id]: { x: -4, y: 0 } } }).execute(ctx);
    const issues = validateGrading(ctx.project.pattern, [M, L]);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].message).toMatch(/不递增/);
  });
});
