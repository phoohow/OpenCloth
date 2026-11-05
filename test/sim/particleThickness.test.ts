import { describe, expect, it } from 'vitest';
import { computeParticleThickness, type ClothSimInput } from '@/sim/simTypes';
import { FABRIC_PHYSICS_PRESETS } from '@/model/defaults';

/** Input with two panels of two particles each carrying their own clearance. */
function layeredInput(): ClothSimInput {
  const mesh = {
    positions: new Float32Array(4 * 3),
    indices: new Uint32Array(0),
    vertexCount: 2,
    triangleCount: 0,
  };
  return {
    positions: new Float32Array(4 * 3),
    indices: new Uint32Array(0),
    panels: [
      {
        panelId: 'a', vertexOffset: 0, mesh, positions3D: mesh.positions, restPositions: mesh.positions,
        physics: FABRIC_PHYSICS_PRESETS.cotton, thicknessMeters: 0.008,
      },
      {
        panelId: 'b', vertexOffset: 2, mesh, positions3D: mesh.positions, restPositions: mesh.positions,
        physics: FABRIC_PHYSICS_PRESETS.cotton, thicknessMeters: 0.002,
      },
    ],
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

describe('computeParticleThickness', () => {
  it('copies each panel clearance over its particles', () => {
    expectValues(computeParticleThickness(layeredInput(), 4, 0.01), [0.008, 0.008, 0.002, 0.002]);
  });

  it('fills particles outside every panel and panels without a value with the fallback', () => {
    const input = layeredInput();
    delete input.panels[1]!.thicknessMeters;
    expectValues(computeParticleThickness(input, 5, 0.01), [0.008, 0.008, 0.01, 0.01, 0.01]);
  });
});
