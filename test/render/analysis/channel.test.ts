import { describe, expect, it } from 'vitest';
import { liveOr } from '../../../src/render/analysis/channel';
import { fitChannel } from '../../../src/render/analysis/fitChannel';
import { strainChannel } from '../../../src/render/analysis/strainChannel';
import { pressureChannel } from '../../../src/render/analysis/pressureChannel';

describe('liveOr', () => {
  it('uses the live frame when both layouts agree', () => {
    const fallback = new Float32Array([1, 2, 3]);
    const live = new Float32Array([4, 5, 6]);
    expect(liveOr(fallback, live)).toBe(live);
  });

  it('falls back when the solver changed particle count or not started', () => {
    const fallback = new Float32Array([1, 2, 3]);
    expect(liveOr(fallback, new Float32Array(6))).toBe(fallback);
    expect(liveOr(new Float32Array(0), new Float32Array(0))).toHaveLength(0);
  });
});

describe('analysis channels', () => {
  it('name the kind they write into the shared overlay', () => {
    expect([fitChannel.kind, strainChannel.kind, pressureChannel.kind])
      .toEqual(['fit', 'strain', 'pressure']);
  });
});
