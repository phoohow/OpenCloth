import { describe, expect, it } from 'vitest';
import { vec2, type Pattern, type Vec2 } from '../../../src/core/model/types';
import { createDefaultProject } from '../../../src/core/model/defaults';
import { samplePanelOutline } from '../../../src/pattern/panel/panelBuilder';
import {
  elementHoverPaths, hoverTargetKey, isElementHoverKind, isPlacementTool, markHintKey,
  pickHoverTarget, pickInternalLineVertex, pickPlacementFeedback, pickPressRole,
} from '../../../src/ui/viewport2D/hitTest';

/** Press radius used by every case, in world centimetres. */
const RADIUS = 0.8;

/** Pattern holding one closed panel; the corners and edges of the loop are given by the caller. */
function panelPattern(id: string, corners: Vec2[], visible = true): Pattern {
  const pattern = createDefaultProject().pattern;
  pattern.points = {};
  pattern.edges = {};
  pattern.panels = {};
  const edgeIds = corners.map((corner, i) => {
    const pointId = `${id}-p${i}`;
    const nextId = `${id}-p${(i + 1) % corners.length}`;
    pattern.points[pointId] = { id: pointId, pos: corner };
    const edgeId = `${id}-e${i}`;
    pattern.edges[edgeId] = { id: edgeId, type: 'line', startPointId: pointId, endPointId: nextId };
    return edgeId;
  });
  pattern.panels[id] = {
    id, name: id, outlineEdgeIds: edgeIds, dartIds: [], internalLineIds: [],
    seamAllowanceCm: 0, fabricId: 'f', meshResolutionCm: 3, visible, locked: false,
  };
  return pattern;
}

/** Square panel of 10 × 10 cm with its lower-left corner at the origin. */
const square = (visible = true): Pattern =>
  panelPattern('a', [vec2(0, 0), vec2(10, 0), vec2(10, 10), vec2(0, 10)], visible);

/** Outline polygons the picker reads, sampled exactly as the viewport samples them. */
const outlinesOf = (pattern: Pattern): Map<string, Vec2[]> =>
  new Map(Object.values(pattern.panels).map(panel => [panel.id, samplePanelOutline(pattern, panel)]));

describe('2D press role', () => {
  it('moves the panel body and reports nothing outside it', () => {
    const pattern = square();
    const outlines = outlinesOf(pattern);

    expect(pickPressRole(pattern, outlines, [], vec2(5, 5), RADIUS)).toBe('move');
    expect(pickPressRole(pattern, outlines, [], vec2(50, 50), RADIUS)).toBeNull();
  });

  it('grabs a vertex and the middle of an edge', () => {
    const pattern = square();
    const outlines = outlinesOf(pattern);

    expect(pickPressRole(pattern, outlines, [], vec2(0.2, 0.2), RADIUS)).toBe('grab');
    expect(pickPressRole(pattern, outlines, [], vec2(5, 0.1), RADIUS)).toBe('grab');
  });

  it('grabs a notch on the outline', () => {
    const pattern = square();
    pattern.notches = { n1: { id: 'n1', edgeId: 'a-e0', t: 0.5 } };

    expect(pickPressRole(pattern, outlinesOf(pattern), [], vec2(5, 0), RADIUS)).toBe('grab');
  });

  it('grabs a trim or print mark, and falls through to the panel under a hidden print', () => {
    const pattern = square();
    pattern.trims = {
      t1: {
        id: 't1', panelId: 'a', kind: 'button', pos: vec2(4, 4), sizeMm: 12, color: '#fff', qty: 1, visible: true,
      },
    };
    pattern.prints = {
      p1: {
        id: 'p1', panelId: 'a', imageUrl: 'data:,', center: vec2(0, 0), widthCm: 4, heightCm: 4,
        angleDeg: 0, opacity: 1, repeat: vec2(1, 1), visible: true,
      },
    };
    const outlines = outlinesOf(pattern);

    expect(pickPressRole(pattern, outlines, [], vec2(4, 4), RADIUS)).toBe('grab');
    expect(pickPressRole(pattern, outlines, [], vec2(3, 3), RADIUS)).toBe('grab');
    pattern.prints.p1!.visible = false;
    expect(pickPressRole(pattern, outlines, [], vec2(3, 3), RADIUS)).toBe('move');
  });

  it('reports nothing over a locked panel', () => {
    const pattern = square();
    pattern.panels.a!.locked = true;
    const outlines = outlinesOf(pattern);

    expect(pickPressRole(pattern, outlines, [], vec2(5, 5), RADIUS)).toBeNull();
    expect(pickPressRole(pattern, outlines, [], vec2(0.2, 0.2), RADIUS)).toBeNull();
    expect(pickPressRole(pattern, outlines, [], vec2(5, 0.1), RADIUS)).toBeNull();
  });

  it('reports nothing over a hidden panel', () => {
    const pattern = square(false);

    expect(pickPressRole(pattern, outlinesOf(pattern), [], vec2(5, 5), RADIUS)).toBeNull();
  });
});

/** Square panel with one three-point internal line away from its outline. */
function withInternalLine(points = [vec2(2, 2), vec2(5, 5), vec2(8, 2)]): Pattern {
  const pattern = square();
  pattern.internalLines = { l1: { id: 'l1', kind: 'fold', points } };
  pattern.panels.a!.internalLineIds = ['l1'];
  return pattern;
}

describe('select tool hover target', () => {
  it('picks a vertex, an outline edge, an internal line and a panel body', () => {
    const pattern = withInternalLine();
    const outlines = outlinesOf(pattern);

    expect(pickHoverTarget(pattern, outlines, [], vec2(0.1, 0.1), RADIUS)).toEqual({ kind: 'point', id: 'a-p0' });
    expect(pickHoverTarget(pattern, outlines, [], vec2(5, 0.1), RADIUS)).toEqual({ kind: 'edge', id: 'a-e0' });
    expect(pickHoverTarget(pattern, outlines, [], vec2(3.5, 3.5), RADIUS)).toEqual({ kind: 'internal', id: 'l1' });
    expect(pickHoverTarget(pattern, outlines, [], vec2(8, 8), RADIUS)).toEqual({ kind: 'panel', id: 'a' });
    expect(pickHoverTarget(pattern, outlines, [], vec2(50, 50), RADIUS)).toBeNull();
  });

  it('pre-highlights a notch instead of the edge behind it', () => {
    const pattern = withInternalLine();
    pattern.notches = { n1: { id: 'n1', edgeId: 'a-e0', t: 0.5 } };

    expect(pickHoverTarget(pattern, outlinesOf(pattern), [], vec2(5, 0), RADIUS))
      .toEqual({ kind: 'element', elementKind: 'notch', id: 'n1' });
  });

  it('pre-highlights inner marks and production symbols', () => {
    const outlinesFor = (pattern: Pattern) => outlinesOf(pattern);
    const note = square();
    note.annotations = { a1: { id: 'a1', panelId: 'a', text: '标注', pos: vec2(3, 3) } };
    expect(pickHoverTarget(note, outlinesFor(note), [], vec2(3, 3), RADIUS))
      .toEqual({ kind: 'element', elementKind: 'annotation', id: 'a1' });

    const trim = square();
    trim.trims = {
      t1: { id: 't1', panelId: 'a', kind: 'button', pos: vec2(3, 3), sizeMm: 12, color: '#fff', qty: 1, visible: true },
    };
    expect(pickHoverTarget(trim, outlinesFor(trim), [], vec2(3, 3), RADIUS))
      .toEqual({ kind: 'element', elementKind: 'trim', id: 't1' });

    const print = square();
    print.prints = {
      p1: {
        id: 'p1', panelId: 'a', imageUrl: 'data:,', center: vec2(0, 0), widthCm: 2, heightCm: 2,
        angleDeg: 0, opacity: 1, repeat: vec2(1, 1), visible: true,
      },
    };
    expect(pickHoverTarget(print, outlinesFor(print), [], vec2(5, 5), RADIUS))
      .toEqual({ kind: 'element', elementKind: 'print', id: 'p1' });
    expect(pickHoverTarget(print, outlinesFor(print), ['@print:p1'], vec2(4, 4), RADIUS))
      .toEqual({ kind: 'element', elementKind: 'print', id: 'p1' });

    const measurement = square();
    measurement.measurements = {
      m1: { id: 'm1', panelId: 'a', kind: 'distance', refs: { pointAId: 'a-p0', pointBId: 'a-p2' } },
    };
    expect(pickHoverTarget(measurement, outlinesFor(measurement), [], vec2(5, 5), RADIUS))
      .toEqual({ kind: 'element', elementKind: 'measurement', id: 'm1' });
  });

  it('exposes sampled geometry for every pre-highlighted element kind', () => {
    const pattern = square();
    pattern.darts = { d1: { id: 'd1', tipId: 'a-p0', edge1Id: 'a-e0', edge2Id: 'a-e1', intakeCm: 2 } };
    pattern.seams = {
      s1: {
        id: 's1', type: 'normal', a: { edgeId: 'a-e0', t0: 0, t1: 1 }, b: { edgeId: 'a-e1', t0: 0, t1: 1 },
        flip: false, strength: 1, threadColor: '#fff', stitchVisible: true,
      },
    };
    pattern.notches = { n1: { id: 'n1', edgeId: 'a-e0', t: 0.5 } };
    pattern.annotations = { a1: { id: 'a1', panelId: 'a', text: 'x', pos: vec2(3, 3) } };
    pattern.measurements = { m1: { id: 'm1', panelId: 'a', kind: 'distance', refs: { pointAId: 'a-p0', pointBId: 'a-p1' } } };
    pattern.prints = {
      p1: {
        id: 'p1', panelId: 'a', imageUrl: 'data:,', center: vec2(0, 0), widthCm: 2, heightCm: 2,
        angleDeg: 0, opacity: 1, repeat: vec2(1, 1), visible: true,
      },
    };
    pattern.topstitches = {
      ts1: {
        id: 'ts1', panelId: 'a', edgeId: 'a-e0', t0: 0, t1: 1,
        offsetMm: 10, spacingMm: 20, rows: 2, color: '#fff', stitchMm: 2, gapMm: 2, visible: true,
      },
    };
    pattern.trims = {
      t1: { id: 't1', panelId: 'a', kind: 'button', pos: vec2(3, 3), sizeMm: 12, color: '#fff', qty: 1, visible: true },
    };

    const kinds = [
      ['dart', 'd1'], ['seam', 's1'], ['notch', 'n1'], ['annotation', 'a1'],
      ['measurement', 'm1'], ['print', 'p1'], ['topstitch', 'ts1'], ['trim', 't1'],
    ] as const;
    for (const [kind, id] of kinds) {
      expect(isElementHoverKind(kind)).toBe(true);
      expect(elementHoverPaths(pattern, kind, id)?.paths.some(path => path.length > 0)).toBe(true);
    }
    expect(isElementHoverKind('panel')).toBe(false);
    expect(isElementHoverKind('edge')).toBe(false);
    expect(elementHoverPaths(pattern, 'notch', 'missing')).toBeNull();
  });

  it('rings a vertex of a selected internal line', () => {
    const pattern = withInternalLine();
    const selection = ['@internal:l1'];

    expect(pickHoverTarget(pattern, outlinesOf(pattern), selection, vec2(5, 5), RADIUS))
      .toEqual({ kind: 'internalVertex', lineId: 'l1', index: 1 });
    expect(pickPressRole(pattern, outlinesOf(pattern), selection, vec2(5, 5), RADIUS)).toBe('grab');
  });

  it('gives one stable key per hover target', () => {
    expect(hoverTargetKey({ kind: 'edge', id: 'e1' })).toBe('edge:e1');
    expect(hoverTargetKey({ kind: 'internalVertex', lineId: 'l1', index: 2 })).toBe('internalVertex:l1:2');
    expect(hoverTargetKey({ kind: 'element', elementKind: 'notch', id: 'n1' })).toBe('element:notch:n1');
    expect(hoverTargetKey(null)).toBe('');
  });
});

describe('placement tool hover feedback', () => {
  const pointsOf = (pattern: Pattern) => Object.values(pattern.points).map(p => ({ id: p.id, pos: p.pos }));

  it('highlights the edge and ghosts the notch at its midpoint, not under the cursor', () => {
    const pattern = square();
    const outlines = outlinesOf(pattern);
    const points = pointsOf(pattern);
    const midpoint = {
      hover: { kind: 'edge', id: 'a-e0' },
      hint: { kind: 'notch', pos: vec2(5, 0) },
    };

    expect(pickPlacementFeedback('notch', pattern, outlines, points, vec2(2, 0.1), RADIUS)).toEqual(midpoint);
    expect(pickPlacementFeedback('notch', pattern, outlines, points, vec2(8, 0.1), RADIUS)).toEqual(midpoint);
    expect(pickPlacementFeedback('notch', pattern, outlines, points, vec2(50, 50), RADIUS))
      .toEqual({ hover: null, hint: null });
  });

  it('highlights the panel and ghosts the annotation at the placed point', () => {
    const pattern = square();
    const outlines = outlinesOf(pattern);
    const placed = vec2(4.5, 4.5);

    expect(pickPlacementFeedback('annotation', pattern, outlines, pointsOf(pattern), vec2(5, 5), RADIUS, placed))
      .toEqual({ hover: { kind: 'panel', id: 'a' }, hint: { kind: 'annotation', pos: placed } });
    expect(pickPlacementFeedback('annotation', pattern, outlines, pointsOf(pattern), vec2(50, 50), RADIUS, placed))
      .toEqual({ hover: null, hint: null });
  });

  it('rings the vertex a measurement would pick and leaves no landing ghost', () => {
    const pattern = square();
    const outlines = outlinesOf(pattern);

    expect(pickPlacementFeedback('measure', pattern, outlines, pointsOf(pattern), vec2(0.1, 0.1), RADIUS))
      .toEqual({ hover: { kind: 'point', id: 'a-p0' }, hint: null });
    expect(pickPlacementFeedback('measure', pattern, outlines, pointsOf(pattern), vec2(5, 5), RADIUS))
      .toEqual({ hover: null, hint: null });
  });

  it('highlights the edge or panel the other placement tools would act on', () => {
    const pattern = square();
    const outlines = outlinesOf(pattern);
    const points = pointsOf(pattern);

    expect(pickPlacementFeedback('dart', pattern, outlines, points, vec2(5, 0.1), RADIUS))
      .toEqual({ hover: { kind: 'edge', id: 'a-e0' }, hint: null });
    expect(pickPlacementFeedback('topstitch', pattern, outlines, points, vec2(5, 0.1), RADIUS))
      .toEqual({ hover: { kind: 'edge', id: 'a-e0' }, hint: null });
    expect(pickPlacementFeedback('trim', pattern, outlines, points, vec2(5, 5), RADIUS))
      .toEqual({ hover: { kind: 'panel', id: 'a' }, hint: null });
    expect(pickPlacementFeedback('trim', pattern, outlines, points, vec2(50, 50), RADIUS))
      .toEqual({ hover: null, hint: null });
  });

  it('recognizes exactly the placement tools', () => {
    expect(['notch', 'annotation', 'measure', 'dart', 'topstitch', 'trim'].every(isPlacementTool)).toBe(true);
    expect(isPlacementTool('select')).toBe(false);
    expect(isPlacementTool('seam')).toBe(false);
  });

  it('gives one stable key per mark hint', () => {
    expect(markHintKey({ kind: 'notch', pos: vec2(1, 2) })).toBe('notch:1:2');
    expect(markHintKey(null)).toBe('');
  });
});

describe('internal line vertex pick', () => {
  it('finds the nearest vertex only on selected lines', () => {
    const pattern = withInternalLine();

    expect(pickInternalLineVertex(pattern, [], vec2(5, 5), RADIUS)).toBeNull();
    expect(pickInternalLineVertex(pattern, ['@internal:l1'], vec2(5.1, 5), RADIUS))
      .toEqual({ lineId: 'l1', indices: [1] });
    expect(pickInternalLineVertex(pattern, ['@internal:l1'], vec2(5, 8), RADIUS)).toBeNull();
  });

  it('moves both ends of a closed ring together', () => {
    const pattern = withInternalLine([vec2(2, 2), vec2(8, 2), vec2(8, 8), vec2(2, 2)]);

    expect(pickInternalLineVertex(pattern, ['@internal:l1'], vec2(2, 2), RADIUS))
      .toEqual({ lineId: 'l1', indices: [0, 3] });
    expect(pickInternalLineVertex(pattern, ['@internal:l1'], vec2(8, 8), RADIUS))
      .toEqual({ lineId: 'l1', indices: [2] });
  });

  it('skips vertices on locked panels', () => {
    const pattern = withInternalLine();
    pattern.panels.a!.locked = true;

    expect(pickInternalLineVertex(pattern, ['@internal:l1'], vec2(5, 5), RADIUS)).toBeNull();
  });
});
