import { describe, expect, it } from 'vitest';
import { EXPLODE_OFFSET_M, explodeOffBody } from '../../../src/pattern/drape/explodedLayout';

/** Centroid of a flat xyz buffer. */
function centroid(positions: Float32Array): { x: number; y: number; z: number } {
  const count = positions.length / 3;
  let x = 0; let y = 0; let z = 0;
  for (let i = 0; i < count; i++) {
    x += positions[i * 3]; y += positions[i * 3 + 1]; z += positions[i * 3 + 2];
  }
  return { x: x / count, y: y / count, z: z / count };
}

describe('未缝合分离摆放', () => {
  const wrapped = new Float32Array([0.1, 1.2, 0.15, 0.14, 1.1, 0.2, 0.08, 1.05, 0.18]);

  it('保持片内距离不变', () => {
    const out = explodeOffBody(wrapped);
    for (let a = 0; a < 3; a++) {
      for (let b = 0; b < 3; b++) {
        const before = Math.hypot(
          wrapped[a * 3] - wrapped[b * 3],
          wrapped[a * 3 + 1] - wrapped[b * 3 + 1],
          wrapped[a * 3 + 2] - wrapped[b * 3 + 2],
        );
        const after = Math.hypot(
          out[a * 3] - out[b * 3],
          out[a * 3 + 1] - out[b * 3 + 1],
          out[a * 3 + 2] - out[b * 3 + 2],
        );
        expect(after).toBeCloseTo(before, 5);
      }
    }
  });

  it('沿人体轴心向外移动一个偏移量', () => {
    const before = centroid(wrapped);
    const after = centroid(explodeOffBody(wrapped));
    const radial = Math.hypot(before.x, before.z);
    expect(after.y).toBeCloseTo(before.y, 5);
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeCloseTo(EXPLODE_OFFSET_M, 5);
    // The shift follows the panel's own outward direction.
    expect(after.x - before.x).toBeCloseTo(EXPLODE_OFFSET_M * (before.x / radial), 5);
  });

  it('轴心上的版片向前推出', () => {
    const centred = new Float32Array([-0.1, 1, 0.1, 0.1, 1, -0.1, 0, 0.9, 0]);
    const after = centroid(explodeOffBody(centred));
    expect(after.z).toBeCloseTo(EXPLODE_OFFSET_M, 5);
  });
});
