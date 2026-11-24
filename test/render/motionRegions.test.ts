import { describe, expect, it } from 'vitest';
import { parentFirst } from '@/render/backend/assets/motionRegions';

describe('motion region order', () => {
  it('lists every region after the parent it inherits its rotation from', () => {
    const parents = [3, 0, 1, -1];
    const order = parentFirst(parents);
    expect(order).toEqual([3, 0, 1, 2]);
    for (const region of order) {
      const parent = parents[region]!;
      if (parent < 0) continue;
      expect(order.indexOf(parent)).toBeLessThan(order.indexOf(region));
    }
  });

  it('rejects regions that inherit from each other in a loop', () => {
    expect(() => parentFirst([1, 0])).toThrow(/cycle/);
  });
});
