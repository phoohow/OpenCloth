import { describe, expect, it } from 'vitest';
import { collapseSeamPairs, type SeamPairRef } from '../../../src/pattern/drape/sewnTargets';

/** Reference into a shared position buffer. */
const ref = (positions: Float32Array, index: number): SeamPairRef[0] => ({ positions, index });

describe('缝合目标折叠', () => {
  it('成对顶点折叠到中点', () => {
    const positions = new Float32Array([0, 0, 0, 1, 2, -1]);
    collapseSeamPairs([[ref(positions, 0), ref(positions, 1)]]);
    expect(Array.from(positions)).toEqual([0.5, 1, -0.5, 0.5, 1, -0.5]);
  });

  it('共享顶点的链折叠到同一点', () => {
    const positions = new Float32Array([0, 0, 0, 3, 0, 0, 6, 0, 0]);
    collapseSeamPairs([
      [ref(positions, 0), ref(positions, 1)],
      [ref(positions, 1), ref(positions, 2)],
    ], 40);
    const settled = [positions[0], positions[3], positions[6]];
    expect(Math.max(...settled) - Math.min(...settled)).toBeLessThan(1e-3);
  });

  it('未缝合顶点保持不变', () => {
    const positions = new Float32Array([1, 1, 1, 2, 2, 2, 9, 9, 9]);
    collapseSeamPairs([[ref(positions, 0), ref(positions, 1)]]);
    expect(Array.from(positions.slice(6))).toEqual([9, 9, 9]);
  });
});
