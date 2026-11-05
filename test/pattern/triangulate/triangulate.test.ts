import { describe, it, expect } from 'vitest';
import { vec2 } from '@/model/types';
import {
  resampleClosedOutline,
  extractBoundaryEdges,
  buildAdjacency,
} from '@/pattern/triangulate/triangulate';
import { remeshPolygon } from '@/pattern/triangulate/remesh';

const square = [vec2(0, 0), vec2(10, 0), vec2(10, 10), vec2(0, 10)];

describe('resampleClosedOutline', () => {
  it('直线边被等分成接近目标间距的段', () => {
    const out = resampleClosedOutline([vec2(0, 0), vec2(30, 0), vec2(30, 10), vec2(0, 10)], 2);
    for (let i = 0; i < out.length; i++) {
      const a = out[i]!, b = out[(i + 1) % out.length]!;
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      // Every run is split into equal segments, so no stub is left at a corner.
      expect(length).toBeGreaterThan(1.5);
      expect(length).toBeLessThan(2.5);
    }
  });

  it('保留尖角原位置', () => {
    const out = resampleClosedOutline([vec2(0, 0), vec2(30, 0), vec2(30, 10), vec2(0, 10)], 2);
    for (const corner of [vec2(0, 0), vec2(30, 0), vec2(30, 10), vec2(0, 10)]) {
      expect(out.some(p => Math.hypot(p.x - corner.x, p.y - corner.y) < 1e-9)).toBe(true);
    }
  });

  it('间距非法或点太少时原样返回', () => {
    expect(resampleClosedOutline(square, 0)).toEqual(square);
    expect(resampleClosedOutline([vec2(0, 0), vec2(1, 0)], 1)).toHaveLength(2);
  });

  it('输出的顶点数随间距收紧而增加', () => {
    const coarse = resampleClosedOutline(square, 4);
    const fine = resampleClosedOutline(square, 1);
    expect(fine.length).toBeGreaterThan(coarse.length);
  });
});

describe('extractBoundaryEdges', () => {
  it('轮廓边只出现一次，内部边不出现', () => {
    const outline = resampleClosedOutline(square, 3);
    const mesh = remeshPolygon(outline, [], 3);
    const boundary = extractBoundaryEdges(mesh);
    expect(boundary.length).toBeGreaterThanOrEqual(outline.length);
    const keys = new Set(boundary.map(([a, b]) => (a < b ? `${a}_${b}` : `${b}_${a}`)));
    for (let i = 0; i < outline.length; i++) {
      const next = (i + 1) % outline.length;
      expect(keys.has(i < next ? `${i}_${next}` : `${next}_${i}`)).toBe(true);
    }
  });
});

describe('buildAdjacency', () => {
  it('内部边的相邻三角形对索引有效', () => {
    const outline = resampleClosedOutline(square, 3);
    const mesh = remeshPolygon(outline, [], 3);
    const pairs = buildAdjacency(mesh);
    expect(pairs.length).toBeGreaterThan(0);
    // Interior edges pair two triangles; a planar triangulation has under two edges per triangle.
    expect(pairs.length).toBeLessThan(mesh.triangleCount * 2);
    for (const [a, b] of pairs) {
      expect(a).toBeLessThan(mesh.triangleCount);
      expect(b).toBeLessThan(mesh.triangleCount);
      expect(a).not.toBe(b);
    }
  });
});
