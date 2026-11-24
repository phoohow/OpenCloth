import { describe, expect, it } from 'vitest';
import {
  createFabric, DEFAULT_KNIT_SPEC, KNIT_MACHINE_GAUGES, KNIT_NEEDLE_GAUGE_MAX, KNIT_NEEDLE_GAUGE_MIN,
  KNIT_ROW_GAUGE_MAX, KNIT_ROW_GAUGE_MIN, knitGaugeOf, knitNeedleCount, normalizeKnitSpec,
} from '@/model';

describe('knit spec', () => {
  it('keeps the machine gauge table in needle pitch order', () => {
    for (let i = 1; i < KNIT_MACHINE_GAUGES.length; i++) {
      expect(KNIT_MACHINE_GAUGES[i]!.gauge).toBeGreaterThan(KNIT_MACHINE_GAUGES[i - 1]!.gauge);
      expect(KNIT_MACHINE_GAUGES[i]!.needleGauge).toBeGreaterThan(KNIT_MACHINE_GAUGES[i - 1]!.needleGauge);
    }
  });

  it('derives each needle pitch from the gauge in needles per inch', () => {
    for (const entry of KNIT_MACHINE_GAUGES) {
      const pitch = (entry.gauge * 10) / 2.54;
      expect(Math.abs(entry.needleGauge - pitch)).toBeLessThanOrEqual(1);
    }
  });

  it('reads the gauge back from the needle pitch alone', () => {
    expect(knitGaugeOf({ stitch: 'jersey', needleGauge: 47, rowGauge: 62 })).toBe(12);
    expect(knitGaugeOf({ stitch: 'jersey', needleGauge: 45, rowGauge: 62 })).toBeNull();
  });

  it('starts every preset inside the range the editor allows', () => {
    expect(DEFAULT_KNIT_SPEC.needleGauge).toBeGreaterThanOrEqual(KNIT_NEEDLE_GAUGE_MIN);
    expect(DEFAULT_KNIT_SPEC.needleGauge).toBeLessThanOrEqual(KNIT_NEEDLE_GAUGE_MAX);
    expect(DEFAULT_KNIT_SPEC.rowGauge).toBeGreaterThanOrEqual(KNIT_ROW_GAUGE_MIN);
    expect(DEFAULT_KNIT_SPEC.rowGauge).toBeLessThanOrEqual(KNIT_ROW_GAUGE_MAX);
  });

  it('clamps a parsed record and drops an unknown stitch', () => {
    const low = normalizeKnitSpec({ stitch: 'jersey', needleGauge: 1, rowGauge: 2 });
    expect(low.needleGauge).toBe(KNIT_NEEDLE_GAUGE_MIN);
    expect(low.rowGauge).toBe(KNIT_ROW_GAUGE_MIN);
    const high = normalizeKnitSpec({ needleGauge: 500, rowGauge: 900 });
    expect(high.needleGauge).toBe(KNIT_NEEDLE_GAUGE_MAX);
    expect(high.rowGauge).toBe(KNIT_ROW_GAUGE_MAX);
    expect(high.stitch).toBe(DEFAULT_KNIT_SPEC.stitch);
    expect(normalizeKnitSpec({ stitch: 'rib2' }).stitch).toBe('rib2');
  });

  it('fills a knit record on the knit preset only', () => {
    expect(createFabric('knit').knit).toEqual(DEFAULT_KNIT_SPEC);
    expect(createFabric('cotton').knit).toBeUndefined();
  });

  it('casts a 2×2 rib on whole repeats plus selvedges', () => {
    const jersey = { stitch: 'jersey', needleGauge: 47, rowGauge: 62 } as const;
    const rib = { ...jersey, stitch: 'rib2' } as const;
    const width = 50;
    expect(knitNeedleCount(width, jersey)).toBe(235);
    const needles = knitNeedleCount(width, rib);
    expect((needles - 2) % 4).toBe(0);
    expect(Math.abs(needles - 235)).toBeLessThanOrEqual(2);
  });
});
