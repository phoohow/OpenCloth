import { describe, it, expect } from 'vitest';
import {
  pointToRayDistance, ParticleGrid, pickNearest,
  computeParticlePanelMap, buildParticlePanelMap,
} from '../../src/sim/picking';
import type { ClothSimInput } from '../../src/sim/clothSimulator';
import { FABRIC_PHYSICS_PRESETS } from '../../src/core/model/defaults';

/** Builds a minimal two-panel ClothSimInput for panel-map tests. */
function makeInput(): ClothSimInput {
  const mesh0 = {
    positions: new Float32Array(4),
    indices: new Uint32Array([0, 1, 2]),
    vertexCount: 3,
    triangleCount: 1,
  };
  const mesh1 = {
    positions: new Float32Array(4),
    indices: new Uint32Array([0, 1, 2]),
    vertexCount: 2,
    triangleCount: 0,
  };
  return {
    positions: new Float32Array(5 * 3),
    indices: new Uint32Array([0, 1, 2, 3, 4, 3]),
    panels: [
      {
        panelId: 'a', vertexOffset: 0, mesh: mesh0,
        positions3D: new Float32Array(9), restPositions: new Float32Array(9),
        physics: FABRIC_PHYSICS_PRESETS.cotton,
      },
      {
        panelId: 'b', vertexOffset: 3, mesh: mesh1,
        positions3D: new Float32Array(6), restPositions: new Float32Array(6),
        physics: FABRIC_PHYSICS_PRESETS.cotton,
      },
    ],
    seamConstraints: [],
    particleCount: 5,
    triangleCount: 2,
  };
}

describe('pointToRayDistance', () => {
  it('returns the perpendicular distance for a point ahead of the ray', () => {
    expect(pointToRayDistance(1, 0.03, 0, 0, 0, 0, 1, 0, 0)).toBeCloseTo(0.03, 10);
  });

  it('returns Infinity for a point behind the ray origin', () => {
    expect(pointToRayDistance(-1, 0, 0, 0, 0, 0, 1, 0, 0)).toBe(Infinity);
  });

  it('normalizes a non-unit direction', () => {
    expect(pointToRayDistance(2, 0, 0, 0, 0, 0, 10, 0, 0)).toBeCloseTo(0, 10);
  });
});

describe('computeParticlePanelMap', () => {
  it('maps each particle to its panel slot', () => {
    const input = makeInput();
    const map = computeParticlePanelMap(input);
    expect(Array.from(map)).toEqual([0, 0, 0, 1, 1]);
  });

  it('buildParticlePanelMap validates the panel name count', () => {
    const input = makeInput();
    expect(() => buildParticlePanelMap(input, ['a'])).toThrow();
    expect(Array.from(buildParticlePanelMap(input, ['front', 'back']))).toEqual([0, 0, 0, 1, 1]);
  });
});

describe('pickNearest', () => {
  // Five particles: three in panel 0, two in panel 1; none exactly on the ray.
  const positions = new Float32Array([
    0.5, 0.01, 0,
    0.5, 0.02, 0.5,
    0.9, 0.03, 0,
    -0.5, 0.01, 0,
    0.5, 0.2, 0,
  ]);
  const input = makeInput();
  const panelMap = computeParticlePanelMap(input);

  it('picks the particle closest to the ray within maxDistance', () => {
    const grid = new ParticleGrid(positions, 5);
    const hit = pickNearest(positions, grid, panelMap,
      { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 0.05);
    expect(hit).not.toBeNull();
    expect(hit!.index).toBe(0);
    // Positions are stored as float32.
    expect(hit!.distance).toBeCloseTo(0.01, 6);
    expect(hit!.panelIndex).toBe(0);
  });

  it('ignores particles behind the ray origin and beyond maxDistance', () => {
    const grid = new ParticleGrid(positions, 5);
    const hit = pickNearest(positions, grid, panelMap,
      { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 0.05);
    // Particle 3 sits at x = -0.5 and particle 4 is 0.2 m off the ray.
    expect(hit!.index).not.toBe(3);
    expect(hit!.index).not.toBe(4);
  });

  it('returns null when the ray misses all particles', () => {
    const grid = new ParticleGrid(positions, 5);
    const hit = pickNearest(positions, grid, panelMap,
      { x: 0, y: 5, z: 0 }, { x: 1, y: 0, z: 0 }, 0.05);
    expect(hit).toBeNull();
  });

  it('resolves the panel of a particle in the second panel', () => {
    const nearPanel1 = new Float32Array([
      0.5, 0.04, 0,
      0.5, 0, 0.5,
      0.9, 0.04, 0,
      0.4, 0.01, 0,
      0.7, 0.04, 0,
    ]);
    const grid = new ParticleGrid(nearPanel1, 5);
    const hit = pickNearest(nearPanel1, grid, panelMap,
      { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 0.05);
    expect(hit!.index).toBe(3);
    expect(hit!.panelIndex).toBe(1);
  });
});
