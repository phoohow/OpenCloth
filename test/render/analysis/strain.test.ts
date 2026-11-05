import { describe, expect, it } from 'vitest';
import {
  computeVertexStrain,
  strainColor,
  strainStats,
} from '@/analysis/strain';

/** Right triangle: v0 at the origin, v1 on +X, v2 on +Y. */
const REST_TRIANGLE = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
const TRIANGLE_INDICES = new Uint32Array([0, 1, 2]);

/** Moves v0 of the rest triangle to (x, y, 0). */
function triangleWithMovedV0(x: number, y = 0): Float32Array {
  return new Float32Array([x, y, 0, 1, 0, 0, 0, 1, 0]);
}

describe('computeVertexStrain', () => {
  it('returns zeros for an undeformed triangle', () => {
    const strain = computeVertexStrain(REST_TRIANGLE, REST_TRIANGLE, TRIANGLE_INDICES);

    expect(Array.from(strain)).toEqual([0, 0, 0]);
  });

  it('reports positive strain at both ends of an edge stretched along x', () => {
    const current = triangleWithMovedV0(-0.1);
    const strain = computeVertexStrain(REST_TRIANGLE, current, TRIANGLE_INDICES);

    // Edge v0-v1 measures 1.1, edge v2-v0 measures hypot(0.1, 1).
    const edge01 = 0.1;
    const edge20 = Math.hypot(0.1, 1) - 1;

    expect(strain[0]).toBeCloseTo((edge01 + edge20) / 2, 5);
    expect(strain[1]).toBeCloseTo(edge01 / 2, 5);
    // Opposite vertex v2 only touches the shortened-by-small-stretch edge v2-v0.
    expect(strain[2]).toBeCloseTo(edge20 / 2, 5);
    expect(strain[0]).toBeGreaterThan(0);
    expect(strain[1]).toBeGreaterThan(0);
    expect(strain[2]).toBeGreaterThan(0);
    expect(strain[2]).toBeLessThan(strain[1]);
  });

  it('reports negative strain for compression', () => {
    const current = new Float32Array([0, 0, 0, 0.5, 0, 0, 0, 0.5, 0]);
    const strain = computeVertexStrain(REST_TRIANGLE, current, TRIANGLE_INDICES);

    for (const value of strain) expect(value).toBeCloseTo(-0.5, 5);
  });

  it('keeps a zero-length rest edge finite', () => {
    const rest = new Float32Array([0, 0, 0, 0, 0, 0, 1, 0, 0]);
    const current = new Float32Array([0.25, 0, 0, 0, 0, 0, 1, 0, 0]);
    const strain = computeVertexStrain(rest, current, TRIANGLE_INDICES);

    for (const value of strain) {
      expect(Number.isFinite(value)).toBe(true);
      expect(Number.isNaN(value)).toBe(false);
    }
    expect(strain[0]).toBeCloseTo((0.25 / 1e-6 - 0.25) / 2, 1);
    expect(strain[2]).toBeCloseTo(-0.125, 5);
  });

  it('returns zeros for a fully collapsed rest triangle', () => {
    const collapsed = new Float32Array(9);
    const strain = computeVertexStrain(collapsed, collapsed, TRIANGLE_INDICES);

    expect(Array.from(strain)).toEqual([0, 0, 0]);
  });

  it('skips non-finite coordinates', () => {
    const current = new Float32Array([Number.NaN, 0, 0, 1, 0, 0, 0, 1, 0]);
    const strain = computeVertexStrain(REST_TRIANGLE, current, TRIANGLE_INDICES);

    expect(Array.from(strain)).toEqual([0, 0, 0]);
  });

  it('returns an empty array when there are fewer than three vertices', () => {
    const rest = new Float32Array([0, 0, 0, 1, 0, 0]);
    const current = new Float32Array([0, 0, 0, 1, 0, 0]);

    expect(computeVertexStrain(rest, current, TRIANGLE_INDICES).length).toBe(0);
  });

  it('ignores triangles referencing vertices outside the position buffer', () => {
    const indices = new Uint32Array([0, 1, 3]);
    const strain = computeVertexStrain(REST_TRIANGLE, REST_TRIANGLE, indices);

    expect(Array.from(strain)).toEqual([0, 0, 0]);
  });
});

describe('strainStats', () => {
  it('reports zeros for an empty input', () => {
    expect(strainStats(new Float32Array(0)))
      .toEqual({ min: 0, max: 0, meanAbs: 0, vertices: 0, overStretch: 0, overCompression: 0 });
  });

  it('reports signed extremes and mean absolute value', () => {
    const stats = strainStats(new Float32Array([-0.5, 0.25, 0.25]));

    expect(stats.min).toBeCloseTo(-0.5, 5);
    expect(stats.max).toBeCloseTo(0.25, 5);
    expect(stats.meanAbs).toBeCloseTo(1 / 3, 5);
  });

  it('ignores non-finite values', () => {
    const stats = strainStats(new Float32Array([-0.2, Number.NaN, 0.4]));

    expect(stats.min).toBeCloseTo(-0.2, 5);
    expect(stats.max).toBeCloseTo(0.4, 5);
    expect(stats.meanAbs).toBeCloseTo(0.3, 5);
  });
});

describe('strainColor', () => {
  it('maps compression to blue, zero to white and stretch to red', () => {
    expect(strainColor(-0.25)).toEqual([0, 0, 1]);
    expect(strainColor(0)).toEqual([1, 1, 1]);
    expect(strainColor(0.25)).toEqual([1, 0, 0]);
  });

  it('clamps values outside the range to the end colors', () => {
    expect(strainColor(-5)).toEqual([0, 0, 1]);
    expect(strainColor(5)).toEqual([1, 0, 0]);
  });

  it('blends linearly towards white', () => {
    expect(strainColor(-0.125)).toEqual([0.5, 0.5, 1]);
    expect(strainColor(0.125)).toEqual([1, 0.5, 0.5]);
  });

  it('honours a custom range', () => {
    expect(strainColor(-0.5, -1, 1)).toEqual([0.5, 0.5, 1]);
    expect(strainColor(0, -1, 1)).toEqual([1, 1, 1]);
  });

  it('returns white when min is not below max', () => {
    expect(strainColor(0.1, 0.2, 0.2)).toEqual([1, 1, 1]);
    expect(strainColor(0.1, 1, 0.2)).toEqual([1, 1, 1]);
  });

  it('returns white for non-finite input', () => {
    expect(strainColor(Number.NaN)).toEqual([1, 1, 1]);
  });
});
