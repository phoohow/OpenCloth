import { describe, it, expect } from 'vitest';
import { vec2, type Vec2 } from '@/model/types';
import { remeshPolygon } from '@/pattern/triangulate/remesh';
import { resampleClosedOutline, type TriangleMesh } from '@/pattern/triangulate/triangulate';

const rect = (w: number, h: number): Vec2[] => [vec2(0, 0), vec2(w, 0), vec2(w, h), vec2(0, h)];

const edgeKey = (a: number, b: number): string => (a < b ? `${a}_${b}` : `${b}_${a}`);

function edgesOf(mesh: TriangleMesh): Map<string, number> {
  const uses = new Map<string, number>();
  for (let t = 0; t < mesh.indices.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const key = edgeKey(mesh.indices[t + e]!, mesh.indices[t + ((e + 1) % 3)]!);
      uses.set(key, (uses.get(key) ?? 0) + 1);
    }
  }
  return uses;
}

function point(mesh: TriangleMesh, i: number): Vec2 {
  return vec2(mesh.positions[i * 2]!, mesh.positions[i * 2 + 1]!);
}

function edgeLengths(mesh: TriangleMesh): number[] {
  const out: number[] = [];
  for (const key of edgesOf(mesh).keys()) {
    const [a, b] = key.split('_').map(Number) as [number, number];
    out.push(Math.hypot(point(mesh, a).x - point(mesh, b).x, point(mesh, a).y - point(mesh, b).y));
  }
  return out.sort((x, y) => x - y);
}

function triangleAngles(mesh: TriangleMesh): number[] {
  const out: number[] = [];
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const tri = [point(mesh, mesh.indices[t]!), point(mesh, mesh.indices[t + 1]!), point(mesh, mesh.indices[t + 2]!)];
    for (let i = 0; i < 3; i++) {
      const at = tri[i]!, u = tri[(i + 1) % 3]!, v = tri[(i + 2) % 3]!;
      const ux = u.x - at.x, uy = u.y - at.y, vx = v.x - at.x, vy = v.y - at.y;
      const cos = (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy) || 1);
      out.push((Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI);
    }
  }
  return out.sort((x, y) => x - y);
}

const percentile = (sorted: number[], p: number): number =>
  sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;

describe('remeshPolygon', () => {
  const spacing = 2;
  const outline = resampleClosedOutline(rect(40, 60), spacing);
  const mesh = remeshPolygon(outline, [], spacing);

  it('铺满整片且顶点数接近面积所需', () => {
    const area = 40 * 60;
    const ideal = area / (spacing * spacing * (Math.sqrt(3) / 2));
    expect(mesh.triangleCount).toBeGreaterThan(0);
    expect(mesh.vertexCount).toBeGreaterThan(ideal * 0.7);
    expect(mesh.vertexCount).toBeLessThan(ideal * 1.4);
  });

  it('保留完整轮廓，采样点之间的边都在网格里', () => {
    const uses = edgesOf(mesh);
    expect(uses.size).toBeGreaterThan(0);
    for (let i = 0; i < outline.length; i++) {
      const key = edgeKey(i, (i + 1) % outline.length);
      expect(uses.has(key), `outline edge ${key} missing`).toBe(true);
    }
  });

  it('无裂缝：边最多被两个三角形共享，顶点位置不重合', () => {
    for (const [key, uses] of edgesOf(mesh)) {
      expect(uses, `edge ${key} used ${uses} times`).toBeLessThanOrEqual(2);
    }
    const seen = new Set<string>();
    for (let i = 0; i < mesh.vertexCount; i++) {
      const p = point(mesh, i);
      const key = `${p.x.toFixed(6)},${p.y.toFixed(6)}`;
      expect(seen.has(key), `vertex ${i} duplicates ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it('没有悬挂节点（顶点不在另一条边内部）', () => {
    for (const key of edgesOf(mesh).keys()) {
      const [a, b] = key.split('_').map(Number) as [number, number];
      const pa = point(mesh, a), pb = point(mesh, b);
      for (let m = 0; m < mesh.vertexCount; m++) {
        if (m === a || m === b) continue;
        const pm = point(mesh, m);
        const abx = pb.x - pa.x, aby = pb.y - pa.y;
        const lengthSquared = abx * abx + aby * aby;
        const t = ((pm.x - pa.x) * abx + (pm.y - pa.y) * aby) / lengthSquared;
        if (t <= 0.01 || t >= 0.99) continue;
        const hanging = Math.hypot(pm.x - (pa.x + abx * t), pm.y - (pa.y + aby * t)) < 1e-6;
        expect(hanging, `vertex ${m} hangs on edge ${key}`).toBe(false);
      }
    }
  });

  it('三角形定向一致（逆时针）', () => {
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const a = point(mesh, mesh.indices[t]!), b = point(mesh, mesh.indices[t + 1]!), c = point(mesh, mesh.indices[t + 2]!);
      expect((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)).toBeGreaterThan(0);
    }
  });

  it('边长接近目标长度，角度不小于 20 度', () => {
    const lengths = edgeLengths(mesh);
    expect(lengths[lengths.length - 1]).toBeLessThanOrEqual(spacing * (4 / 3) + 1e-6);
    expect(percentile(lengths, 0.5)).toBeGreaterThan(spacing * 0.7);
    expect(percentile(lengths, 0.5)).toBeLessThan(spacing * 1.1);
    expect(percentile(triangleAngles(mesh), 0.01)).toBeGreaterThanOrEqual(20);
  });

  it('带内孔时孔洞保持镂空', () => {
    const hole = resampleClosedOutline([vec2(10, 20), vec2(20, 20), vec2(20, 35), vec2(10, 35)], spacing);
    const holed = remeshPolygon(outline, [hole], spacing);
    const uses = edgesOf(holed);
    for (let i = 0; i < hole.length; i++) {
      const key = edgeKey(outline.length + i, outline.length + ((i + 1) % hole.length));
      expect(uses.has(key), `hole edge ${key} missing`).toBe(true);
    }
    // No triangle covers the hole centre.
    const centre = vec2(15, 27.5);
    for (let t = 0; t < holed.indices.length; t += 3) {
      const a = point(holed, holed.indices[t]!), b = point(holed, holed.indices[t + 1]!), c = point(holed, holed.indices[t + 2]!);
      const x = (a.x + b.x + c.x) / 3, y = (a.y + b.y + c.y) / 3;
      expect(Math.hypot(x - centre.x, y - centre.y)).toBeGreaterThan(0.5);
    }
  });

  it('目标边长大于整片时不再加密', () => {
    const coarse = remeshPolygon(outline, [], 1000);
    expect(coarse.vertexCount).toBe(outline.length);
    expect(coarse.triangleCount).toBe(outline.length - 2);
  });

  it('同样的输入得到同样的网格', () => {
    const again = remeshPolygon(outline, [], spacing);
    expect(again.vertexCount).toBe(mesh.vertexCount);
    expect(Array.from(again.indices)).toEqual(Array.from(mesh.indices));
  });

  it('轮廓点少于三个时返回空网格', () => {
    expect(remeshPolygon([vec2(0, 0), vec2(1, 1)], [], spacing).triangleCount).toBe(0);
  });
});

describe('remeshPolygon 退化形状', () => {
  const outlineKeys = (mesh: TriangleMesh): Set<string> =>
    new Set(edgesOf(mesh).keys());

  const expectOutlineKept = (mesh: TriangleMesh, loops: Vec2[][], spacing: number): void => {
    const keys = outlineKeys(mesh);
    let offset = 0;
    for (const loop of loops.map(l => resampleClosedOutline(l, spacing))) {
      for (let i = 0; i < loop.length; i++) {
        const key = edgeKey(offset + i, offset + ((i + 1) % loop.length));
        expect(keys.has(key), `outline edge ${key} missing`).toBe(true);
      }
      offset += loop.length;
    }
    for (const uses of edgesOf(mesh).values()) expect(uses).toBeLessThanOrEqual(2);
  };

  it('窄条（比目标边长还窄）仍闭合', () => {
    const strip = [vec2(0, 0), vec2(0.5, 0), vec2(0.5, 30), vec2(0, 30)];
    expectOutlineKept(remeshPolygon(resampleClosedOutline(strip, 2.5), [], 2.5), [strip], 2.5);
  });

  it('贴边的内孔不吞掉轮廓', () => {
    const box = [vec2(0, 0), vec2(20, 0), vec2(20, 20), vec2(0, 20)];
    const hole = [vec2(0.5, 5), vec2(6, 5), vec2(6, 12), vec2(0.5, 12)];
    const mesh = remeshPolygon(
      resampleClosedOutline(box, 1.5), [resampleClosedOutline(hole, 1.5)], 1.5,
    );
    expectOutlineKept(mesh, [box, hole], 1.5);
  });

  it('多个内孔各自保留', () => {
    const box = [vec2(0, 0), vec2(22, 0), vec2(22, 22), vec2(0, 22)];
    const holes: Vec2[][] = [];
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        const x = 3 + i * 5, y = 3 + j * 5;
        holes.push([vec2(x, y), vec2(x + 2, y), vec2(x + 2, y + 2), vec2(x, y + 2)]);
      }
    }
    const mesh = remeshPolygon(
      resampleClosedOutline(box, 1), holes.map(loop => resampleClosedOutline(loop, 1)), 1,
    );
    expectOutlineKept(mesh, [box, ...holes], 1);
  });
});

describe('remeshPolygon 蓝噪声撒点', () => {
  const spacing = 2;
  const outline = resampleClosedOutline(rect(40, 60), spacing);

  it('两种撒点方式都满足轮廓、边长与角度约束', () => {
    for (const sampling of ['lattice', 'blueNoise'] as const) {
      const mesh = remeshPolygon(outline, [], spacing, sampling);
      const lengths = edgeLengths(mesh);
      expect(lengths[lengths.length - 1]!, sampling).toBeLessThanOrEqual(spacing * (4 / 3) + 1e-6);
      expect(percentile(lengths, 0.5), sampling).toBeGreaterThan(spacing * 0.7);
      expect(percentile(lengths, 0.5), sampling).toBeLessThan(spacing * 1.15);
      expect(percentile(triangleAngles(mesh), 0.01), sampling).toBeGreaterThanOrEqual(20);
      for (let i = 0; i < outline.length; i++) {
        expect(edgesOf(mesh).has(edgeKey(i, (i + 1) % outline.length)), `${sampling} outline ${i}`).toBe(true);
      }
    }
  });

  it('蓝噪声的网格没有晶格的方向性：各撒点方式结果不同', () => {
    const lattice = remeshPolygon(outline, [], spacing, 'lattice');
    const blueNoise = remeshPolygon(outline, [], spacing, 'blueNoise');
    expect(Array.from(blueNoise.indices)).not.toEqual(Array.from(lattice.indices));
  });

  it('蓝噪声同样确定', () => {
    const again = remeshPolygon(outline, [], spacing, 'blueNoise');
    const blueNoise = remeshPolygon(outline, [], spacing, 'blueNoise');
    expect(Array.from(again.indices)).toEqual(Array.from(blueNoise.indices));
  });

  it('带内孔时蓝噪声同样保持孔洞', () => {
    const hole = resampleClosedOutline([vec2(10, 20), vec2(20, 20), vec2(20, 35), vec2(10, 35)], spacing);
    const holed = remeshPolygon(outline, [hole], spacing, 'blueNoise');
    const uses = edgesOf(holed);
    for (let i = 0; i < hole.length; i++) {
      expect(uses.has(edgeKey(outline.length + i, outline.length + ((i + 1) % hole.length)))).toBe(true);
    }
  });
});
