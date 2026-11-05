import { describe, expect, it } from 'vitest';
import { FrameCache } from '@/sim/frameCache';

/** Flat positions of a frame with the given particle count, filled with one value. */
function positions(particles: number, value: number): Float32Array {
  return new Float32Array(particles * 3).fill(value);
}

describe('FrameCache', () => {
  it('keeps frames in capture order until full', () => {
    const cache = new FrameCache(3);
    cache.push(positions(1, 1), 0.1);
    cache.push(positions(1, 2), 0.2);
    expect(cache.frames().map(frame => frame.index)).toEqual([1, 2]);
    expect(cache.frames()[1]!.timeSeconds).toBeCloseTo(0.2, 6);
  });

  it('drops the oldest frame once the ring is full', () => {
    const cache = new FrameCache(3);
    for (let i = 1; i <= 5; i++) cache.push(positions(1, i), i / 10);
    expect(cache.frames().map(frame => frame.index)).toEqual([3, 4, 5]);
    expect(cache.count).toBe(3);
  });

  it('copies positions so later writes do not change cached frames', () => {
    const cache = new FrameCache(2);
    const source = positions(1, 1);
    cache.push(source, 0);
    source[0] = 99;
    expect(cache.frames()[0]!.positions[0]).toBe(1);
  });

  it('clear resets both storage and numbering', () => {
    const cache = new FrameCache(2);
    cache.push(positions(1, 1), 0);
    cache.clear();
    expect(cache.frames()).toEqual([]);
    cache.push(positions(1, 2), 1);
    expect(cache.frames()[0]!.index).toBe(1);
  });
});
