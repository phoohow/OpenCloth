/**
 * GPU-independent cloth self-collision: a uniform spatial hash finds near particle pairs and a
 * position projection pushes them apart, weighting each particle by its inverse mass.
 */

/** Smallest hash cell edge, in meters; thinner cloth still resolves at one centimeter. */
const MIN_CELL_SIZE = 0.01;

/** Candidate pairs one call may visit before the rest are skipped, across all iterations. */
const DEFAULT_MAX_PAIRS = 160_000;

/** Projection iterations of one call. */
const DEFAULT_ITERATIONS = 2;

/** Neighbor rings searched at most around each particle's cell. */
const MAX_SEARCH_RADIUS = 2;

/** Cell coordinate stored for particles that cannot enter the hash. */
const INVALID_CELL = 0x7fffffff;

/** Tunables of one self-collision pass, lengths in meters. */
export interface SelfCollisionParams {
  /** Minimum separation of two particles on the same layer. */
  thickness: number;
  /** Extra separation added per step of collision-layer difference. */
  layerSpacing: number;
  /** Candidate pairs visited per call; pairs beyond it are skipped. */
  maxPairs?: number;
  /** Projection iterations. */
  iterations?: number;
}

/** Outcome of one self-collision pass. */
export interface SelfCollisionResult {
  /** Candidate pairs visited, including pairs already far enough apart. */
  pairs: number;
  /** True when the pair budget ended the pass early. */
  truncated: boolean;
  /** True when a non-finite correction was dropped. */
  nonFinite: boolean;
  /** True when at least one position changed. */
  moved: boolean;
}

/** Spatial-hash self-collision solver with scratch buffers sized once per particle count. */
export class SelfCollisionSolver {
  private readonly count: number;
  private readonly tableSize: number;
  private readonly tableMask: number;
  private readonly cellCount: Int32Array;
  private readonly cellStart: Int32Array;
  private readonly cellFill: Int32Array;
  private readonly entries: Int32Array;
  private readonly cellX: Int32Array;
  private readonly cellY: Int32Array;
  private readonly cellZ: Int32Array;
  private readonly delta: Float32Array;
  private warnedTruncated = false;
  private warnedNonFinite = false;

  constructor(particleCount: number) {
    this.count = particleCount;
    let tableSize = 16;
    while (tableSize < particleCount * 2) tableSize <<= 1;
    this.tableSize = tableSize;
    this.tableMask = tableSize - 1;
    this.cellCount = new Int32Array(tableSize);
    this.cellStart = new Int32Array(tableSize + 1);
    this.cellFill = new Int32Array(tableSize);
    this.entries = new Int32Array(particleCount);
    this.cellX = new Int32Array(particleCount);
    this.cellY = new Int32Array(particleCount);
    this.cellZ = new Int32Array(particleCount);
    this.delta = new Float32Array(particleCount * 3);
  }

  /**
   * Pushes particle pairs closer than their target spacing apart, in place.
   * Particles with inverse mass 0 stay where they are; a non-finite result is discarded.
   */
  resolve(
    positions: Float32Array,
    invMasses: Float32Array,
    layers: Uint8Array,
    params: SelfCollisionParams,
  ): SelfCollisionResult {
    const empty: SelfCollisionResult = { pairs: 0, truncated: false, nonFinite: false, moved: false };
    const count = this.count;
    if (count === 0 || positions.length < count * 3 || invMasses.length < count) return empty;

    const thickness = Math.max(0, params.thickness);
    const layerSpacing = Math.max(0, params.layerSpacing);
    if (!Number.isFinite(thickness) || !Number.isFinite(layerSpacing)) return empty;
    const maxPairs = Math.max(1, params.maxPairs ?? DEFAULT_MAX_PAIRS);
    const iterations = Math.max(1, Math.round(params.iterations ?? DEFAULT_ITERATIONS));
    const cellSize = Math.max(thickness, MIN_CELL_SIZE);

    let minLayer = 255;
    let maxLayer = 0;
    for (let i = 0; i < count; i++) {
      const layer = layers[i] ?? 0;
      if (layer < minLayer) minLayer = layer;
      if (layer > maxLayer) maxLayer = layer;
    }
    // Rings needed so the widest layer gap is still inside the searched neighborhood.
    const required = thickness + Math.max(0, maxLayer - minLayer) * layerSpacing;
    const searchRadius = Math.min(MAX_SEARCH_RADIUS, Math.max(1, Math.ceil(required / cellSize)));
    const reach = searchRadius * cellSize;

    let pairs = 0;
    let truncated = false;
    let nonFinite = false;
    let moved = false;

    for (let iter = 0; iter < iterations && !truncated; iter++) {
      this.buildHash(positions, cellSize);
      this.delta.fill(0);
      let changed = false;

      search:
      for (let i = 0; i < count; i++) {
        if (!Number.isFinite(positions[i * 3]) || !Number.isFinite(positions[i * 3 + 1])
          || !Number.isFinite(positions[i * 3 + 2])) continue;
        const ix = this.cellX[i]!;
        const iy = this.cellY[i]!;
        const iz = this.cellZ[i]!;
        if (ix === INVALID_CELL) continue;
        const wI = invMasses[i]!;
        if (!Number.isFinite(wI)) continue;

        for (let dx = -searchRadius; dx <= searchRadius; dx++) {
          for (let dy = -searchRadius; dy <= searchRadius; dy++) {
            for (let dz = -searchRadius; dz <= searchRadius; dz++) {
              const nx = ix + dx;
              const ny = iy + dy;
              const nz = iz + dz;
              const slot = hashCell(nx, ny, nz, this.tableMask);
              for (let e = this.cellStart[slot]!; e < this.cellStart[slot + 1]!; e++) {
                const j = this.entries[e]!;
                if (j <= i) continue;
                if (this.cellX[j] !== nx || this.cellY[j] !== ny || this.cellZ[j] !== nz) continue;
                pairs++;
                if (pairs > maxPairs) {
                  truncated = true;
                  break search;
                }
                const wJ = invMasses[j]!;
                const wSum = wI + wJ;
                if (!(wSum > 0)) continue;

                const px = positions[i * 3]!;
                const py = positions[i * 3 + 1]!;
                const pz = positions[i * 3 + 2]!;
                const qx = positions[j * 3]!;
                const qy = positions[j * 3 + 1]!;
                const qz = positions[j * 3 + 2]!;
                const ex = qx - px;
                const ey = qy - py;
                const ez = qz - pz;
                const dist2 = ex * ex + ey * ey + ez * ez;
                if (!Number.isFinite(dist2)) continue;

                const layerDiff = Math.abs((layers[i] ?? 0) - (layers[j] ?? 0));
                // The hash cannot see beyond its searched rings, so wider targets stop at that reach.
                const spacing = Math.min(thickness + layerDiff * layerSpacing, reach);
                if (dist2 >= spacing * spacing) continue;

                const dist = Math.sqrt(dist2);
                let sx = 0;
                let sy = 1;
                let sz = 0;
                if (dist > 1e-8) {
                  sx = ex / dist;
                  sy = ey / dist;
                  sz = ez / dist;
                }
                const overlap = (spacing - dist) / wSum;
                this.delta[i * 3] -= sx * overlap * wI;
                this.delta[i * 3 + 1] -= sy * overlap * wI;
                this.delta[i * 3 + 2] -= sz * overlap * wI;
                this.delta[j * 3] += sx * overlap * wJ;
                this.delta[j * 3 + 1] += sy * overlap * wJ;
                this.delta[j * 3 + 2] += sz * overlap * wJ;
                changed = true;
              }
            }
          }
        }
      }

      if (!changed) break;
      for (let i = 0; i < count; i++) {
        const ax = this.delta[i * 3]!;
        const ay = this.delta[i * 3 + 1]!;
        const az = this.delta[i * 3 + 2]!;
        if (ax === 0 && ay === 0 && az === 0) continue;
        const x = positions[i * 3]! + ax;
        const y = positions[i * 3 + 1]! + ay;
        const z = positions[i * 3 + 2]! + az;
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
          nonFinite = true;
          continue;
        }
        positions[i * 3] = x;
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = z;
        moved = true;
      }
    }

    if (truncated && !this.warnedTruncated) {
      this.warnedTruncated = true;
      console.warn(`Self collision skipped pairs beyond ${maxPairs} candidates this frame.`);
    }
    if (nonFinite && !this.warnedNonFinite) {
      this.warnedNonFinite = true;
      console.warn('Self collision dropped a non-finite correction.');
    }
    return { pairs, truncated, nonFinite, moved };
  }

  /** Fills the cell grid over the current positions. */
  private buildHash(positions: Float32Array, cellSize: number): void {
    const count = this.count;
    const inv = 1 / cellSize;
    this.cellCount.fill(0);
    for (let i = 0; i < count; i++) {
      const x = positions[i * 3]!;
      const y = positions[i * 3 + 1]!;
      const z = positions[i * 3 + 2]!;
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        this.cellX[i] = INVALID_CELL;
        this.cellY[i] = INVALID_CELL;
        this.cellZ[i] = INVALID_CELL;
        continue;
      }
      const cx = Math.floor(x * inv);
      const cy = Math.floor(y * inv);
      const cz = Math.floor(z * inv);
      this.cellX[i] = cx;
      this.cellY[i] = cy;
      this.cellZ[i] = cz;
      const slot = hashCell(cx, cy, cz, this.tableMask);
      this.cellCount[slot] = this.cellCount[slot]! + 1;
    }

    this.cellStart[0] = 0;
    for (let c = 0; c < this.tableSize; c++) {
      this.cellStart[c + 1] = this.cellStart[c]! + this.cellCount[c]!;
      this.cellFill[c] = this.cellStart[c]!;
    }
    for (let i = 0; i < count; i++) {
      if (this.cellX[i] === INVALID_CELL) continue;
      const slot = hashCell(this.cellX[i]!, this.cellY[i]!, this.cellZ[i]!, this.tableMask);
      const entry = this.cellFill[slot]!;
      this.entries[entry] = i;
      this.cellFill[slot] = entry + 1;
    }
  }
}

/** Hash slot of one integer cell coordinate. */
function hashCell(x: number, y: number, z: number, mask: number): number {
  const h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) >>> 0;
  return h & mask;
}
