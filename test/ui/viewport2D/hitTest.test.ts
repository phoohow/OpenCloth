import { describe, expect, it } from 'vitest';
import { vec2, type Pattern, type Vec2 } from '../../../src/core/model/types';
import { createDefaultProject } from '../../../src/core/model/defaults';
import { createStarterProject } from '../../../src/pattern/template/starterProject';
import { samplePanelOutline, sampleEdgeInterval } from '../../../src/pattern/panel/panelBuilder';
import { elementNodeId } from '../../../src/core/model/elementRef';
import { topstitchRows } from '../../../src/ui/viewport2D/tools';
import {
  elementsInRect, pickElements, pickPressRole, pointInPolygon, projectOnSegment,
  MARK_KINDS, PRODUCTION_KINDS, type Rect,
} from '../../../src/ui/viewport2D/hitTest';

/** Press radius used by every case, in world centimetres. */
const RADIUS = 0.8;

/** Pattern holding one closed panel; the corners and edges of the loop are given by the caller. */
function panelPattern(id: string, corners: Vec2[]): Pattern {
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
    seamAllowanceCm: 0, fabricId: 'f', meshResolutionCm: 3, visible: true, locked: false,
  };
  return pattern;
}

/** Square panel of 10 × 10 cm with its lower-left corner at the origin. */
const square = (): Pattern =>
  panelPattern('a', [vec2(0, 0), vec2(10, 0), vec2(10, 10), vec2(0, 10)]);

/** Outline polygons the picker reads, sampled exactly as the viewport samples them. */
const outlinesOf = (pattern: Pattern): Map<string, Vec2[]> =>
  new Map(Object.values(pattern.panels).map(panel => [panel.id, samplePanelOutline(pattern, panel)]));

/** Shortest distance from a point to one sampled stroke. */
function distanceToStroke(pts: readonly Vec2[], p: Vec2): number {
  if (pts.length === 0) return Infinity;
  if (pts.length === 1) return Math.hypot(p.x - pts[0]!.x, p.y - pts[0]!.y);
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const hit = projectOnSegment(p, pts[i]!, pts[i + 1]!).point;
    best = Math.min(best, Math.hypot(p.x - hit.x, p.y - hit.y));
  }
  return best;
}

/** Seam joining the bottom edge to the left edge of the square panel. */
function withSeam(pattern: Pattern): Pattern {
  pattern.seams = {
    s1: {
      id: 's1', type: 'normal',
      a: { edgeId: 'a-e0', t0: 0, t1: 1 },
      b: { edgeId: 'a-e3', t0: 0, t1: 1 },
      flip: false, strength: 1, threadColor: '#ff4444', stitchVisible: true,
    },
  };
  return pattern;
}

describe('2D element picking', () => {
  it('never picks a seam from the empty space between its two sides', () => {
    const pattern = withSeam(square());

    // The straight line from the end of side A (10, 0) to the start of side B (0, 10)
    // crosses the panel body; it is not drawn and must not be selectable.
    expect(pickElements(pattern, vec2(5, 5), RADIUS, MARK_KINDS)).toBeNull();
    expect(pickElements(pattern, vec2(4, 4), RADIUS, MARK_KINDS)).toBeNull();
    expect(pickPressRole(pattern, outlinesOf(pattern), [], vec2(5, 5), RADIUS)).toBe('move');
  });

  it('still picks a seam on either of its real sides', () => {
    const pattern = withSeam(square());
    const row = elementNodeId('seam', 's1');

    expect(pickElements(pattern, vec2(5, 0.2), RADIUS, MARK_KINDS)).toBe(row);
    expect(pickElements(pattern, vec2(0.2, 5), RADIUS, MARK_KINDS)).toBe(row);
  });

  it('collects seam samples in a marquee that covers a real side only', () => {
    const pattern = withSeam(square());
    const rect = (min: Vec2, max: Vec2): Rect => ({ min, max });

    expect(elementsInRect(pattern, rect(vec2(-1, -1), vec2(1, 1)), ['seam'])).toEqual([elementNodeId('seam', 's1')]);
    expect(elementsInRect(pattern, rect(vec2(4, 4), vec2(6, 6)), ['seam'])).toEqual([]);
  });

  it('leaves the phantom spans between the default garment seam sides unpickable', () => {
    const pattern = createStarterProject().pattern;
    const outlines = Object.values(pattern.panels).map(panel => samplePanelOutline(pattern, panel));
    const seams = Object.values(pattern.seams);
    const sides = seams.flatMap(seam => [
      sampleEdgeInterval(pattern, seam.a.edgeId, seam.a.t0, seam.a.t1),
      sampleEdgeInterval(pattern, seam.b.edgeId, seam.b.t0, seam.b.t1),
    ]);

    // Points on the straight join from side A's end to side B's start, inside a panel body and
    // clear of every drawn seam side: only a phantom segment can put a seam under these presses.
    const ghosts: Vec2[] = [];
    for (const seam of seams) {
      const a = sampleEdgeInterval(pattern, seam.a.edgeId, seam.a.t0, seam.a.t1);
      const b = sampleEdgeInterval(pattern, seam.b.edgeId, seam.b.t0, seam.b.t1);
      if (a.length === 0 || b.length === 0) continue;
      const from = a[a.length - 1]!, to = b[0]!;
      for (let t = 0.1; t < 0.95; t += 0.1) {
        const p = vec2(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
        if (!outlines.some(outline => pointInPolygon(outline, p))) continue;
        if (sides.some(side => distanceToStroke(side, p) <= RADIUS)) continue;
        ghosts.push(p);
      }
    }

    expect(ghosts.length).toBeGreaterThan(0);
    for (const p of ghosts) expect(pickElements(pattern, p, RADIUS, ['seam'])).toBeNull();
  });

  it('keeps the gap between two topstitch rows unpickable', () => {
    const pattern = square();
    pattern.topstitches = {
      ts1: {
        id: 'ts1', panelId: 'a', edgeId: 'a-e0', t0: 0, t1: 1,
        offsetMm: 10, spacingMm: 20, rows: 2, color: '#fff', stitchMm: 2, gapMm: 2, visible: true,
      },
    };
    const rows = topstitchRows(pattern, pattern.topstitches.ts1!);
    expect(rows.length).toBe(2);

    const first = rows[0]!, second = rows[1]!;
    const gap = vec2((first[0]!.x + first[first.length - 1]!.x) / 2, (first[0]!.y + second[0]!.y) / 2);
    expect(pickElements(pattern, gap, RADIUS, PRODUCTION_KINDS)).toBeNull();
    expect(pickElements(pattern, first[0]!, RADIUS, PRODUCTION_KINDS)).toBe(elementNodeId('topstitch', 'ts1'));
  });
});
