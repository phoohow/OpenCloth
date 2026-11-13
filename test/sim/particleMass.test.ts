import { describe, expect, it } from 'vitest';
import { computeParticleMass, type ClothSimInput } from '@/sim/simTypes';
import { FABRIC_PHYSICS_PRESETS } from '@/model/defaults';

/** One square metre split into two triangles, carrying its own areal weight. */
function squareInput(massPerArea: number, extraParticles = 0): ClothSimInput {
  const positions = new Float32Array([0, 0, 100, 0, 100, 100, 0, 100]);
  const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);
  const mesh = { positions, indices, vertexCount: 4, triangleCount: 2 };
  return {
    positions: new Float32Array((4 + extraParticles) * 3),
    indices,
    panels: [{
      panelId: 'a',
      vertexOffset: 0,
      mesh,
      positions3D: new Float32Array(12),
      restPositions: new Float32Array(12),
      physics: { ...FABRIC_PHYSICS_PRESETS.cotton, massPerArea },
    }],
    seamConstraints: [],
    particleCount: 4 + extraParticles,
    triangleCount: 2,
  };
}

describe('computeParticleMass', () => {
  it('spreads each panel weight over the vertex areas of its mesh', () => {
    // The diagonal vertices belong to both triangles, so they carry twice the area.
    const input = squareInput(100);
    const mass = computeParticleMass(input, input.panels.map(panel => panel.physics), 4);
    expect(mass[0]).toBeCloseTo(0.1 / 3, 6);
    expect(mass[1]).toBeCloseTo(0.1 / 6, 6);
    expect(mass[2]).toBeCloseTo(0.1 / 3, 6);
    expect(mass[3]).toBeCloseTo(0.1 / 6, 6);
  });

  it('reads the passed panel physics rather than the setup record', () => {
    const input = squareInput(180);
    const heavier = input.panels.map(panel => ({ ...panel.physics, massPerArea: 200 }));
    const mass = computeParticleMass(input, heavier, 4);
    expect(mass[0]).toBeCloseTo(0.2 / 3, 6);
  });

  it('gives particles outside every panel the default weight over a nominal patch', () => {
    const input = squareInput(100, 1);
    const mass = computeParticleMass(input, input.panels.map(panel => panel.physics), 5);
    expect(mass[4]).toBeCloseTo(0.18 * 1e-4, 10);
  });
});
