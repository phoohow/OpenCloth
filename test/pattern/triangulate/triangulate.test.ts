import { describe, it, expect } from 'vitest';
import { vec2 } from '../../../src/core/model/types';
import {
  triangulatePolygon,
  refineMesh,
  extractBoundaryEdges,
  buildAdjacency,
} from '../../../src/pattern/triangulate/triangulate';

const square = [vec2(0, 0), vec2(10, 0), vec2(10, 10), vec2(0, 10)];

describe('triangulatePolygon', () => {
  it('凸多边形三角化产生 n-2 个三角形', () => {
    const mesh = triangulatePolygon(square);
    expect(mesh.triangleCount).toBe(square.length - 2);
    expect(mesh.vertexCount).toBe(square.length);
    expect(mesh.indices.length).toBe(mesh.triangleCount * 3);
  });

  it('索引均在有效顶点范围内', () => {
    const mesh = triangulatePolygon(square);
    for (const idx of mesh.indices) {
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(mesh.vertexCount);
    }
  });

  it('支持带洞多边形（洞顶点并入 positions）', () => {
    const hole = [vec2(4, 4), vec2(6, 4), vec2(6, 6), vec2(4, 6)];
    const mesh = triangulatePolygon(square, [hole]);
    expect(mesh.vertexCount).toBe(square.length + hole.length);
    expect(mesh.triangleCount).toBeGreaterThan(0);
  });

  it('positions 为 flat [x,y] 布局', () => {
    const mesh = triangulatePolygon(square);
    expect(mesh.positions.length).toBe(mesh.vertexCount * 2);
    expect(mesh.positions[0]).toBeCloseTo(0, 5);
    expect(mesh.positions[2]).toBeCloseTo(10, 5);
  });
});

describe('refineMesh', () => {
  it('细化后三角形与顶点数量增加', () => {
    const base = triangulatePolygon(square);
    const refined = refineMesh(base, 2);
    expect(refined.triangleCount).toBeGreaterThan(base.triangleCount);
    expect(refined.vertexCount).toBeGreaterThan(base.vertexCount);
  });

  it('细化后最长边接近目标长度', () => {
    const base = triangulatePolygon(square);
    const target = 2.5;
    const refined = refineMesh(base, target);
    let maxEdge = 0;
    const pos = (i: number) => vec2(refined.positions[i * 2], refined.positions[i * 2 + 1]);
    for (let t = 0; t < refined.indices.length; t += 3) {
      const a = pos(refined.indices[t]);
      const b = pos(refined.indices[t + 1]);
      const c = pos(refined.indices[t + 2]);
      maxEdge = Math.max(
        maxEdge,
        Math.hypot(a.x - b.x, a.y - b.y),
        Math.hypot(b.x - c.x, b.y - c.y),
        Math.hypot(c.x - a.x, c.y - a.y),
      );
    }
    // Bisecting triggers above 1.5x the target, so the longest edge stays under target * 1.5.
    expect(maxEdge).toBeLessThanOrEqual(target * 1.5 + 1e-3);
  });

  it('目标边长很大时不细化', () => {
    const base = triangulatePolygon(square);
    const refined = refineMesh(base, 1000);
    expect(refined.triangleCount).toBe(base.triangleCount);
  });

  it('细化后网格无裂缝（无重合顶点、无悬挂节点、边最多被两个三角形共享）', () => {
    const base = triangulatePolygon(square);
    const refined = refineMesh(base, 1.2);
    const { positions, indices, vertexCount, triangleCount } = refined;

    // 1. No two vertices share a position (unwelded duplicates would tear apart in 3D).
    const seen = new Set<string>();
    for (let i = 0; i < vertexCount; i++) {
      const key = `${positions[i * 2].toFixed(6)},${positions[i * 2 + 1].toFixed(6)}`;
      expect(seen.has(key), `vertex ${i} duplicates position ${key}`).toBe(false);
      seen.add(key);
    }

    // 2. Every edge is used by at most two triangles.
    const edgeUse = new Map<string, number>();
    const edges: Array<[number, number]> = [];
    for (let t = 0; t < triangleCount; t++) {
      const tri = [indices[t * 3], indices[t * 3 + 1], indices[t * 3 + 2]];
      for (let e = 0; e < 3; e++) {
        const a = tri[e], b = tri[(e + 1) % 3];
        const key = a < b ? `${a}_${b}` : `${b}_${a}`;
        edgeUse.set(key, (edgeUse.get(key) ?? 0) + 1);
        edges.push([a, b]);
      }
    }
    for (const [key, count] of edgeUse) {
      expect(count, `edge ${key} used ${count} times`).toBeLessThanOrEqual(2);
    }

    // 3. No T-junction: no vertex lies strictly inside another edge.
    for (let m = 0; m < vertexCount; m++) {
      const mx = positions[m * 2], my = positions[m * 2 + 1];
      for (const [a, b] of edges) {
        if (a === m || b === m) continue;
        const ax = positions[a * 2], ay = positions[a * 2 + 1];
        const bx = positions[b * 2], by = positions[b * 2 + 1];
        const ab2 = (bx - ax) ** 2 + (by - ay) ** 2;
        const t = ((mx - ax) * (bx - ax) + (my - ay) * (by - ay)) / ab2;
        if (t <= 0.01 || t >= 0.99) continue;
        const px = ax + t * (bx - ax), py = ay + t * (by - ay);
        const onEdge = Math.hypot(mx - px, my - py) < 1e-6;
        expect(onEdge, `vertex ${m} hangs on edge ${a}_${b}`).toBe(false);
      }
    }
  });

  it('细化后三角形定向保持一致', () => {
    const base = triangulatePolygon(square);
    const refined = refineMesh(base, 2);
    const pos = (i: number) => vec2(refined.positions[i * 2], refined.positions[i * 2 + 1]);
    for (let t = 0; t < refined.triangleCount; t++) {
      const a = pos(refined.indices[t * 3]);
      const b = pos(refined.indices[t * 3 + 1]);
      const c = pos(refined.indices[t * 3 + 2]);
      const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      expect(cross).toBeGreaterThan(0);
    }
  });
});

describe('extractBoundaryEdges', () => {
  it('正方形网格边界边数量等于顶点数', () => {
    const mesh = triangulatePolygon(square);
    const edges = extractBoundaryEdges(mesh);
    expect(edges).toHaveLength(square.length);
  });
});

describe('buildAdjacency', () => {
  it('两个三角形共享一条边 → 一对邻接', () => {
    const mesh = triangulatePolygon(square);
    const pairs = buildAdjacency(mesh);
    // The n-2 triangles form a tree, so there are triangleCount - 1 adjacent pairs.
    expect(pairs).toHaveLength(mesh.triangleCount - 1);
  });
});
