import { describe, expect, it } from 'vitest';
import { vec2, type Pattern, type Project } from '../../../src/core/model/types';
import { createDefaultProject } from '../../../src/core/model/defaults';
import type { ProjectContext } from '../../../src/core/command/command';
import { capturePanels, pasteOffset, PastePanelsCommand } from '../../../src/core/command/panelClipboard';

function makeCtx(project: Project): ProjectContext {
  return { project };
}

/** Two panels: a square and a triangle sharing no geometry. */
function fixturePattern(): Pattern {
  const project = createDefaultProject();
  const pattern = project.pattern;
  Object.assign(pattern.points, {
    a1: { id: 'a1', pos: vec2(0, 0) },
    a2: { id: 'a2', pos: vec2(6, 0) },
    a3: { id: 'a3', pos: vec2(6, 8) },
    a4: { id: 'a4', pos: vec2(0, 8) },
    b1: { id: 'b1', pos: vec2(12, 0) },
    b2: { id: 'b2', pos: vec2(18, 0) },
    b3: { id: 'b3', pos: vec2(15, 5) },
  });
  Object.assign(pattern.edges, {
    a12: { id: 'a12', type: 'line', startPointId: 'a1', endPointId: 'a2' },
    a23: { id: 'a23', type: 'line', startPointId: 'a2', endPointId: 'a3' },
    a34: { id: 'a34', type: 'bezier', startPointId: 'a3', endPointId: 'a4', bezier: { c0: vec2(6, 10), c1: vec2(0, 10) } },
    a41: { id: 'a41', type: 'line', startPointId: 'a4', endPointId: 'a1' },
    b12: { id: 'b12', type: 'line', startPointId: 'b1', endPointId: 'b2' },
    b23: { id: 'b23', type: 'line', startPointId: 'b2', endPointId: 'b3' },
    b31: { id: 'b31', type: 'line', startPointId: 'b3', endPointId: 'b1' },
  });
  Object.assign(pattern.panels, {
    front: {
      id: 'front', name: '前片', outlineEdgeIds: ['a12', 'a23', 'a34', 'a41'], dartIds: [],
      internalLineIds: ['fold1'], seamAllowanceCm: 1, fabricId: 'f', meshResolutionCm: 3,
      visible: true, locked: false,
    },
    sleeve: {
      id: 'sleeve', name: '袖子', outlineEdgeIds: ['b12', 'b23', 'b31'], dartIds: [],
      internalLineIds: [], seamAllowanceCm: 1, fabricId: 'f', meshResolutionCm: 3,
      visible: false, locked: true,
    },
  });
  pattern.internalLines.fold1 = { id: 'fold1', kind: 'fold', points: [vec2(1, 1), vec2(5, 1)] };
  pattern.seams.ab = {
    id: 'ab', type: 'normal', edgeAId: 'a12', edgeBId: 'b12', flipB: false,
    strength: 1, threadColor: '#000', stitchVisible: true,
  };
  return pattern;
}

describe('capturePanels', () => {
  it('copies only the owned geometry of the selection', () => {
    const clip = capturePanels(fixturePattern(), ['front']);
    expect(clip?.panels.map(p => p.name)).toEqual(['前片']);
    expect(clip?.points).toHaveLength(4);
    expect(clip?.edges).toHaveLength(4);
    expect(clip?.internalLines).toHaveLength(1);
    // The seam crosses to the unselected sleeve, so it is not copied.
    expect(clip?.seams).toHaveLength(0);
  });

  it('keeps a seam whose both edges are inside the selection', () => {
    const clip = capturePanels(fixturePattern(), ['front', 'sleeve']);
    expect(clip?.seams).toHaveLength(1);
  });

  it('returns null when nothing selected exists', () => {
    expect(capturePanels(fixturePattern(), ['nope'])).toBeNull();
  });
});

describe('PastePanelsCommand', () => {
  it('creates fresh ids, copies geometry and offsets the outline', () => {
    const project = createDefaultProject();
    project.pattern = fixturePattern();
    const ctx = makeCtx(project);
    const clip = capturePanels(project.pattern, ['front'])!;

    const cmd = new PastePanelsCommand(clip);
    cmd.execute(ctx);

    expect(Object.keys(project.pattern.panels)).toHaveLength(3);
    const copy = project.pattern.panels[cmd.pastedPanelIds[0]];
    expect(copy.name).toBe('前片 副本');
    expect(copy.visible).toBe(true);
    expect(copy.locked).toBe(false);
    // Original spans x 0..6, so the copy starts 3cm to its right.
    expect(pasteOffset(clip).x).toBe(9);
    const xs = copy.outlineEdgeIds.map(id => project.pattern.points[project.pattern.edges[id].startPointId].pos.x);
    expect(xs).toEqual([9, 15, 15, 9]);
    // The original panel keeps its own geometry.
    expect(copy.outlineEdgeIds).not.toEqual(['a12', 'a23', 'a34', 'a41']);
    expect(project.pattern.points.a1.pos).toEqual(vec2(0, 0));
  });

  it('offsets bezier handles together with their outline points', () => {
    const project = createDefaultProject();
    project.pattern = fixturePattern();
    const cmd = new PastePanelsCommand(capturePanels(project.pattern, ['front'])!);
    cmd.execute(makeCtx(project));

    const bezier = Object.values(project.pattern.edges).find(e => e.type === 'bezier' && e.startPointId !== 'a3');
    expect(bezier?.bezier).toEqual({ c0: { x: 15, y: 10 }, c1: { x: 9, y: 10 } });
  });

  it('names repeated pastes uniquely', () => {
    const project = createDefaultProject();
    project.pattern = fixturePattern();
    const ctx = makeCtx(project);
    const clip = capturePanels(project.pattern, ['front'])!;

    new PastePanelsCommand(clip).execute(ctx);
    new PastePanelsCommand(clip).execute(ctx);
    const names = Object.values(project.pattern.panels).map(p => p.name);
    expect(names).toContain('前片 副本');
    expect(names).toContain('前片 副本 2');
  });

  it('undo removes exactly what execute created', () => {
    const project = createDefaultProject();
    project.pattern = fixturePattern();
    const ctx = makeCtx(project);
    const before = {
      panels: Object.keys(project.pattern.panels).length,
      edges: Object.keys(project.pattern.edges).length,
      points: Object.keys(project.pattern.points).length,
      lines: Object.keys(project.pattern.internalLines).length,
      seams: Object.keys(project.pattern.seams).length,
    };

    const cmd = new PastePanelsCommand(capturePanels(project.pattern, ['front', 'sleeve'])!);
    cmd.execute(ctx);
    expect(Object.keys(project.pattern.panels)).toHaveLength(before.panels + 2);

    cmd.undo(ctx);
    expect(Object.keys(project.pattern.panels)).toHaveLength(before.panels);
    expect(Object.keys(project.pattern.edges)).toHaveLength(before.edges);
    expect(Object.keys(project.pattern.points)).toHaveLength(before.points);
    expect(Object.keys(project.pattern.internalLines)).toHaveLength(before.lines);
    expect(Object.keys(project.pattern.seams)).toHaveLength(before.seams);
    expect(project.pattern.panels.front).toBeDefined();
    expect(project.pattern.points.a1.pos).toEqual(vec2(0, 0));
  });

  it('pastes a seam between two copied panels with remapped edges', () => {
    const project = createDefaultProject();
    project.pattern = fixturePattern();
    const ctx = makeCtx(project);
    const cmd = new PastePanelsCommand(capturePanels(project.pattern, ['front', 'sleeve'])!);
    cmd.execute(ctx);

    const seams = Object.values(project.pattern.seams);
    expect(seams).toHaveLength(2);
    const pasted = seams.find(s => s.id !== 'ab')!;
    expect(pasted.edgeAId).not.toBe('a12');
    expect(project.pattern.edges[pasted.edgeAId]).toBeDefined();
    expect(project.pattern.edges[pasted.edgeBId]).toBeDefined();
  });
});
