import { describe, it, expect } from 'vitest';
import { vec2 } from '../../../src/core/model/types';
import {
  offsetPolygon,
  offsetPolygonStyled,
  offsetOutlinePerEdge,
  hasSelfIntersection,
} from '../../../src/pattern/geom/offset';
import { computeBBox, polygonArea } from '../../../src/pattern/geom/vec2';

// Counter-clockwise 10x10 square.
const square = [vec2(0, 0), vec2(10, 0), vec2(10, 10), vec2(0, 10)];

function bboxSize(poly: { x: number; y: number }[]) {
  const b = computeBBox(poly);
  return { w: b.max.x - b.min.x, h: b.max.y - b.min.y };
}

describe('offsetPolygonStyled', () => {
  it('miter 与 offsetPolygon 结果一致', () => {
    expect(offsetPolygonStyled(square, 1, 'miter')).toEqual(offsetPolygon(square, 1));
    expect(offsetPolygonStyled(square, -1, 'miter')).toEqual(offsetPolygon(square, -1));
  });

  it('round 外扩用圆弧替代尖角', () => {
    const out = offsetPolygonStyled(square, 1, 'round');
    const size = bboxSize(out);
    expect(size.w).toBeCloseTo(12, 5);
    expect(size.h).toBeCloseTo(12, 5);
    // 12x12 minus four corners outside the unit arcs: 144 - (4 - pi).
    expect(polygonArea(out)).toBeCloseTo(144 - (4 - Math.PI), 1);
    // Four gap corners, each an endpoint pair plus arc samples.
    expect(out.length).toBeGreaterThan(8);
    expect(hasSelfIntersection(out)).toBe(false);
  });

  it('round 圆弧上的点等距于原顶点', () => {
    const out = offsetPolygonStyled(square, 1, 'round');
    // Corner (10,0) region: points closer than 0.6 to the vertex are arc samples.
    const near = out.filter(p => Math.hypot(p.x - 10, p.y - 0) < 1.5);
    expect(near.length).toBeGreaterThanOrEqual(5);
    for (const p of near) {
      expect(Math.hypot(p.x - 10, p.y - 0)).toBeCloseTo(1, 6);
    }
  });

  it('bevel 外扩生成倒角且面积为八边形', () => {
    const out = offsetPolygonStyled(square, 1, 'bevel');
    expect(out).toHaveLength(8);
    expect(polygonArea(out)).toBeCloseTo(142, 6);
    expect(hasSelfIntersection(out)).toBe(false);
  });

  it('凸角内缩时 round 与 miter 完全一致', () => {
    const round = offsetPolygonStyled(square, -1, 'round');
    const miter = offsetPolygon(square, -1);
    expect(round).toHaveLength(miter.length);
    for (let i = 0; i < miter.length; i++) {
      expect(round[i].x).toBeCloseTo(miter[i].x, 9);
      expect(round[i].y).toBeCloseTo(miter[i].y, 9);
    }
  });

  it('凹角内缩时 round 比 bevel 多切掉一个弓形', () => {
    const lShape = [vec2(0, 0), vec2(10, 0), vec2(10, 3), vec2(3, 3), vec2(3, 10), vec2(0, 10)];
    const round = offsetPolygonStyled(lShape, -1, 'round');
    const bevel = offsetPolygonStyled(lShape, -1, 'bevel');
    // The reflex join arc reaches into the material beyond its chord by (pi/4 - 1/2),
    // minus the chord-discretization of the 15-degree arc samples.
    expect(polygonArea(bevel) - polygonArea(round)).toBeCloseTo(Math.PI / 4 - 0.5, 1);
    expect(hasSelfIntersection(round)).toBe(false);
    expect(hasSelfIntersection(bevel)).toBe(false);
  });

  it('顺时针输入保持方向：正值沿行进右侧偏移', () => {
    const cw = [...square].reverse();
    expect(polygonArea(cw)).toBeLessThan(0);
    // Positive distance on a CW ring moves to the travel side, i.e. shrinks.
    const out = offsetPolygonStyled(cw, 1, 'round');
    expect(polygonArea(out)).toBeCloseTo(-64, 6);
    expect(out).toHaveLength(4);
    // Negative distance expands with bevel cuts.
    const outBevel = offsetPolygonStyled(cw, -1, 'bevel');
    expect(polygonArea(outBevel)).toBeLessThan(0);
    expect(Math.abs(polygonArea(outBevel))).toBeCloseTo(142, 6);
    expect(outBevel).toHaveLength(8);
  });

  it('零偏移与退化输入返回副本', () => {
    expect(offsetPolygonStyled(square, 0, 'round')).toEqual(square);
    expect(offsetPolygonStyled([vec2(0, 0), vec2(1, 1)], 2, 'bevel')).toHaveLength(2);
  });
});

describe('offsetOutlinePerEdge', () => {
  it('逐顶点偏移与法线一致', () => {
    const out = offsetOutlinePerEdge(square, [1, 1, 1, 1]);
    // Square corners have axis-diagonal vertex normals.
    expect(out[0].x).toBeCloseTo(-Math.SQRT1_2, 6);
    expect(out[0].y).toBeCloseTo(-Math.SQRT1_2, 6);
    expect(out[1].x).toBeCloseTo(10 + Math.SQRT1_2, 6);
    expect(out[1].y).toBeCloseTo(-Math.SQRT1_2, 6);
  });

  it('统一偏移接受单个数值', () => {
    const out = offsetOutlinePerEdge(square, [2]);
    expect(out).toHaveLength(4);
    expect(out[2].x).toBeCloseTo(10 + 2 * Math.SQRT1_2, 6);
    expect(out[2].y).toBeCloseTo(10 + 2 * Math.SQRT1_2, 6);
  });

  it('逐边偏移按缝合规则取邻边缝份', () => {
    const samples = square;
    const counts = [1, 1, 1, 1];
    const allowances = [1, 2, 1, 2];
    const out = offsetOutlinePerEdge(samples, allowances, counts);
    expect(out).toHaveLength(4);
    const s = Math.SQRT1_2;
    expect(out[0].x).toBeCloseTo(-s, 6);
    expect(out[0].y).toBeCloseTo(-s, 6);
    // Corner (10,0) uses edge 0 allowance 1.
    expect(out[1].x).toBeCloseTo(10 + s, 6);
    expect(out[1].y).toBeCloseTo(-s, 6);
    // Corner (10,10) uses edge 1 allowance 2.
    expect(out[2].x).toBeCloseTo(10 + 2 * s, 6);
    expect(out[2].y).toBeCloseTo(10 + 2 * s, 6);
    // Corner (0,10) uses edge 2 allowance 1.
    expect(out[3].x).toBeCloseTo(-s, 6);
    expect(out[3].y).toBeCloseTo(10 + s, 6);
  });

  it('密采样轮廓逐边偏移与 panelBuilder 缝合等价', () => {
    // Bottom edge sampled mid-way: counts [2,1,2,1], six vertices total.
    const samples = [vec2(0, 0), vec2(5, 0), vec2(10, 0), vec2(10, 10), vec2(5, 10), vec2(0, 10)];
    const counts = [2, 1, 2, 1];
    const allowances = [1, 3, 1, 3];
    const out = offsetOutlinePerEdge(samples, allowances, counts);
    expect(out).toHaveLength(samples.length);
    // Every sample moved strictly along its vertex normal by its owning edge allowance.
    const normalAt = (i: number) => {
      const prev = samples[(i - 1 + 6) % 6];
      const next = samples[(i + 1) % 6];
      const tx = next.x - prev.x, ty = next.y - prev.y;
      const len = Math.hypot(tx, ty);
      return { x: ty / len, y: -tx / len };
    };
    // Vertex 0 takes the allowance of the edge starting there; the others take the
    // allowance of the edge ending at them.
    const order = [0, 0, 0, 1, 2, 2];
    for (let i = 0; i < 6; i++) {
      const a = allowances[order[i]];
      const n = normalAt(i);
      expect(out[i].x).toBeCloseTo(samples[i].x + n.x * a, 6);
      expect(out[i].y).toBeCloseTo(samples[i].y + n.y * a, 6);
    }
  });

  it('长度不匹配时报错', () => {
    expect(() => offsetOutlinePerEdge(square, [1, 2])).toThrow();
    expect(() => offsetOutlinePerEdge(square, [1, 2, 1], [1, 1])).toThrow();
  });

  it('退化输入返回副本', () => {
    expect(offsetOutlinePerEdge([vec2(0, 0), vec2(1, 0)], [1])).toHaveLength(2);
  });
});

describe('offsetPolygonStyled 逐顶点参数', () => {
  it('只给某个角点圆角时只影响那个角', () => {
    const out = offsetPolygonStyled(square, 1, ['round', 'miter', 'miter', 'miter']);
    const allRound = offsetPolygonStyled(square, 1, 'round');
    expect(out.length).toBeLessThan(allRound.length);
    expect(out.length).toBeGreaterThan(4);
    // The rounded corner is (0,0); the mitred one at (10,0) stays a single spike point.
    const nearOrigin = out.filter(p => Math.hypot(p.x - 0, p.y - 0) < 2.5);
    expect(nearOrigin.length).toBeGreaterThan(2);
    const nearRight = out.filter(p => Math.hypot(p.x - 10, p.y - 0) < 2.5);
    expect(nearRight).toHaveLength(1);
    expect(hasSelfIntersection(out)).toBe(false);
  });

  it('斜角在角点处切成一条弦', () => {
    const out = offsetPolygonStyled(square, 1, ['bevel', 'miter', 'miter', 'miter']);
    // A bevelled gap corner emits both offset points instead of one miter spike.
    expect(out.filter(p => Math.hypot(p.x - 0, p.y - 0) < 2.5).length).toBeGreaterThanOrEqual(2);
    expect(hasSelfIntersection(out)).toBe(false);
  });

  it('全尖角且距离一致时与 offsetPolygon 逐点一致', () => {
    const dists = [1, 1, 1, 1];
    expect(offsetPolygonStyled(square, dists, ['miter', 'miter', 'miter', 'miter']))
      .toEqual(offsetPolygon(square, 1));
  });

  it('相邻两边缝份不同时用两条偏移线的交点收尾', () => {
    const out = offsetPolygonStyled(square, [1, 2, 2, 2], 'miter');
    // The corner between the 1 cm and the 2 cm side sits 2 cm off that side.
    const bottomRight = out.find(p => p.x > 10.5 && p.y < 0);
    expect(bottomRight).toBeDefined();
    expect(bottomRight!.y).toBeCloseTo(-2, 5);
    expect(hasSelfIntersection(out)).toBe(false);
  });

  it('顺时针输入全尖角时与 offsetPolygon 逐点一致', () => {
    const cw = [...square].reverse();
    const mitered = ['miter', 'miter', 'miter', 'miter'] as const;
    expect(offsetPolygonStyled(cw, [-1, -1, -1, -1], [...mitered])).toEqual(offsetPolygon(cw, -1));
  });

  it('顺时针输入把圆角留在被指定的那个角点上', () => {
    const cw = [...square].reverse();
    const out = offsetPolygonStyled(cw, [-1, -1, -1, -1], ['round', 'miter', 'miter', 'miter']);
    // cw[0] is (0, 10); shrinking a clockwise ring moves that corner outward to (-1, 11).
    expect(out.filter(p => Math.hypot(p.x + 1, p.y - 11) < 2).length).toBeGreaterThan(2);
    expect(out.filter(p => Math.hypot(p.x - 11, p.y - 0) < 2)).toHaveLength(1);
    expect(hasSelfIntersection(out)).toBe(false);
  });
});
