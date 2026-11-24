import type { SimulationConfig } from '@/model/types';

import { clothThicknessMeters, type ColliderGrid, type Constraint } from '@/sim/common';

const MAX_SPEED = 6;

export const SURFACE_OFFSET = 0.008;

export function colorConstraints(constraints: Constraint[]): Constraint[][] {
  const batches: Constraint[][] = [];
  const used = new Map<number, Set<number>>();
  const batchesOf = (particle: number): Set<number> => {
    let set = used.get(particle);
    if (!set) {
      set = new Set<number>();
      used.set(particle, set);
    }

    return set;
  };
  for (const constraint of constraints) {
    const a = batchesOf(constraint.p0);
    const b = batchesOf(constraint.p1);
    let batch = 0;
    while (a.has(batch) || b.has(batch)) batch++;
    (batches[batch] ??= []).push(constraint);
    a.add(batch);
    b.add(batch);
  }

  return batches;
}

export function packConstraints(constraints: readonly Constraint[]): ArrayBuffer {
  const buffer = new ArrayBuffer(constraints.length * 16);
  const u32 = new Uint32Array(buffer);
  const f32 = new Float32Array(buffer);
  constraints.forEach((constraint, i) => {
    u32[i * 4] = constraint.p0;
    u32[i * 4 + 1] = constraint.p1;
    f32[i * 4 + 2] = constraint.restLength;
    f32[i * 4 + 3] = constraint.compliance;
  });
  return buffer;
}

export function packParticleState(
  positions: Float32Array,
  perParticle: Float32Array,
  particleCount: number,
): Float32Array<ArrayBuffer> {
  const data = new Float32Array(particleCount * 4);
  for (let i = 0; i < particleCount; i++) {
    data[i * 4] = positions[i * 3]!;
    data[i * 4 + 1] = positions[i * 3 + 1]!;
    data[i * 4 + 2] = positions[i * 3 + 2]!;
    data[i * 4 + 3] = perParticle[i]!;
  }

  return data;
}

export function packParticles(
  positions: Float32Array,
  invMass: Float32Array,
  particleCount: number,
  pinned: ReadonlySet<number>,
): Float32Array<ArrayBuffer> {
  const perParticle = new Float32Array(particleCount);
  for (let i = 0; i < particleCount; i++) perParticle[i] = pinned.has(i) ? 0 : invMass[i]!;
  return packParticleState(positions, perParticle, particleCount);
}

export function workgroups(count: number): number {
  return Math.ceil(Math.max(count, 1) / 256);
}

export function packIntegrateParams(
  config: SimulationConfig,
  damping: number,
  particleCount: number,
  time: number,
  grabForce: readonly [number, number, number, number] | null,
): Float32Array<ArrayBuffer> {
  const data = new Float32Array(20);
  const u32 = new Uint32Array(data.buffer);
  data[0] = config.dt;
  u32[1] = particleCount;
  data[4] = config.gravity.x;
  data[5] = config.gravity.y;
  data[6] = config.gravity.z;
  data[8] = config.wind.direction.x;
  data[9] = config.wind.direction.y;
  data[10] = config.wind.direction.z;
  data[11] = config.wind.speed;
  data[12] = damping;
  data[13] = time;
  data[14] = MAX_SPEED;
  if (grabForce) {
    data[16] = grabForce[0];
    data[17] = grabForce[1];
    data[18] = grabForce[2];
    data[19] = grabForce[3];
  }

  return data;
}

function contactFrictionScale(config: SimulationConfig): number {
  const value = config.contactFrictionScale;
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 1;
}

export function packCollideParams(
  config: SimulationConfig,
  particleCount: number,
  body: ColliderGrid,
  floorY: number,
): Float32Array<ArrayBuffer> {
  const data = new Float32Array(16);
  const u32 = new Uint32Array(data.buffer);
  const on = config.avatarCollision;
  const triangles = on ? body.triangleCount : 0;
  data[0] = config.dt;
  u32[1] = particleCount;
  data[2] = SURFACE_OFFSET;
  data[3] = contactFrictionScale(config);
  data[4] = floorY;
  data[5] = clothThicknessMeters(config);
  u32[6] = triangles;
  u32[7] = config.floorCollision === false ? 0 : 1;
  data[8] = body.origin[0];
  data[9] = body.origin[1];
  data[10] = body.origin[2];
  data[11] = body.cell;
  data[12] = body.dims[0];
  data[13] = body.dims[1];
  data[14] = body.dims[2];
  return data;
}

export function packUpdateParams(
  config: SimulationConfig,
  particleCount: number,
): Float32Array<ArrayBuffer> {
  const data = new Float32Array(4);
  data[0] = config.dt;
  new Uint32Array(data.buffer)[1] = particleCount;
  data[2] = MAX_SPEED;
  return data;
}

export function packSolveParams(particleCount: number, constraintCount: number): Float32Array<ArrayBuffer> {
  const data = new Float32Array(8);
  const u32 = new Uint32Array(data.buffer);
  data[0] = 0;
  u32[1] = particleCount;
  u32[2] = constraintCount;
  return data;
}

export function packPinParams(indexCount: number, particleCount: number): Float32Array<ArrayBuffer> {
  const data = new Float32Array(4);
  const u32 = new Uint32Array(data.buffer);
  u32[0] = indexCount;
  u32[1] = particleCount;
  return data;
}

export function packSelfCollisionParams(
  particleCount: number,
  tableMask: number,
  itemsPerCell: number,
  cellSize: number,
  layerSpacing: number,
  maxMove: number,
): Float32Array<ArrayBuffer> {
  const data = new Float32Array(8);
  const u32 = new Uint32Array(data.buffer);
  u32[0] = particleCount;
  u32[1] = tableMask;
  u32[2] = itemsPerCell;
  data[4] = cellSize;
  data[5] = layerSpacing;
  data[6] = maxMove;
  return data;
}
