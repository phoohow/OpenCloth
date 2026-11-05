import { describe, it, expect } from 'vitest';
import { vec2 } from '@/model/types';
import {
  offsetPolygon,
  offsetPolyline,
  computePolylineNormals,
  hasSelfIntersection,
  safeOffsetPolygon,
} from '@/common/geom';
import { computeBBox, signedPolygonArea, ensureCCW } from '@/common/geom';

// Counter-clockwise 10x10 square.
const square = [vec2(0, 0), vec2(10, 0), vec2(10, 10), vec2(0, 10)];

function bboxSize(poly: { x: number; y: number }[]) {
  const b = computeBBox(poly);
  return { w: b.max.x - b.min.x, h: b.max.y - b.min.y };
}

describe('offsetPolygon', () => {
  it('正值外扩增大多边形包围盒', () => {
    const out = offsetPolygon(square, 1);
    const before = bboxSize(square);
    const after = bboxSize(out);
    expect(after.w).toBeCloseTo(before.w + 2, 5);
    expect(after.h).toBeCloseTo(before.h + 2, 5);
  });

  it('负值内缩减小多边形包围盒', () => {
    const out = offsetPolygon(square, -1);
    const after = bboxSize(out);
    expect(after.w).toBeCloseTo(8, 5);
    expect(after.h).toBeCloseTo(8, 5);
  });

  it('保持顶点数量不变', () => {
    expect(offsetPolygon(square, 2).length).toBe(square.length);
  });

  it('外扩后面积增大', () => {
    const out = offsetPolygon(square, 1);
    expect(signedPolygonArea(out)).toBeGreaterThan(signedPolygonArea(square));
  });

  it('少于三个顶点时原样返回副本', () => {
    const line = [vec2(0, 0), vec2(1, 1)];
    const out = offsetPolygon(line, 5);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual(line[0]);
  });
});

describe('offsetPolyline / computePolylineNormals', () => {
  it('法线数量与点数一致且为单位长度', () => {
    const pts = [vec2(0, 0), vec2(10, 0), vec2(20, 0)];
    const normals = computePolylineNormals(pts);
    expect(normals).toHaveLength(3);
    for (const n of normals) {
      expect(Math.hypot(n.x, n.y)).toBeCloseTo(1, 5);
    }
  });

  it('水平折线偏移后沿法线方向平移', () => {
    const pts = [vec2(0, 0), vec2(10, 0)];
    const out = offsetPolyline(pts, 3);
    // perp of a horizontal segment is (0, -1), so a +3 offset lands at y = -3.
    expect(out[0].x).toBeCloseTo(0, 5);
    expect(out[0].y).toBeCloseTo(-3, 5);
  });

  it('单点原样返回', () => {
    expect(offsetPolyline([vec2(1, 2)], 5)).toEqual([vec2(1, 2)]);
  });
});

describe('hasSelfIntersection', () => {
  it('简单凸多边形不自交', () => {
    expect(hasSelfIntersection(square)).toBe(false);
  });

  it('蝴蝶结（8字形）多边形自交', () => {
    const bowtie = [vec2(0, 0), vec2(10, 10), vec2(10, 0), vec2(0, 10)];
    expect(hasSelfIntersection(bowtie)).toBe(true);
  });
});

describe('safeOffsetPolygon', () => {
  it('正常凸多边形偏移不自交', () => {
    const out = safeOffsetPolygon(square, -1);
    expect(hasSelfIntersection(out)).toBe(false);
    expect(out).toHaveLength(square.length);
  });

  it('大幅内缩退化时仍返回等量顶点（回退路径）', () => {
    const out = safeOffsetPolygon(square, -20);
    expect(out).toHaveLength(square.length);
  });
});

describe('ensureCCW', () => {
  it('顺时针多边形被翻转为逆时针', () => {
    const cw = [vec2(0, 0), vec2(0, 10), vec2(10, 10), vec2(10, 0)];
    expect(signedPolygonArea(cw)).toBeLessThan(0);
    const ccw = ensureCCW(cw);
    expect(signedPolygonArea(ccw)).toBeGreaterThan(0);
  });
});
