import { describe, expect, it } from 'vitest';
import { vec3, type ObjectTransform } from '../../../src/core/model/types';

// three.webgpu.js reads `self` during module evaluation.
(globalThis as unknown as { self: unknown }).self ??= globalThis;

const { applyObjectTransform } = await import('../../../src/core/engine/garmentEngine');

const IDENTITY: ObjectTransform = { position: vec3(0, 0, 0), rotationEuler: vec3(0, 0, 0), scale: vec3(1, 1, 1) };

/** Two vertices one metre apart on the x axis, centred on the origin. */
function pair(): Float32Array {
  return new Float32Array([-0.5, 0, 0, 0.5, 0, 0]);
}

describe('applyObjectTransform', () => {
  it('leaves an untouched buffer alone for the identity transform', () => {
    const p = pair();
    applyObjectTransform(p, IDENTITY);
    expect(Array.from(p)).toEqual([-0.5, 0, 0, 0.5, 0, 0]);
  });

  it('translates every vertex', () => {
    const p = pair();
    applyObjectTransform(p, { ...IDENTITY, position: vec3(0, 1.2, -0.3) });
    expect(p[1]).toBeCloseTo(1.2, 5);
    expect(p[4]).toBeCloseTo(1.2, 5);
    expect(p[2]).toBeCloseTo(-0.3, 5);
    expect(p[0]).toBeCloseTo(-0.5, 5);
  });

  it('scales around the centroid', () => {
    const p = new Float32Array([1, 2, 0, 3, 2, 0]);
    applyObjectTransform(p, { ...IDENTITY, scale: vec3(2, 1, 1) });
    expect(p[0]).toBeCloseTo(0, 5);
    expect(p[3]).toBeCloseTo(4, 5);
    expect(p[1]).toBeCloseTo(2, 5);
  });

  it('rotates around the centroid', () => {
    const p = pair();
    applyObjectTransform(p, { ...IDENTITY, rotationEuler: vec3(0, Math.PI / 2, 0) });
    expect(p[0]).toBeCloseTo(0, 5);
    expect(p[2]).toBeCloseTo(0.5, 5);
    expect(p[3]).toBeCloseTo(0, 5);
    expect(p[5]).toBeCloseTo(-0.5, 5);
  });
});
