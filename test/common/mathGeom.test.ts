import { describe, expect, it } from 'vitest';
import { clamp, degToRad, distance3At, hypot3, lerp, radToDeg } from '@/common/math';
import {
  add, computeBBox, distance, ensureCCW, normalize, polygonArea, signedPolygonArea, vec2,
} from '@/common/geom';
import { cmToM, cmToMm, mToCm, mmToCm } from '@/common/units';
import { formatPercent, roundTo } from '@/common/format';

describe('common/math', () => {
  it('clamps within finite and infinite bounds', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-5, 0, 3)).toBe(0);
    expect(clamp(12, -Infinity, Infinity)).toBe(12);
    expect(clamp(-7, 0, Infinity)).toBe(0);
  });

  it('interpolates and converts angles', () => {
    expect(lerp(2, 6, 0.25)).toBe(3);
    expect(degToRad(180)).toBeCloseTo(Math.PI);
    expect(radToDeg(Math.PI)).toBeCloseTo(180);
    expect(hypot3(3, 4, 12)).toBe(13);
  });

  it('measures distance between particles in a flat xyz buffer', () => {
    const positions = new Float32Array([0, 0, 0, 3, 4, 12]);
    expect(distance3At(positions, 0, 1)).toBeCloseTo(13);
  });
});

describe('common/geom', () => {
  it('keeps signed and absolute polygon areas distinct', () => {
    const ccw = [vec2(0, 0), vec2(4, 0), vec2(0, 2)];
    expect(signedPolygonArea(ccw)).toBeGreaterThan(0);
    expect(signedPolygonArea([...ccw].reverse())).toBeLessThan(0);
    expect(polygonArea(ccw)).toBe(4);
    expect(polygonArea([...ccw].reverse())).toBe(4);
  });

  it('normalizes winding and computes bounds', () => {
    const cw = [vec2(0, 0), vec2(0, 2), vec2(4, 0)];
    expect(signedPolygonArea(ensureCCW(cw))).toBeGreaterThan(0);
    const box = computeBBox([vec2(-1, 5), vec2(3, 2)]);
    expect(box.min).toEqual({ x: -1, y: 2 });
    expect(box.max).toEqual({ x: 3, y: 5 });
    expect(computeBBox([]).min.x).toBe(Infinity);
  });

  it('provides vector primitives', () => {
    expect(add(vec2(1, 2), vec2(3, 4))).toEqual({ x: 4, y: 6 });
    expect(distance(vec2(0, 0), vec2(3, 4))).toBe(5);
    expect(normalize(vec2(0, 0))).toEqual({ x: 0, y: 0 });
  });
});

describe('common/units and common/format', () => {
  it('converts between centimeters, meters and millimeters', () => {
    expect(cmToM(170)).toBe(1.7);
    expect(mToCm(1.7)).toBeCloseTo(170);
    expect(cmToMm(2.5)).toBe(25);
    expect(mmToCm(25)).toBe(2.5);
  });

  it('replaces the inline round-to-two-decimals expression', () => {
    expect(roundTo(1.23456)).toBe(1.23);
    expect(roundTo(-1.235)).toBe(-1.24);
    expect(roundTo(1.23456)).toBe(Math.round(1.23456 * 100) / 100);
    expect(roundTo(1.234, 1)).toBe(1.2);
  });

  it('formats ratios as percentages', () => {
    expect(formatPercent(0.5)).toBe('50%');
    expect(formatPercent(0.125, 1)).toBe('12.5%');
  });
});
