import { describe, expect, it } from 'vitest';
import { ClothGrab, usableGrabWeights } from '@/sim/clothGrab';

/** Grab with two particles, the first weighted twice the second. */
function grab(): ClothGrab {
  const grip = new ClothGrab();
  grip.setParticleCount(2);
  return grip;
}

describe('ClothGrab', () => {
  it('commands a force proportional to the pointer travel', () => {
    const grip = grab();
    expect(grip.set(new Float32Array([0.5, 0.25]), [0, 0, 0])).toBe(true);
    grip.move([0.1, 0, 0]);
    // 3.4 N/m over 0.1 m.
    expect(grip.forceN()).toBeCloseTo(0.34, 5);
    const force = grip.forceUniform();
    expect(force).not.toBeNull();
    expect(force![3]).toBe(1);
    // The weight sum is 0.75, so the uniform carries the force per unit weight.
    expect(Math.hypot(force![0], force![1], force![2])).toBeCloseTo(0.34 / 0.75, 5);
    expect(Math.hypot(force![0], force![1], force![2]) * 0.75).toBeCloseTo(grip.forceN()!, 5);
  });

  it('caps the force at the configured bound', () => {
    const grip = grab();
    grip.set(new Float32Array([0.5, 0.25]), [0, 0, 0]);
    grip.move([10, 0, 0]);
    expect(grip.forceN()).toBe(4);
    const force = grip.forceUniform()!;
    expect(Math.hypot(force[0], force[1], force[2]) * 0.75).toBeCloseTo(4, 5);
  });

  it('reports no force after release or when the weights cover no weight', () => {
    const grip = grab();
    expect(grip.set(new Float32Array([0.5, 0.25]), [0, 0, 0])).toBe(true);
    grip.move([0.1, 0, 0]);
    grip.clear();
    expect(grip.forceN()).toBeNull();
    expect(grip.forceUniform()).toBeNull();
    expect(grip.set(new Float32Array([0, 0]), [0.1, 0, 0])).toBe(false);
    expect(grip.forceN()).toBeNull();
  });

  it('drops pinned particles from the weights without touching the caller array', () => {
    const weights = new Float32Array([0.5, 0.25]);
    const usable = usableGrabWeights(weights, new Set([0]));
    expect(Array.from(usable)).toEqual([0, 0.25]);
    expect(Array.from(weights)).toEqual([0.5, 0.25]);
    expect(grab().set(usable, [0, 0, 0])).toBe(true);
    expect(grab().set(usableGrabWeights(weights, new Set([0, 1])), [0, 0, 0])).toBe(false);
  });
});
