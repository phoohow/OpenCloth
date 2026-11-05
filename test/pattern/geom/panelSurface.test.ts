import { describe, it, expect } from 'vitest';
import { barycentricWeights3D, trianglePointToPanel2D, type Triple } from '@/common/geom';

const origin: Triple = [0, 0, 0];
const alongX: Triple = [10, 0, 0];
const alongY: Triple = [0, 10, 0];

describe('barycentricWeights3D', () => {
  it('三角形重心给出三等分权重', () => {
    const weights = barycentricWeights3D([10 / 3, 10 / 3, 0], origin, alongX, alongY);
    expect(weights).not.toBeNull();
    expect(weights![0]).toBeCloseTo(1 / 3, 6);
    expect(weights![1]).toBeCloseTo(1 / 3, 6);
    expect(weights![2]).toBeCloseTo(1 / 3, 6);
  });

  it('落在顶点上的点权重集中在该顶点', () => {
    const weights = barycentricWeights3D(alongX, origin, alongX, alongY);
    expect(weights![0]).toBeCloseTo(0, 6);
    expect(weights![1]).toBeCloseTo(1, 6);
    expect(weights![2]).toBeCloseTo(0, 6);
  });

  it('投影到三角形平面，离面高度不影响权重', () => {
    const flat = barycentricWeights3D([10 / 3, 10 / 3, 0], origin, alongX, alongY);
    const lifted = barycentricWeights3D([10 / 3, 10 / 3, 4], origin, alongX, alongY);
    expect(lifted).not.toBeNull();
    expect(lifted![0]).toBeCloseTo(flat![0], 6);
    expect(lifted![1]).toBeCloseTo(flat![1], 6);
    expect(lifted![2]).toBeCloseTo(flat![2], 6);
  });

  it('退化三角形返回 null', () => {
    expect(barycentricWeights3D([1, 1, 0], origin, [5, 0, 0], [10, 0, 0])).toBeNull();
  });
});

describe('trianglePointToPanel2D', () => {
  /** Flat mesh positions of three panel vertices, in centimetres. */
  const flat = new Float32Array([0, 0, 10, 0, 0, 10]);

  it('按权重插值出面板平面点', () => {
    const point = trianglePointToPanel2D(10, flat, [10, 11, 12], [1 / 3, 1 / 3, 1 / 3]);
    expect(point).not.toBeNull();
    expect(point!.x).toBeCloseTo(10 / 3, 6);
    expect(point!.y).toBeCloseTo(10 / 3, 6);
  });

  it('单个顶点的权重返回该顶点的面板坐标', () => {
    const point = trianglePointToPanel2D(10, flat, [10, 11, 12], [0, 0, 1]);
    expect(point).toEqual({ x: 0, y: 10 });
  });

  it('粒子编号超出面板范围时返回 null', () => {
    expect(trianglePointToPanel2D(10, flat, [10, 11, 13], [1, 0, 0])).toBeNull();
    expect(trianglePointToPanel2D(10, flat, [9, 10, 11], [1, 0, 0])).toBeNull();
  });
});
