import type { FabricPhysics } from '../core/model/types';
import type { TriangleMesh } from '../pattern/triangulate/triangulate';
import type { Constraint } from './buffers/constraintBuilder';

/** Fabric weight (g/m²) used when a panel has no material record. */
const FABRIC_DEFAULT_MASS_PER_AREA = 180;

/** Merged geometry and constraints of all pattern pieces handed to the GPU solver. */
export interface ClothSimInput {
  /** Merged initial 3D positions across all pattern pieces, flat [x,y,z,...], in meters. */
  positions: Float32Array;
  /** Merged triangle indices. */
  indices: Uint32Array;
  /** Per-piece vertex offset and mesh, used to generate constraints. */
  panels: Array<{
    panelId: string;
    /** First merged particle index of this piece. */
    vertexOffset: number;
    mesh: TriangleMesh;
    positions3D: Float32Array;
    /** Flat-pattern positions the piece's rest lengths were measured from, in meters. */
    restPositions: Float32Array;
    /** Material physics of the piece; its stiffness and weight shape its own constraints. */
    physics: FabricPhysics;
  }>;
  /** Seam constraints (particle pairs across pattern pieces). */
  seamConstraints: Constraint[];
  /** Pinned particle indices (inverse mass = 0). */
  pinnedIndices?: number[];
  particleCount: number;
  triangleCount: number;
}

/** Constraint batches with the storage buffer holding each packed batch. */
export interface BatchedConstraints {
  /** Batches in the order they were packed into `buffers`. */
  batches: Constraint[][];
  /** One storage buffer per batch. */
  buffers: GPUBuffer[];
  /** Total constraints across all batches. */
  count: number;
}

/**
 * Per-particle inverse mass from each panel's fabric weight; particles outside every
 * panel keep the mid-weight default so they never read as pinned.
 */
export function computeBaseInvMass(
  input: ClothSimInput,
  physics: FabricPhysics[],
  particleCount: number,
): Float32Array {
  const toInvMass = (massPerArea: number): number => 1.0 / Math.max(massPerArea, 1) * 100;
  const out = new Float32Array(particleCount).fill(toInvMass(FABRIC_DEFAULT_MASS_PER_AREA));
  input.panels.forEach((panel, slot) => {
    const invMass = toInvMass(physics[slot]?.massPerArea ?? FABRIC_DEFAULT_MASS_PER_AREA);
    const end = panel.vertexOffset + panel.mesh.vertexCount;
    for (let i = panel.vertexOffset; i < end && i < particleCount; i++) out[i] = invMass;
  });
  return out;
}
