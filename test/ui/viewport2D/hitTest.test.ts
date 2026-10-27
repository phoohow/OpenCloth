import { describe, it, expect } from 'vitest';
import { vec2, type Pattern } from '../../../src/core/model/types';
import { createEmptyPattern } from '../../../src/core/model/defaults';
import {
  nearestEdgeSegment,
  nearestPointWithinRadius,
  panelIdOfEdge,
  panelOutlineInRect,
  panelsOfPoint,
  pointInPolygon,
  projectOnSegment,
  rectIntersectsBBox,
  visiblePanelUnderPoint,
} from '../../../src/ui/viewport2D/hitTest';

/** 10x10 square panel with corners A-B-C-D and one bezier top edge. */
function buildPattern(): Pattern {
  const pattern = createEmptyPattern();
  const ids = ['pA', 'pB', 'pC', 'pD'];
  const positions = [vec2(0, 0), vec2(10, 0), vec2(10, 10), vec2(0, 10)];
  ids.forEach((id, i) => { pattern.points[id] = { id, pos: positions[i] }; });

  const mkLine = (id: string, a: string, b: string) => {
    pattern.edges[id] = { id, type: 'line', startPointId: a, endPointId: b };
  };
  mkLine('eAB', 'pA', 'pB');
  mkLine('eBC', 'pB', 'pC');
  pattern.edges['eCD'] = {
    id: 'eCD', type: 'bezier', startPointId: 'pC', endPointId: 'pD',
    bezier: { c0: vec2(10, 20), c1: vec2(0, 20) },
  };
  mkLine('eDA', 'pD', 'pA');

  pattern.panels['panel1'] = {
    id: 'panel1', name: '方片',
    outlineEdgeIds: ['eAB', 'eBC', 'eCD', 'eDA'],
    dartIds: [], internalLineIds: [],
    seamAllowanceCm: 0, fabricId: 'f', meshResolutionCm: 3,
    visible: true, locked: false,
  };
  return pattern;
}

const points = [
  { id: 'pA', pos: vec2(0, 0) },
  { id: 'pB', pos: vec2(10, 0) },
  { id: 'pC', pos: vec2(10, 10) },
];

describe('pointInPolygon', () => {
  const square = [vec2(0, 0), vec2(10, 0), vec2(10, 10), vec2(0, 10)];

  it('命中内部点', () => {
    expect(pointInPolygon(square, vec2(5, 5))).toBe(true);
  });

  it('排除外部点', () => {
    expect(pointInPolygon(square, vec2(11, 5))).toBe(false);
    expect(pointInPolygon(square, vec2(-1, -1))).toBe(false);
  });

  it('凹多边形的凹槽区域不误判', () => {
    // U-shape open downward: the slot between x=4 and x=6 above y=4 is outside.
    const concave = [vec2(0, 0), vec2(10, 0), vec2(10, 10), vec2(6, 10), vec2(6, 4), vec2(4, 4), vec2(4, 10), vec2(0, 10)];
    expect(pointInPolygon(concave, vec2(5, 7))).toBe(false);
    expect(pointInPolygon(concave, vec2(2, 5))).toBe(true);
  });
});

describe('nearestPointWithinRadius', () => {
  it('返回半径内最近的点', () => {
    expect(nearestPointWithinRadius(points, vec2(0.4, 0.2), 1)).toBe('pA');
    expect(nearestPointWithinRadius(points, vec2(9.6, 0.3), 1)).toBe('pB');
  });

  it('恰好在半径上的点仍命中', () => {
    expect(nearestPointWithinRadius(points, vec2(1, 0), 1)).toBe('pA');
  });

  it('半径外返回 null', () => {
    expect(nearestPointWithinRadius(points, vec2(5, 5), 1)).toBeNull();
  });

  it('空列表返回 null', () => {
    expect(nearestPointWithinRadius([], vec2(0, 0), 5)).toBeNull();
  });
});

describe('projectOnSegment', () => {
  it('投影落在线段内部', () => {
    const r = projectOnSegment(vec2(5, 3), vec2(0, 0), vec2(10, 0));
    expect(r.t).toBeCloseTo(0.5, 6);
    expect(r.point.x).toBeCloseTo(5, 6);
    expect(r.point.y).toBeCloseTo(0, 6);
  });

  it('超出端点时截断到 0 或 1', () => {
    expect(projectOnSegment(vec2(-3, 1), vec2(0, 0), vec2(10, 0)).t).toBe(0);
    expect(projectOnSegment(vec2(30, 1), vec2(0, 0), vec2(10, 0)).t).toBe(1);
  });

  it('零长线段不产生 NaN', () => {
    const r = projectOnSegment(vec2(3, 3), vec2(1, 1), vec2(1, 1));
    expect(r.t).toBe(0);
    expect(Number.isNaN(r.point.x)).toBe(false);
  });
});

describe('nearestEdgeSegment', () => {
  const pattern = buildPattern();
  const allEdges = ['eAB', 'eBC', 'eCD', 'eDA'];

  it('直线边中点命中，t 约为 0.5', () => {
    const hit = nearestEdgeSegment(pattern, allEdges, vec2(5.2, 0.4), 1);
    expect(hit?.edgeId).toBe('eAB');
    expect(hit?.t).toBeCloseTo(0.52, 2);
    expect(hit?.point.x).toBeCloseTo(5.2, 5);
    expect(hit?.point.y).toBeCloseTo(0, 5);
  });

  it('贝塞尔边按采样折线命中', () => {
    // eCD bulges upward; the curve midpoint is at about (5, 17.5).
    const hit = nearestEdgeSegment(pattern, allEdges, vec2(5, 16.9), 1);
    expect(hit?.edgeId).toBe('eCD');
    expect(hit?.t).toBeGreaterThan(0.3);
    expect(hit?.t).toBeLessThan(0.7);
  });

  it('半径外返回 null', () => {
    expect(nearestEdgeSegment(pattern, allEdges, vec2(5, 5), 1)).toBeNull();
  });

  it('只搜索给定的边集合', () => {
    expect(nearestEdgeSegment(pattern, ['eBC'], vec2(10, 5.1), 1)?.edgeId).toBe('eBC');
    expect(nearestEdgeSegment(pattern, ['eBC'], vec2(5, 0), 1)).toBeNull();
  });

  it('缺失的边返回 null', () => {
    expect(nearestEdgeSegment(pattern, ['nope'], vec2(0, 0), 5)).toBeNull();
  });
});

describe('panelIdOfEdge / panelsOfPoint', () => {
  const pattern = buildPattern();

  it('边找到所属版型片', () => {
    expect(panelIdOfEdge(pattern, 'eAB')).toBe('panel1');
    expect(panelIdOfEdge(pattern, 'missing')).toBeNull();
  });

  it('点找到所属版型片且不重复', () => {
    expect(panelsOfPoint(pattern, 'pA')).toEqual(['panel1']);
    expect(panelsOfPoint(pattern, 'pZ')).toEqual([]);
  });
});

describe('visiblePanelUnderPoint', () => {
  const pattern = buildPattern();
  const outlines = new Map([['panel1', [vec2(0, 0), vec2(10, 0), vec2(10, 10), vec2(0, 10)]]]);

  it('轮廓内的点选中所属版型片', () => {
    expect(visiblePanelUnderPoint(pattern, outlines, vec2(5, 5), 1)).toBe('panel1');
  });

  it('轮廓外但靠近边的点也选中该版型片', () => {
    expect(visiblePanelUnderPoint(pattern, outlines, vec2(10.4, 5), 1)).toBe('panel1');
  });

  it('隐藏版型片不可选', () => {
    pattern.panels['panel1'].visible = false;
    expect(visiblePanelUnderPoint(pattern, outlines, vec2(10.4, 5), 1)).toBeNull();
    pattern.panels['panel1'].visible = true;
  });

  it('远处没有命中', () => {
    expect(visiblePanelUnderPoint(pattern, outlines, vec2(50, 50), 1)).toBeNull();
  });
});

describe('rectIntersectsBBox', () => {
  const pts = [vec2(0, 0), vec2(10, 10)];

  it('相交返回 true', () => {
    expect(rectIntersectsBBox({ min: vec2(5, 5), max: vec2(20, 20) }, pts)).toBe(true);
    expect(rectIntersectsBBox({ min: vec2(-5, -5), max: vec2(5, 5) }, pts)).toBe(true);
  });

  it('分离返回 false', () => {
    expect(rectIntersectsBBox({ min: vec2(11, 11), max: vec2(20, 20) }, pts)).toBe(false);
  });

  it('空点集返回 false', () => {
    expect(rectIntersectsBBox({ min: vec2(0, 0), max: vec2(1, 1) }, [])).toBe(false);
  });
});

describe('panelOutlineInRect', () => {
  const pattern = buildPattern();

  it('任一轮廓顶点在框内即命中', () => {
    expect(panelOutlineInRect(pattern, 'panel1', { min: vec2(-1, -1), max: vec2(1, 1) })).toBe(true);
    expect(panelOutlineInRect(pattern, 'panel1', { min: vec2(9, 9), max: vec2(12, 12) })).toBe(true);
  });

  it('框不含顶点时不命中', () => {
    expect(panelOutlineInRect(pattern, 'panel1', { min: vec2(2, 2), max: vec2(8, 8) })).toBe(false);
  });

  it('未知版型片返回 false', () => {
    expect(panelOutlineInRect(pattern, 'nope', { min: vec2(0, 0), max: vec2(1, 1) })).toBe(false);
  });
});
