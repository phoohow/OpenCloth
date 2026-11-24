import { describe, expect, it } from 'vitest';
import { vec2 } from '@/model/types';
import { createEmptyPattern } from '@/model/defaults';
import { panelOutlineWithAllowance } from '@/pattern/panel';
import { computeBBox, signedPolygonArea } from '@/base/geom';
import type { Pattern, PatternEdge, PatternPoint, Vec2 } from '@/model/types';

interface SideSpec {
  from: string;
  to: string;
  allowance: number;
  corner?: 'miter' | 'round' | 'bevel';
}

function panelPattern(points: Array<[string, Vec2]>, sides: SideSpec[]): Pattern {
  const pattern = createEmptyPattern();
  for (const [id, pos] of points) {
    const point: PatternPoint = { id, pos, kind: 'corner' };
    pattern.points[id] = point;
  }

  const ids: string[] = [];
  for (const side of sides) {
    const edge: PatternEdge = {
      id: `${side.from}_${side.to}`, type: 'line', startPointId: side.from, endPointId: side.to,
      seamAllowanceCm: side.allowance,
    };
    if (side.corner) edge.cornerStyle = side.corner;
    pattern.edges[edge.id] = edge;
    ids.push(edge.id);
  }

  pattern.panels.panel = {
    id: 'panel', name: 'p', outlineEdgeIds: ids, dartIds: [], internalLineIds: [], holes: [],
    seamAllowanceCm: 1, fabricId: 'f', visible: true, locked: false,
  };
  return pattern;
}

function offsetBox(pattern: Pattern): [number, number, number, number] {
  const outline = panelOutlineWithAllowance(pattern, pattern.panels.panel!);
  const box = computeBBox(outline);
  const round = (v: number): number => Math.round(v * 1000) / 1000;
  return [round(box.min.x), round(box.min.y), round(box.max.x), round(box.max.y)];
}

const CCW_POINTS: Array<[string, Vec2]> = [
  ['p0', vec2(0, 0)], ['p1', vec2(10, 0)], ['p2', vec2(10, 10)], ['p3', vec2(0, 10)],
];

const CW_POINTS: Array<[string, Vec2]> = [
  ['p0', vec2(0, 0)], ['p1', vec2(0, 10)], ['p2', vec2(10, 10)], ['p3', vec2(10, 0)],
];

describe('panelOutlineWithAllowance', () => {
  it('keeps the same cut outline whatever the winding of the panel outline', () => {
    const ccw = panelPattern(CCW_POINTS, [
      { from: 'p0', to: 'p1', allowance: 1 },
      { from: 'p1', to: 'p2', allowance: 5 },
      { from: 'p2', to: 'p3', allowance: 3 },
      { from: 'p3', to: 'p0', allowance: 2 },
    ]);
    const cw = panelPattern(CW_POINTS, [
      { from: 'p0', to: 'p1', allowance: 2 },
      { from: 'p1', to: 'p2', allowance: 3 },
      { from: 'p2', to: 'p3', allowance: 5 },
      { from: 'p3', to: 'p0', allowance: 1 },
    ]);

    expect(signedPolygonArea(panelOutlineWithAllowance(cw, cw.panels.panel!))).toBeGreaterThan(0);
    expect(offsetBox(cw)).toEqual(offsetBox(ccw));
  });

  it('offsets each vertex by the allowance of the edge that ends on it', () => {
    const pattern = panelPattern(CCW_POINTS, [
      { from: 'p0', to: 'p1', allowance: 1 },
      { from: 'p1', to: 'p2', allowance: 2 },
      { from: 'p2', to: 'p3', allowance: 3 },
      { from: 'p3', to: 'p0', allowance: 4 },
    ]);
    expect(offsetBox(pattern)).toEqual([-4, -1, 12, 13]);
  });

  it('keeps styled corners on their own side when the outline is clockwise', () => {
    const styled = panelPattern(CW_POINTS, [
      { from: 'p0', to: 'p1', allowance: 2, corner: 'round' },
      { from: 'p1', to: 'p2', allowance: 2 },
      { from: 'p2', to: 'p3', allowance: 2 },
      { from: 'p3', to: 'p0', allowance: 2 },
    ]);
    const outline = panelOutlineWithAllowance(styled, styled.panels.panel!);
    const near = (corner: Vec2): number => outline.filter(p => Math.hypot(p.x - corner.x, p.y - corner.y) <= 2.4).length;
    expect(near(vec2(0, 10))).toBeGreaterThan(2);
    expect(near(vec2(0, 0))).toBeLessThanOrEqual(1);
  });
});
