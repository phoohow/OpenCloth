import { describe, expect, it } from 'vitest';
import { computeBaseInvMass, computeParticleMass } from '@/sim/particles';
import { buildMeshConstraints } from '@/sim/particles';
import { complianceMassScale, meanParticleAreaM2 } from '@/sim/common';
import type { ClothSimInput } from '@/sim/common';
import { FABRIC_PHYSICS_PRESETS } from '@/model/defaults';

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
    seams: [],
    particleCount: 4 + extraParticles,
    triangleCount: 2,
  };
}

describe('computeParticleMass', () => {
  it('spreads each panel weight over the vertex areas of its mesh', () => {
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

  it('turns the physical mass into inverse mass in kg^-1', () => {
    const input = squareInput(100);
    const inverse = computeBaseInvMass(input, input.panels.map(panel => panel.physics), 4);
    expect(inverse[0]).toBeCloseTo(30, 5);
    expect(inverse[1]).toBeCloseTo(60, 5);
    expect(inverse[2]).toBeCloseTo(30, 5);
    expect(inverse[3]).toBeCloseTo(60, 5);
  });
});

describe('compliance mass scale', () => {
  it('carries the preset mass unit over to the physical particle mass', () => {
    const input = squareInput(180);
    const mesh = input.panels[0]!.mesh;
    expect(meanParticleAreaM2(mesh)).toBeCloseTo(0.25, 5);
    expect(complianceMassScale(mesh)).toBeCloseTo(40, 5);

    const built = buildMeshConstraints(
      input.panels[0]!.positions3D, mesh, input.panels[0]!.physics, 1 / 60, 40,
    );
    expect(built.structural[0]!.compliance).toBeCloseTo(0.021 * 40, 8);
  });
});
