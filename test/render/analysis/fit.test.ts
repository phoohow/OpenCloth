import { describe, expect, it } from 'vitest';
import { computeFitField, DEFAULT_FIT_THRESHOLDS, fitColor, fitStats } from '../../../src/render/analysis/fit';
import type { AvatarSDF } from '../../../src/avatar/sdf/avatarSDF';

/** Vertical capsule of radius 0.1 m centred on the Y axis. */
const sdf: AvatarSDF = {
  capsules: [{ ax: 0, ay: 0, az: 0, bx: 0, by: 0.2, bz: 0, radius: 0.1 }],
  bounds: { min: [-0.1, 0, -0.1], max: [0.1, 0.2, 0.1] },
};

describe('computeFitField', () => {
  it('measures signed clearance to the capsule surface in centimetres', () => {
    const field = computeFitField([0.1, 0.1, 0, 0.11, 0.1, 0, 0.09, 0.1, 0], sdf);
    expect(field.clearanceCm[0]).toBeCloseTo(0, 5);
    expect(field.clearanceCm[1]).toBeCloseTo(1, 5);
    expect(field.clearanceCm[2]).toBeCloseTo(-1, 5);
  });

  it('leaves skipped vertices as NaN', () => {
    const field = computeFitField([10, 10, 0, 20, 10, 0, 30, 10, 0], sdf, { stride: 2 });
    expect(Number.isFinite(field.clearanceCm[0])).toBe(true);
    expect(Number.isNaN(field.clearanceCm[1])).toBe(true);
    expect(Number.isFinite(field.clearanceCm[2])).toBe(true);
  });

  it('accepts custom thresholds', () => {
    const thresholds = { tightCm: 1, looseCm: 4 };
    expect(computeFitField([11, 10, 0], sdf, { thresholds }).thresholds).toEqual(thresholds);
  });
});

describe('fitStats', () => {
  it('counts penetration and bands and ignores NaN', () => {
    const field = {
      clearanceCm: new Float32Array([-0.4, 0.2, 0.7, 1.6, 3.2, NaN]),
      thresholds: DEFAULT_FIT_THRESHOLDS,
    };
    const stats = fitStats(field);
    expect(stats.vertices).toBe(5);
    expect(stats.penetration).toBe(1);
    expect(stats.tight).toBe(1);
    expect(stats.ideal).toBe(2);
    expect(stats.loose).toBe(1);
    expect(stats.minCm).toBeCloseTo(-0.4, 6);
    expect(stats.maxCm).toBeCloseTo(3.2, 6);
    expect(stats.meanCm).toBeCloseTo((-0.4 + 0.2 + 0.7 + 1.6 + 3.2) / 5, 6);
  });

  it('returns zeros for an empty field', () => {
    expect(fitStats({ clearanceCm: new Float32Array(), thresholds: DEFAULT_FIT_THRESHOLDS }))
      .toEqual({ vertices: 0, penetration: 0, tight: 0, ideal: 0, loose: 0, minCm: 0, meanCm: 0, maxCm: 0 });
  });
});

describe('fitColor', () => {
  it('maps penetration, tight, ideal and loose to distinct colours', () => {
    expect(fitColor(-1)).toEqual([0.85, 0.1, 0.1]);
    expect(fitColor(0.25)[0]).toBeCloseTo(0.95, 6);
    expect(fitColor(1.5)).toEqual([0.25, 0.7, 0.3]);
    expect(fitColor(5)).toEqual([0.2, 0.2, 0.9]);
  });

  it('returns grey for non-finite input', () => {
    expect(fitColor(NaN)).toEqual([0.5, 0.5, 0.5]);
  });
});
