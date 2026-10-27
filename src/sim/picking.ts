import type { ClothSimInput } from './simTypes';

// Particle-to-panel and ray-pick helpers operating on CPU data only.

/** Cell edge length of the particle pick grid, in meters. */
export const PICK_CELL_SIZE = 0.02;

/** Panel slot value for particles outside every panel. */
const NO_PANEL = 0xffffffff;

/** Minimal 3-component vector accepted by the pick API. */
export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** Closest particle to a pick ray. */
export interface ParticlePickHit {
  /** Particle index into the merged particle array. */
  index: number;
  /** Perpendicular distance from the particle to the ray, in meters. */
  distance: number;
  /** Panel slot of the particle; -1 when the particle is unmapped. */
  panelIndex: number;
}

/** Maps each particle to its panel slot (index into input.panels); NO_PANEL for unmapped particles. */
export function computeParticlePanelMap(input: ClothSimInput): Uint32Array {
  const map = new Uint32Array(input.particleCount).fill(NO_PANEL);
  input.panels.forEach((panel, slot) => {
    const end = Math.min(panel.vertexOffset + panel.mesh.vertexCount, map.length);
    for (let i = panel.vertexOffset; i < end; i++) map[i] = slot;
  });
  return map;
}

/** Builds the particle panel map, validated against one name per panel slot. */
export function buildParticlePanelMap(input: ClothSimInput, panelNames: string[]): Uint32Array {
  if (panelNames.length !== input.panels.length) {
    throw new Error(`panelNames length ${panelNames.length} must match panels length ${input.panels.length}`);
  }
  return computeParticlePanelMap(input);
}

/**
 * Perpendicular distance from a point to a ray (dir need not be normalized);
 * Infinity when the projection falls behind the ray origin.
 */
export function pointToRayDistance(
  px: number, py: number, pz: number,
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
): number {
  const dLen = Math.hypot(dx, dy, dz);
  if (dLen === 0) return Infinity;
  const nx = dx / dLen, ny = dy / dLen, nz = dz / dLen;
  const wx = px - ox, wy = py - oy, wz = pz - oz;
  if (wx * nx + wy * ny + wz * nz <= 0) return Infinity;
  const cx = wy * nz - wz * ny;
  const cy = wz * nx - wx * nz;
  const cz = wx * ny - wy * nx;
  return Math.hypot(cx, cy, cz);
}

/** Uniform hash grid over particle positions, built for ray picking. */
export class ParticleGrid {
  readonly cellSize: number;
  /** Bounding sphere of all particles, used to bound the ray walk. */
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

  /** Hash of integer cell coordinates; collisions merge cells, which only enlarges candidate sets. */
  private cellKey(ix: number, iy: number, iz: number): number {
    return (Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(iz, 83492791)) >>> 0;
  }

  /** Appends particles in cells overlapping a ball around (x,y,z), deduplicating via `seen`. */
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

/**
 * Nearest particle within maxDistance (perpendicular to the ray, meters),
 * walking ray samples through the grid bounded by the particle bounding sphere.
 */
export function pickNearest(
  positions: Float32Array,
  grid: ParticleGrid,
  panelMap: Uint32Array,
  origin: Vec3Like,
  dir: Vec3Like,
  maxDistance: number,
): ParticlePickHit | null {
  const dLen = Math.hypot(dir.x, dir.y, dir.z);
  if (dLen === 0 || maxDistance <= 0) return null;
  const nx = dir.x / dLen, ny = dir.y / dLen, nz = dir.z / dLen;

  // Ray vs bounding sphere gives the along-ray walk range; pad by maxDistance for near-edge particles.
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

  // Samples spaced one cell apart; the ball radius covers the gap between samples.
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

/**
 * Nearest particle to a point within maxDistance (meters), optionally limited to one panel slot
 * so a click on the visible sheet cannot reach the particles of the sheet behind it.
 */
export function pickNearestToPoint(
  positions: Float32Array,
  grid: ParticleGrid,
  panelMap: Uint32Array,
  point: Vec3Like,
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
    const d = pointToPositionDistance(positions, i, point);
    if (d < bestDist) { bestDist = d; bestIndex = i; }
  }
  if (bestIndex < 0) return null;

  const slot = bestIndex < panelMap.length ? panelMap[bestIndex] : NO_PANEL;
  return { index: bestIndex, distance: bestDist, panelIndex: slot === NO_PANEL ? -1 : slot };
}

/** Distance from one particle to a point. */
function pointToPositionDistance(positions: Float32Array, index: number, point: Vec3Like): number {
  const offset = index * 3;
  if (offset + 2 >= positions.length) return Infinity;
  return Math.hypot(positions[offset] - point.x, positions[offset + 1] - point.y, positions[offset + 2] - point.z);
}
