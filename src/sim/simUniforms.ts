import type { SimulationConfig, FabricPhysics } from '../core/model/types';
import { DEFAULT_CLOTH_THICKNESS_CM, DEFAULT_LAYER_SPACING_CM } from '../core/model/defaults';

/** Velocity clamp applied by the integrate and update passes, in meters per second. */
const MAX_SPEED = 6;
/** Distance a particle is kept outside capsule and floor surfaces, in meters. */
const SURFACE_OFFSET = 0.005;
/** Tangential pull toward the previous frame position on contact. */
const CONTACT_FRICTION = 0.5;

/** INTEGRATE SimParams block: 80 bytes; the drag target only counts while its w flag is 1. */
export function packIntegrateParams(
  config: SimulationConfig,
  fabric: FabricPhysics,
  particleCount: number,
  time: number,
  grabTarget: readonly [number, number, number] | null,
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
  data[12] = fabric.damping;
  data[13] = time;
  data[14] = MAX_SPEED;
  if (grabTarget) {
    data[16] = grabTarget[0];
    data[17] = grabTarget[1];
    data[18] = grabTarget[2];
    data[19] = 1;
  }
  return data;
}

/** Cloth thickness in meters, clamped to the 0–1 cm slider range. */
export function clothThicknessMeters(config: SimulationConfig): number {
  const cm = config.clothThicknessCm;
  const value = typeof cm === 'number' && Number.isFinite(cm) ? cm : DEFAULT_CLOTH_THICKNESS_CM;
  return Math.min(1, Math.max(0, value)) / 100;
}

/** Extra separation per collision-layer step, in meters, clamped to 0–2 cm. */
export function layerSpacingMeters(config: SimulationConfig): number {
  const cm = config.layerSpacingCm;
  const value = typeof cm === 'number' && Number.isFinite(cm) ? cm : DEFAULT_LAYER_SPACING_CM;
  return Math.min(2, Math.max(0, value)) / 100;
}

/** Body collider handed to the COLLIDE pass: the triangle grid, plus capsules for the fallback. */
export interface CollideBody {
  capsuleCount: number;
  triangleCount: number;
  gridOrigin: [number, number, number];
  gridCell: number;
  gridDims: [number, number, number];
}

/**
 * COLLIDE SimParams block: 64 bytes. The mesh collider replaces the capsules, so
 * `capsuleCount` is 0 whenever triangles are present; both are 0 without body collision.
 */
export function packCollideParams(
  config: SimulationConfig,
  particleCount: number,
  body: CollideBody,
  floorY: number,
): Float32Array<ArrayBuffer> {
  const data = new Float32Array(16);
  const u32 = new Uint32Array(data.buffer);
  const on = config.avatarCollision;
  const triangles = on ? body.triangleCount : 0;
  data[0] = config.dt;
  u32[1] = particleCount;
  u32[2] = triangles > 0 || !on ? 0 : body.capsuleCount;
  data[3] = SURFACE_OFFSET;
  data[4] = CONTACT_FRICTION;
  data[5] = floorY;
  data[6] = clothThicknessMeters(config);
  u32[7] = triangles;
  data[8] = body.gridOrigin[0];
  data[9] = body.gridOrigin[1];
  data[10] = body.gridOrigin[2];
  data[11] = body.gridCell;
  data[12] = body.gridDims[0];
  data[13] = body.gridDims[1];
  data[14] = body.gridDims[2];
  return data;
}

/** UPDATE SimParams block: 16 bytes. */
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

/** SOLVE SimParams block: 32 bytes; dt stays 0 because compliance is pre-multiplied by 1/dt². */
export function packSolveParams(particleCount: number, constraintCount: number): Float32Array<ArrayBuffer> {
  const data = new Float32Array(8);
  const u32 = new Uint32Array(data.buffer);
  data[0] = 0;
  u32[1] = particleCount;
  u32[2] = constraintCount;
  return data;
}

/** SET_PIN PinParams block: 16 bytes; inverse masses ride in their own storage buffer. */
export function packPinParams(indexCount: number, particleCount: number): Float32Array<ArrayBuffer> {
  const data = new Float32Array(4);
  const u32 = new Uint32Array(data.buffer);
  u32[0] = indexCount;
  u32[1] = particleCount;
  return data;
}
