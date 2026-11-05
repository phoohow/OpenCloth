import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KNIT_SPEC, knitChartCsv, knitChartSymbol, knitNeedleCount, knitOf, knitRowCount,
} from '@/model/knit';
import type { Fabric } from '@/model/types';

describe('knit spec', () => {
  it('falls back to the default spec for a material without knit structure', () => {
    expect(knitOf(null)).toEqual(DEFAULT_KNIT_SPEC);
    expect(knitOf(undefined)).toEqual(DEFAULT_KNIT_SPEC);
  });

  it('reads the knit spec stored on a material', () => {
    const fabric = { knit: { stitch: 'rib2' as const, needleGauge: 8, rowGauge: 10 } } as Fabric;
    expect(knitOf(fabric)).toEqual({ stitch: 'rib2', needleGauge: 8, rowGauge: 10 });
  });
});

describe('knit counts', () => {
  it('converts centimetres into needles and courses', () => {
    expect(knitNeedleCount(20, DEFAULT_KNIT_SPEC)).toBe(24);
    expect(knitRowCount(20, DEFAULT_KNIT_SPEC)).toBe(30);
  });

  it('keeps at least one needle and one row', () => {
    expect(knitNeedleCount(0, DEFAULT_KNIT_SPEC)).toBe(1);
    expect(knitRowCount(0, DEFAULT_KNIT_SPEC)).toBe(1);
  });

  it('honours the gauge of the material', () => {
    const spec = { ...DEFAULT_KNIT_SPEC, needleGauge: 20, rowGauge: 6 };
    expect(knitNeedleCount(10, spec)).toBe(20);
    expect(knitRowCount(10, spec)).toBe(6);
  });
});

describe('knit chart', () => {
  it('alternates knit and purl cells for 2×2 rib', () => {
    const spec = { ...DEFAULT_KNIT_SPEC, stitch: 'rib2' as const };
    expect([0, 1, 2, 3, 4, 5].map(column => knitChartSymbol(spec, 0, column)))
      .toEqual(['K', 'K', 'P', 'P', 'K', 'K']);
  });

  it('marks the crossing row of a cable chart', () => {
    const spec = { ...DEFAULT_KNIT_SPEC, stitch: 'cable' as const };
    expect(knitChartSymbol(spec, 4, 2)).toBe('X');
    expect(knitChartSymbol(spec, 4, 5)).toBe('K');
    expect(knitChartSymbol(spec, 3, 2)).toBe('K');
  });

  it('writes a header, one row per course and a legend', () => {
    const lines = knitChartCsv(DEFAULT_KNIT_SPEC, 4, 3).split('\r\n');
    expect(lines[0]).toBe('行\\列,1,2,3,4');
    expect(lines[1]).toBe('3,K,K,K,K');
    expect(lines[3]).toBe('1,K,K,K,K');
    expect(lines[4]).toContain('图例');
  });

  it('caps oversized charts at 400 columns and rows', () => {
    const lines = knitChartCsv(DEFAULT_KNIT_SPEC, 1000, 1000).split('\r\n');
    expect(lines[0]!.split(',')).toHaveLength(401);
    expect(lines).toHaveLength(400 + 2);
  });
});
