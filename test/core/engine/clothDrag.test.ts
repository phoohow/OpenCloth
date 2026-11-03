import { describe, expect, it } from 'vitest';
import { grabWeightsAround } from '../../../src/core/engine/clothDrag';

/** Four particles strung along +X, one centimeter apart. */
function row(): Float32Array {
  return new Float32Array([0, 0, 0, 0.01, 0, 0, 0.02, 0, 0, 0.05, 0, 0]);
}

describe('grabWeightsAround', () => {
  it('weights the grabbed particle fully and fades out to the radius', () => {
    const weights = grabWeightsAround(row(), { x: 0, y: 0, z: 0 }, 0.03, 0.35);
    expect(weights[0]).toBeCloseTo(0.35, 5);
    expect(weights[1]).toBeCloseTo(0.35 * (1 - 0.01 / 0.03), 5);
    expect(weights[2]).toBeCloseTo(0.35 * (1 - 0.02 / 0.03), 5);
  });

  it('leaves particles outside the radius at zero', () => {
    const weights = grabWeightsAround(row(), { x: 0, y: 0, z: 0 }, 0.03, 0.35);
    expect(weights[3]).toBe(0);
  });

  it('returns one weight per particle, all zero for a degenerate grab', () => {
    expect(grabWeightsAround(row(), { x: 0, y: 0, z: 0 }, 0, 0.35)).toEqual(new Float32Array(4));
    expect(grabWeightsAround(row(), { x: 0, y: 0, z: 0 }, 0.03, 0)).toEqual(new Float32Array(4));
  });
});
