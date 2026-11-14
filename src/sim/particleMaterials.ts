import type { FabricPhysics } from '@/model/types';
import { createStorageBuffer } from '@/sim/gpuPipelines';
import { computeParticleDamping, computeParticleFriction, type ClothSimInput } from '@/sim/simTypes';

/** Per-particle material fields the solver keeps in storage buffers of their own. */
export interface ParticleMaterialBuffers {
  /** Damping the UPDATE pass applies to the velocity of each particle. */
  damping: GPUBuffer;
  /** Coulomb friction coefficient the COLLIDE pass applies on contact. */
  friction: GPUBuffer;
}

/** Per-particle fields of the panel materials; particles outside every panel take the first panel's fabric. */
function particleMaterialFields(
  input: ClothSimInput,
  physics: FabricPhysics[],
  particleCount: number,
): { damping: Float32Array<ArrayBuffer>; friction: Float32Array<ArrayBuffer> } {
  const first = physics[0];
  return {
    damping: computeParticleDamping(input, physics, particleCount, first?.damping ?? 0.02),
    friction: computeParticleFriction(input, physics, particleCount, first?.contactFriction ?? 0),
  };
}

/** Creates both buffers from the panel materials of one merged cloth layout. */
export function createParticleMaterialBuffers(
  device: GPUDevice,
  input: ClothSimInput,
  physics: FabricPhysics[],
  particleCount: number,
): ParticleMaterialBuffers {
  const fields = particleMaterialFields(input, physics, particleCount);
  return {
    damping: createStorageBuffer(device, fields.damping),
    friction: createStorageBuffer(device, fields.friction),
  };
}

/** Rewrites both buffers after a material edit, leaving positions and velocities untouched. */
export function writeParticleMaterialBuffers(
  device: GPUDevice,
  buffers: ParticleMaterialBuffers,
  input: ClothSimInput,
  physics: FabricPhysics[],
  particleCount: number,
): void {
  const fields = particleMaterialFields(input, physics, particleCount);
  device.queue.writeBuffer(buffers.damping, 0, fields.damping);
  device.queue.writeBuffer(buffers.friction, 0, fields.friction);
}
