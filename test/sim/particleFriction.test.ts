import { describe, expect, it } from 'vitest';
import { computeParticleFriction, type ClothSimInput } from '@/sim/simTypes';
import { FABRIC_PHYSICS_PRESETS } from '@/model/defaults';
import type { FabricPhysics } from '@/model/types';

/** Input with two panels of two particles each, backed by their own fabric physics. */
function layeredInput(physics: FabricPhysics[]): ClothSimInput {
  const mesh = {
    positions: new Float32Array(4 * 3),
    indices: new Uint32Array(0),
    vertexCount: 2,
    triangleCount: 0,
  };
  const panel = (panelId: string, vertexOffset: number, slot: number) => ({
    panelId, vertexOffset, mesh, positions3D: mesh.positions, restPositions: mesh.positions,
    physics: physics[slot]!,
  });
  return {
    positions: new Float32Array(4 * 3),
    indices: new Uint32Array(0),
    panels: [panel('a', 0, 0), panel('b', 2, 1)],
    seamConstraints: [],
    particleCount: 4,
    triangleCount: 0,
  };
}

/** Asserts every value against the expected float, tolerating float32 storage. */
function expectValues(actual: Float32Array, expected: number[]): void {
  expect(actual.length).toBe(expected.length);
  expected.forEach((value, i) => expect(actual[i]!).toBeCloseTo(value, 6));
}

describe('computeParticleFriction', () => {
  it('copies each panel fabric coefficient over its particles', () => {
    const fabric = [FABRIC_PHYSICS_PRESETS.denim, FABRIC_PHYSICS_PRESETS.silk];
    expectValues(
      computeParticleFriction(layeredInput(fabric), fabric, 4, 0.5),
      [0.45, 0.45, 0.15, 0.15],
    );
  });

  it('fills particles outside every panel with the fallback', () => {
    const fabric = [FABRIC_PHYSICS_PRESETS.denim, FABRIC_PHYSICS_PRESETS.silk];
    expectValues(
      computeParticleFriction(layeredInput(fabric), fabric, 5, 0.5),
      [0.45, 0.45, 0.15, 0.15, 0.5],
    );
  });

  it('clamps out-of-range and missing coefficients to 0..1 and the fallback', () => {
    const fabric: FabricPhysics[] = [
      { ...FABRIC_PHYSICS_PRESETS.cotton, contactFriction: 1.4 },
      { ...FABRIC_PHYSICS_PRESETS.cotton, contactFriction: undefined },
    ];
    expectValues(
      computeParticleFriction(layeredInput(fabric), fabric, 4, 0.25),
      [1, 1, 0.25, 0.25],
    );
  });
});
