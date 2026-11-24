import { describe, expect, it } from 'vitest';
import { constrainAxis } from '@/ui/viewport2D/snap';

describe('pen axis lock', () => {
  const from = { x: 10, y: 20 };

  it('flattens a near-horizontal step onto the anchor y', () => {
    const lock = constrainAxis(from, { x: 30, y: 20.1 }, 0.2);
    expect(lock?.axis).toBe('horizontal');
    expect(lock?.to).toEqual({ x: 30, y: 20 });
  });

  it('straightens a near-vertical step onto the anchor x', () => {
    const lock = constrainAxis(from, { x: 10.1, y: 40 }, 0.2);
    expect(lock?.axis).toBe('vertical');
    expect(lock?.to).toEqual({ x: 10, y: 40 });
  });

  it('leaves a clearly diagonal step alone', () => {
    expect(constrainAxis(from, { x: 30, y: 25 }, 0.2)).toBeNull();
  });

  it('keeps the axis with the smaller deviation when both are inside the tolerance', () => {
    const lock = constrainAxis(from, { x: 10.05, y: 20.1 }, 0.2);
    expect(lock?.axis).toBe('vertical');
    expect(lock?.to).toEqual({ x: 10, y: 20.1 });
  });

  it('has nothing to constrain at zero length', () => {
    expect(constrainAxis(from, { ...from }, 0.2)).toBeNull();
  });
});
