import type { FabricPhysics } from '@/model/types';

import { particleAreas, type ClothSimInput } from '@/sim/common';

const FABRIC_DEFAULT_MASS_PER_AREA = 180;

const NOMINAL_PARTICLE_AREA_M2 = 1e-4;

const NOMINAL_PARTICLE_MASS_KG = (FABRIC_DEFAULT_MASS_PER_AREA / 1000) * NOMINAL_PARTICLE_AREA_M2;

function spreadPanelValues(
  input: ClothSimInput,
  particleCount: number,
  fallback: number,
  valueOf: (panel: ClothSimInput['panels'][number], slot: number) => number,
): Float32Array<ArrayBuffer> {
  const out = new Float32Array(particleCount).fill(fallback);
  input.panels.forEach((panel, slot) => {
    const value = valueOf(panel, slot);
    const end = Math.min(panel.vertexOffset + panel.mesh.vertexCount, particleCount);
    for (let i = panel.vertexOffset; i < end; i++) out[i] = value;
  });
  return out;
}

export function computeParticleMass(
  input: ClothSimInput,
  physics: readonly FabricPhysics[],
  particleCount: number,
): Float32Array<ArrayBuffer> {
  const out = new Float32Array(particleCount).fill(NOMINAL_PARTICLE_MASS_KG);
  input.panels.forEach((panel, slot) => {
    const kgPerM2 = Math.max(physics[slot]?.massPerArea ?? FABRIC_DEFAULT_MASS_PER_AREA, 1) / 1000;
    const shares = particleAreas(panel.mesh);
    const end = Math.min(panel.vertexOffset + panel.mesh.vertexCount, particleCount);
    for (let i = panel.vertexOffset; i < end; i++) {
      out[i] = kgPerM2 * shares[i - panel.vertexOffset]!;
    }
  });
  return out;
}

export function computeBaseInvMass(
  input: ClothSimInput,
  physics: readonly FabricPhysics[],
  particleCount: number,
): Float32Array {
  const mass = computeParticleMass(input, physics, particleCount);
  const out = new Float32Array(particleCount);
  for (let i = 0; i < particleCount; i++) {
    const value = mass[i]!;
    out[i] = 1 / (value > 0 ? value : NOMINAL_PARTICLE_MASS_KG);
  }

  return out;
}

export function computeParticleDamping(
  input: ClothSimInput,
  physics: readonly FabricPhysics[],
  particleCount: number,
  fallback: number,
): Float32Array<ArrayBuffer> {
  return spreadPanelValues(input, particleCount, fallback, (_, slot) => physics[slot]?.damping ?? fallback);
}

export function computeParticleFriction(
  input: ClothSimInput,
  physics: readonly FabricPhysics[],
  particleCount: number,
  fallback: number,
): Float32Array<ArrayBuffer> {
  return spreadPanelValues(input, particleCount, fallback, (_, slot) => {
    const value = physics[slot]?.contactFriction;
    return typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
  });
}

export function computeParticleThickness(
  input: ClothSimInput,
  particleCount: number,
  fallback: number,
): Float32Array<ArrayBuffer> {
  return spreadPanelValues(input, particleCount, fallback, panel => panel.thicknessMeters ?? fallback);
}

export function computeParticleLayers(input: ClothSimInput, particleCount: number): Uint8Array {
  const layers = new Uint8Array(particleCount);
  for (const panel of input.panels) {
    const layer = Math.min(9, Math.max(0, Math.round(panel.collisionLayer ?? 0)));
    const end = Math.min(panel.vertexOffset + panel.mesh.vertexCount, particleCount);
    for (let i = panel.vertexOffset; i < end; i++) layers[i] = layer;
  }

  return layers;
}
