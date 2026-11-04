import { describe, expect, it } from 'vitest';
import { vec2, type Pattern, type Vec2 } from '../../../src/core/model/types';
import { createDefaultProject } from '../../../src/core/model/defaults';
import { collectSnapCandidates, findSnapAtPattern } from '../../../src/ui/viewport2D/snap';

/** Snap radius used by every case, in world centimetres. */
const TOLERANCE = 0.8;

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
const square = (id = 'a', visible = true): Pattern =>
  panelPattern(id, [vec2(0, 0), vec2(10, 0), vec2(10, 10), vec2(0, 10)], visible);

describe('2D snapping', () => {
  it('prefers the corner over the perpendicular foot under the cursor', () => {
    const pattern = square();
    const snap = findSnapAtPattern(pattern, vec2(0.3, 0.3), collectSnapCandidates(pattern), TOLERANCE);

    expect(snap?.kind).toBe('endpoint');
    expect(snap?.pos).toEqual({ x: 0, y: 0 });
  });

  it('falls back to the perpendicular foot away from corners and midpoints', () => {
    const pattern = square();
    const snap = findSnapAtPattern(pattern, vec2(3, 0.3), collectSnapCandidates(pattern), TOLERANCE);

    expect(snap?.kind).toBe('perpendicular');
    expect(snap?.pos).toEqual({ x: 3, y: 0 });
  });

  it('snaps to the extension of a straight edge beyond its end', () => {
    const pattern = square();
    const snap = findSnapAtPattern(pattern, vec2(11, 0.1), collectSnapCandidates(pattern), TOLERANCE);

    expect(snap?.kind).toBe('extension');
    expect(snap?.pos.x).toBeCloseTo(11, 6);
    expect(snap?.pos.y).toBeCloseTo(0, 6);
  });

  it('ignores the geometry of hidden panels', () => {
    const visible = square('a');
    const hidden = panelPattern('b', [vec2(100, 0), vec2(110, 0), vec2(110, 10), vec2(100, 10)], false);
    const pattern: Pattern = {
      ...visible,
      points: { ...visible.points, ...hidden.points },
      edges: { ...visible.edges, ...hidden.edges },
      panels: { ...visible.panels, ...hidden.panels },
    };

    expect(collectSnapCandidates(pattern).some(c => c.pointId?.startsWith('b-') || c.edgeId?.startsWith('b-'))).toBe(false);
    expect(findSnapAtPattern(pattern, vec2(100, 0), collectSnapCandidates(pattern), TOLERANCE)).toBeNull();

    pattern.panels.b = { ...pattern.panels.b!, visible: true };
    expect(findSnapAtPattern(pattern, vec2(100, 0), collectSnapCandidates(pattern), TOLERANCE)?.kind).toBe('endpoint');
  });
});
