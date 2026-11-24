import type { Vec3Tuple } from '@/base/math';

const ARM_INFLUENCE = 0.5;

export const CLOTH_CLEARANCE = 0.004;

export type LimbSide = -1 | 1;

export interface RegionEnvelope {
  axis: Vec3Tuple;
  u: Vec3Tuple;
  v: Vec3Tuple;
  aspect: number;
  rx: number;
  rz: number;
  girth: number;
  at(t: number): Vec3Tuple;
  centre(y: number): Vec3Tuple;
}

function armWeight(armWeights: Float32Array, v: number): number {
  return Math.max(armWeights[v * 2]!, armWeights[v * 2 + 1]!);
}

function isTorso(armWeights: Float32Array, v: number): boolean {
  return armWeight(armWeights, v) <= ARM_INFLUENCE;
}

function ellipsePerimeter(rx: number, rz: number): number {
  return Math.PI * (3 * (rx + rz) - Math.sqrt((3 * rx + rz) * (rx + 3 * rz)));
}

function torsoSkin(
  positions: Float32Array,
  armWeights: Float32Array,
  topY: number,
  bottomY: number,
): Vec3Tuple[] {
  const count = positions.length / 3;
  const points: Vec3Tuple[] = [];
  for (let v = 0; v < count; v++) {
    const y = positions[v * 3 + 1]!;
    if (y < bottomY || y > topY || !isTorso(armWeights, v)) continue;
    points.push([positions[v * 3]!, y, positions[v * 3 + 2]!]);
  }

  return points;
}

export function fitTorso(
  positions: Float32Array,
  armWeights: Float32Array,
  topY: number,
  bottomY: number,
): RegionEnvelope {
  const points = torsoSkin(positions, armWeights, topY, bottomY);
  let sumZ = 0;
  let maxX = 0;
  for (const p of points) {
    sumZ += p[2];
    maxX = Math.max(maxX, Math.abs(p[0]));
  }

  const meanZ = points.length > 0 ? sumZ / points.length : 0;
  let maxZ = 0;
  for (const p of points) maxZ = Math.max(maxZ, Math.abs(p[2] - meanZ));
  const aspect = maxX > 1e-6 && maxZ > 1e-6 ? maxZ / maxX : 1;
  let rx = 0;
  for (const p of points) {
    const z = (p[2] - meanZ) / aspect;
    rx = Math.max(rx, Math.hypot(p[0], z));
  }

  rx = Math.max(rx, 0.01) + CLOTH_CLEARANCE;
  const rz = Math.max(rx * aspect, 0.01);
  const u: Vec3Tuple = [1, 0, 0];
  const v: Vec3Tuple = [0, 0, 1];
  const centre = (y: number): Vec3Tuple => [0, y, meanZ];
  return {
    axis: [0, -1, 0],
    u,
    v,
    aspect: rz / rx,
    rx,
    rz,
    girth: ellipsePerimeter(rx, rz),
    at: (t: number): Vec3Tuple => centre(topY - t),
    centre,
  };
}
