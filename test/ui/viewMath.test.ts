import { describe, expect, it } from 'vitest';
import {
  MIN_SCALE, MAX_SCALE, fitView, gridStepCm, rulerLabel, rulerMinorTicks, rulerStepCm,
  rulerTicks, snapToGrid, toScreen, toWorld, zoomAround,
} from '@/ui/viewport2D/viewMath';

const view = { offsetX: 0, offsetY: 0, scale: 4 };

describe('2D viewport math', () => {
  it('picks grid and ruler steps that stay readable at a given zoom', () => {
    expect(gridStepCm(10)).toBe(5);
    expect(gridStepCm(1)).toBe(20);
    expect(gridStepCm(0.01)).toBeGreaterThan(20);
    expect(rulerStepCm(10)).toBe(10);
    expect(rulerStepCm(0.01)).toBe(500);
  });

  it('lays out ruler ticks and labels', () => {
    expect(rulerTicks(0, 2, 1)).toEqual([0, 1, 2]);
    expect(rulerMinorTicks(0, 1, 1)).not.toContain(1);
    expect(rulerLabel(2, 1)).toBe('2');
    expect(rulerLabel(0.5, 0.1)).toBe('0.5');
  });

  it('round-trips world and screen coordinates', () => {
    const p = { x: 12.5, y: -7.25 };
    const screen = toScreen(p, view, 800, 600);
    const world = toWorld(screen, view, 800, 600);
    expect(world.x).toBeCloseTo(p.x);
    expect(world.y).toBeCloseTo(p.y);
  });

  it('clamps zoom and keeps the cursor world point fixed', () => {
    const cursor = { x: 500, y: 240 };
    const before = toWorld(cursor, view, 800, 600);
    const zoomed = zoomAround(view, cursor, 1000, 800, 600);
    expect(zoomed.scale).toBe(MAX_SCALE);
    const after = toWorld(cursor, zoomed, 800, 600);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    expect(zoomAround(view, cursor, 0.0001, 800, 600).scale).toBe(MIN_SCALE);
  });

  it('fits a bounding box and snaps to the grid', () => {
    const fitted = fitView({ min: { x: 0, y: 0 }, max: { x: 100, y: 50 } }, 800, 600);
    expect(fitted.scale).toBeGreaterThan(MIN_SCALE);
    expect(fitted.scale).toBeLessThanOrEqual(MAX_SCALE);
    expect(snapToGrid({ x: 1.2, y: 2.3 }, 1)).toEqual({ x: 1, y: 2 });
  });
});
