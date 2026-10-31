import type { SimulationConfig, FabricPhysics } from '../core/model/types';
import { DEFAULT_CLOTH_THICKNESS_CM, DEFAULT_LAYER_SPACING_CM } from '../core/model/defaults';

/** Velocity clamp applied by the integrate and update passes, in meters per second. */
const MAX_SPEED = 6;
/** Distance a particle is kept outside capsule and floor surfaces, in meters. */
const SURFACE_OFFSET = 0.005;
/** Tangential pull toward the previous frame position on contact. */
const CONTACT_FRICTION = 0.5;

/** INTEGRATE SimParams block: 64 bytes. */
export function packIntegrateParams(
  config: SimulationConfig,
  fabric: FabricPhysics,
  particleCount: number,
  time: number,
): Float32Array<ArrayBuffer> {
  const data = new Float32Array(16);
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

/** COLLIDE SimParams block: 32 bytes; capsule count is 0 when body collision is off or absent. */
export function packCollideParams(
  config: SimulationConfig,
  particleCount: number,
  capsuleCount: number,
  floorY: number,
): Float32Array<ArrayBuffer> {
  const data = new Float32Array(8);
  const u32 = new Uint32Array(data.buffer);
  data[0] = config.dt;
  u32[1] = particleCount;
  u32[2] = config.avatarCollision && capsuleCount > 0 ? capsuleCount : 0;
  data[3] = SURFACE_OFFSET;
  data[4] = CONTACT_FRICTION;
  data[5] = floorY;
  data[6] = clothThicknessMeters(config);
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
