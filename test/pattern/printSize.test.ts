import { describe, expect, it } from 'vitest';
import {
  PRINT_MAX_PANEL_FRACTION, PRINT_MIN_SIDE_CM, PRINT_REFERENCE_DPI, PRINT_SIDE_MAX_CM, printAspectLocked,
  printResolutionDpi, printSizeFromPixels, printSizeFromSide, printSizeWithAspect, printSourceSize,
} from '@/model';
import type { Print } from '@/model/types';

function printOf(widthCm: number, imageSize: { x: number; y: number }, repeatX = 1): Print {
  return {
    id: 'p', panelId: 'panel', imageUrl: '', center: { x: 0, y: 0 }, widthCm, heightCm: widthCm / 2,
    angleDeg: 0, opacity: 1, repeat: { x: repeatX, y: 1 }, visible: true, imageSize,
  };
}

describe('印花尺寸', () => {
  it('places artwork at its pixel size on the reference resolution', () => {
    const size = printSizeFromPixels({ x: 600, y: 300 }, { x: 120, y: 120 });
    expect(size.widthCm).toBeCloseTo((600 / PRINT_REFERENCE_DPI) * 2.54, 6);
    expect(size.heightCm).toBeCloseTo((300 / PRINT_REFERENCE_DPI) * 2.54, 6);
  });

  it('keeps the artwork aspect whatever the pixel shape', () => {
    for (const pixel of [{ x: 800, y: 200 }, { x: 300, y: 900 }, { x: 512, y: 512 }]) {
      const size = printSizeFromPixels(pixel, { x: 90, y: 70 });
      expect(size.widthCm / size.heightCm).toBeCloseTo(pixel.x / pixel.y, 6);
    }
  });

  it('fits artwork larger than the panel inside its fraction', () => {
    const panel = { x: 40, y: 30 };
    const size = printSizeFromPixels({ x: 4000, y: 2000 }, panel);
    expect(size.widthCm).toBeCloseTo(panel.x * PRINT_MAX_PANEL_FRACTION, 6);
    expect(size.heightCm).toBeLessThanOrEqual(panel.y * PRINT_MAX_PANEL_FRACTION + 1e-9);
  });

  it('lifts artwork smaller than the minimum side', () => {
    const size = printSizeFromPixels({ x: 8, y: 4 }, { x: 90, y: 70 });
    expect(Math.min(size.widthCm, size.heightCm)).toBeCloseTo(PRINT_MIN_SIDE_CM, 6);
  });

  it('reads the placed resolution off the artwork pixels and its tiling', () => {
    expect(printResolutionDpi(printOf(10.16, { x: 600, y: 300 }))).toBeCloseTo(150, 6);
    expect(printResolutionDpi(printOf(5.08, { x: 600, y: 300 }))).toBeCloseTo(300, 6);
    expect(printResolutionDpi(printOf(10.16, { x: 600, y: 300 }, 2))).toBeCloseTo(300, 6);
    expect(printResolutionDpi({ ...printOf(10, { x: 1, y: 1 }), imageSize: undefined })).toBeNull();
  });

  it('keeps the aspect lock on unless the record turns it off', () => {
    expect(printAspectLocked(printOf(10, { x: 600, y: 300 }))).toBe(true);
    expect(printAspectLocked({ ...printOf(10, { x: 600, y: 300 }), lockAspect: true })).toBe(true);
    expect(printAspectLocked({ ...printOf(10, { x: 600, y: 300 }), lockAspect: false })).toBe(false);
  });

  it('carries the locked side along when one side is edited', () => {
    const current = { widthCm: 12, heightCm: 6 };
    expect(printSizeFromSide('width', 20, current, 2, true)).toEqual({ widthCm: 20, heightCm: 10 });
    expect(printSizeFromSide('height', 10, current, 2, true)).toEqual({ widthCm: 20, heightCm: 10 });
  });

  it('leaves the other side alone while the aspect is unlocked', () => {
    const current = { widthCm: 12, heightCm: 6 };
    expect(printSizeFromSide('height', 10, current, 2, false)).toEqual({ widthCm: 12, heightCm: 10 });
    expect(printSizeFromSide('width', 30, current, 2, false)).toEqual({ widthCm: 30, heightCm: 6 });
  });

  it('clamps a carried side instead of rejecting the edit', () => {
    const size = printSizeFromSide('width', 100, { widthCm: 1, heightCm: 1000 }, 0.001, true);
    expect(size.widthCm).toBe(100);
    expect(size.heightCm).toBeGreaterThan(0.1);
    expect(printSizeFromSide('width', 1e6, { widthCm: 1, heightCm: 1 }, 1, false).widthCm).toBe(PRINT_SIDE_MAX_CM);
  });

  it('refits a replaced artwork onto the same area at the new aspect', () => {
    const before = { widthCm: 20, heightCm: 10 };
    const after = printSizeWithAspect(1, before);
    expect(after.widthCm * after.heightCm).toBeCloseTo(20 * 10, 6);
    expect(after.widthCm / after.heightCm).toBeCloseTo(1, 6);
  });

  it('sizes from the source artwork once the stored copy was resampled', () => {
    const print = printOf(10, { x: 2048, y: 1024 });
    expect(printSourceSize(print)).toEqual({ x: 2048, y: 1024 });
    expect(printSourceSize({ ...print, sourceSize: { x: 4096, y: 2048 } })).toEqual({ x: 4096, y: 2048 });
    expect(printSourceSize({ ...print, imageSize: undefined })).toBeNull();
  });
});
