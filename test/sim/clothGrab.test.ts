import { describe, expect, it } from 'vitest';
import { ClothGrab, usableGrabWeights } from '@/sim/clothGrab';

/** Grab with two particles of one gram each, the first weighted twice the second. */
function grab(): ClothGrab {
  const grip = new ClothGrab();
  grip.setMasses(new Float32Array([0.001, 0.001]));
  return grip;
}

describe('ClothGrab', () => {
  it('turns pointer travel into a per-substep step and a patch force', () => {
    const grip = grab();
    expect(grip.set(new Float32Array([0.5, 0.25]), [0, 0, 0])).toBe(true);
    grip.move([0.1, 0, 0]);
    // A fully weighted particle covers the pointer travel in one substep.
    const step = grip.stepUniform();
    expect(step).not.toBeNull();
    expect(step![3]).toBe(1);
    expect(Math.hypot(step![0], step![1], step![2])).toBeCloseTo(0.1, 6);
    // Weighted mass = 0.00075 kg, so 0.1 m over the reference substep commands 4.32 N.
    expect(grip.forceN()).toBeCloseTo(4.32, 5);
  });

  it('caps the commanded step at the heaviest grab weight', () => {
    const grip = grab();
    grip.set(new Float32Array([0.5, 0.25]), [0, 0, 0]);
    grip.move([1, 0, 0]);
    const step = grip.stepUniform();
    expect(step).not.toBeNull();
    // Travel is capped at 0.4 / 0.5 = 0.8 m, which is also the reported step and force.
    expect(Math.hypot(step![0], step![1], step![2])).toBeCloseTo(0.8, 5);
    expect(step![1]).toBe(0);
    expect(step![2]).toBe(0);
    expect(grip.forceN()).toBeCloseTo(34.56, 5);
  });

  it('splits the same frame command and reading across a solver refinement', () => {
    const grip = grab();
    grip.set(new Float32Array([0.5, 0.25]), [0, 0, 0]);
    grip.move([0.1, 0, 0]);
    const coarse = grip.stepUniform()!;
    const force = grip.forceN();
    grip.setSubsteps(8);
    const fine = grip.stepUniform()!;
    const coarseLength = Math.hypot(coarse[0], coarse[1], coarse[2]);
    expect(Math.hypot(fine[0], fine[1], fine[2])).toBeCloseTo(coarseLength / 2, 6);
    expect(grip.forceN()).toBe(force);
  });

  it('reports no pull after release or when the weights cover no mass', () => {
    const grip = grab();
    expect(grip.set(new Float32Array([0.5, 0.25]), [0, 0, 0])).toBe(true);
    grip.move([0.1, 0, 0]);
    grip.clear();
    expect(grip.forceN()).toBeNull();
    expect(grip.stepUniform()).toBeNull();
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
