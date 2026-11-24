import type { Vec3 } from '@/base/math';
import type { ParticlePickHit } from '@/sim/common';

import { distance3AtPoint, pointRayDistance3 } from '@/base/geom';
import { NO_PANEL } from '@/sim/particles/layout';

export const PICK_CELL_SIZE = 0.02;

export function pointToRayDistance(
  px: number, py: number, pz: number,
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
): number {
  return pointRayDistance3({ x: px, y: py, z: pz }, { x: ox, y: oy, z: oz }, { x: dx, y: dy, z: dz });
}

export class ParticleGrid {
  readonly cellSize: number;
  readonly sphereCenter: readonly [number, number, number];
  readonly sphereRadius: number;
  private readonly cells = new Map<number, number[]>();

  constructor(positions: Float32Array, particleCount: number, cellSize: number = PICK_CELL_SIZE) {
    this.cellSize = cellSize;

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < particleCount; i++) {
      const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      const key = this.cellKey(
        Math.floor(x / cellSize), Math.floor(y / cellSize), Math.floor(z / cellSize),
      );
      const cell = this.cells.get(key);
      if (cell) cell.push(i);
      else this.cells.set(key, [i]);
    }

    if (particleCount === 0) {
      this.sphereCenter = [0, 0, 0];
      this.sphereRadius = 0;
    } else {
      this.sphereCenter = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
      this.sphereRadius = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2;
    }
  }

  private cellKey(ix: number, iy: number, iz: number): number {
    return (Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(iz, 83492791)) >>> 0;
  }

  queryBall(x: number, y: number, z: number, radius: number, out: number[], seen: Set<number>): void {
    const cs = this.cellSize;
    const x0 = Math.floor((x - radius) / cs), x1 = Math.floor((x + radius) / cs);
    const y0 = Math.floor((y - radius) / cs), y1 = Math.floor((y + radius) / cs);
    const z0 = Math.floor((z - radius) / cs), z1 = Math.floor((z + radius) / cs);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) {
        for (let iz = z0; iz <= z1; iz++) {
          const cell = this.cells.get(this.cellKey(ix, iy, iz));
          if (!cell) continue;
          for (const i of cell) {
            if (!seen.has(i)) {
              seen.add(i);
              out.push(i);
            }
          }
        }
      }
    }
  }
}

export function pickNearest(
  positions: Float32Array,
  grid: ParticleGrid,
  panelMap: Uint32Array,
  origin: Vec3,
  dir: Vec3,
  maxDistance: number,
): ParticlePickHit | null {
  const dLen = Math.hypot(dir.x, dir.y, dir.z);
  if (dLen === 0 || maxDistance <= 0) return null;
  const nx = dir.x / dLen, ny = dir.y / dLen, nz = dir.z / dLen;

  const [sx, sy, sz] = grid.sphereCenter;
  const ox = origin.x - sx, oy = origin.y - sy, oz = origin.z - sz;
  const b = ox * nx + oy * ny + oz * nz;
  const c = ox * ox + oy * oy + oz * oz - grid.sphereRadius * grid.sphereRadius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  const tStart = Math.max(-b - sq - maxDistance, 0);
  const tEnd = -b + sq + maxDistance;
  if (tEnd <= tStart) return null;

  const step = grid.cellSize;
  const queryRadius = Math.hypot(maxDistance, step * 0.5);
  const candidates: number[] = [];
  const seen = new Set<number>();
  for (let t = tStart; t <= tEnd; t += step) {
    grid.queryBall(origin.x + nx * t, origin.y + ny * t, origin.z + nz * t, queryRadius, candidates, seen);
  }

  let bestIndex = -1;
  let bestDist = Infinity;
  for (const i of candidates) {
    const d = pointToRayDistance(
      positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2],
      origin.x, origin.y, origin.z, nx, ny, nz,
    );
    if (d <= maxDistance && d < bestDist) {
      bestDist = d;
      bestIndex = i;
    }
  }

  if (bestIndex < 0) return null;

  const slot = bestIndex < panelMap.length ? panelMap[bestIndex] : NO_PANEL;
  return { index: bestIndex, distance: bestDist, panelIndex: slot === NO_PANEL ? -1 : slot };
}

export function pickNearestToPoint(
  positions: Float32Array,
  grid: ParticleGrid,
  panelMap: Uint32Array,
  point: Vec3,
  maxDistance: number,
  panelSlot: number,
): ParticlePickHit | null {
  if (maxDistance <= 0) return null;
  const candidates: number[] = [];
  const seen = new Set<number>();
  grid.queryBall(point.x, point.y, point.z, maxDistance, candidates, seen);

  let bestIndex = -1;
  let bestDist = Infinity;
  for (const i of candidates) {
    if (panelSlot >= 0 && (i >= panelMap.length || panelMap[i] !== panelSlot)) continue;
    const d = distance3AtPoint(positions, i, point);
    if (d < bestDist) { bestDist = d; bestIndex = i; }
  }

  if (bestIndex < 0) return null;

  const slot = bestIndex < panelMap.length ? panelMap[bestIndex] : NO_PANEL;
  return { index: bestIndex, distance: bestDist, panelIndex: slot === NO_PANEL ? -1 : slot };
}

export class ParticlePicker {
  private grid: ParticleGrid | null = null;
  private positions: Float32Array | null = null;
  private builtFor = -1;

  sync(positions: Float32Array, particleCount: number, version: number): void {
    if (this.grid && this.builtFor === version) return;
    this.grid = new ParticleGrid(positions, particleCount);
    this.positions = positions;
    this.builtFor = version;
  }

  pickRay(
    panelMap: Uint32Array, origin: Vec3, direction: Vec3, maxDistance: number,
  ): ParticlePickHit | null {
    const grid = this.grid;
    const positions = this.positions;
    if (!grid || !positions) return null;
    return pickNearest(positions, grid, panelMap, origin, direction, maxDistance);
  }

  pickPoint(panelMap: Uint32Array, point: Vec3, maxDistance: number, panelSlot: number): ParticlePickHit | null {
    const grid = this.grid;
    const positions = this.positions;
    if (!grid || !positions) return null;
    return pickNearestToPoint(positions, grid, panelMap, point, maxDistance, panelSlot);
  }
}
