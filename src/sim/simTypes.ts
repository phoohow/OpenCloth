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
    /** Collision layer of the piece, 0 is the innermost. */
    collisionLayer?: number;
    /**
     * Flat local mesh vertex index pairs [a, b, ...] of the triangle edges the panel's fold lines
     * cross; each pair becomes a stiff crease constraint.
     */
    creaseEdges?: number[];
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

/** Constraint groups the solver dispatches, in solve order. */
export const CONSTRAINT_GROUP_ORDER = ['structural', 'shear', 'bending', 'crease', 'seam'] as const;

/** One solver constraint group, replaceable while the simulation keeps running. */
export type ConstraintGroupKind = typeof CONSTRAINT_GROUP_ORDER[number];

/** A constraint group with its GPU resources: one batch, bind group and parameter buffer per color. */
export interface ConstraintGroup {
  batched: BatchedConstraints;
  bindGroups: GPUBindGroup[];
  /** Constraint count of each batch, one-to-one with `bindGroups`. */
  counts: number[];
  /** Uniform buffers behind the bind groups. */
  paramBufs: GPUBuffer[];
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

/** Per-particle damping from each panel's fabric; particles outside every panel keep the fallback. */
export function computeParticleDamping(
  input: ClothSimInput,
  physics: FabricPhysics[],
  particleCount: number,
  fallback: number,
): Float32Array<ArrayBuffer> {
  const out = new Float32Array(particleCount).fill(fallback);
  input.panels.forEach((panel, slot) => {
    const value = physics[slot]?.damping ?? fallback;
    const end = Math.min(panel.vertexOffset + panel.mesh.vertexCount, particleCount);
    for (let i = panel.vertexOffset; i < end; i++) out[i] = value;
  });
  return out;
}

/** Per-particle collision layer from each panel record, clamped to 0–9. */
export function computeParticleLayers(input: ClothSimInput, particleCount: number): Uint8Array {
  const layers = new Uint8Array(particleCount);
  for (const panel of input.panels) {
    const layer = Math.min(9, Math.max(0, Math.round(panel.collisionLayer ?? 0)));
    const end = Math.min(panel.vertexOffset + panel.mesh.vertexCount, particleCount);
    for (let i = panel.vertexOffset; i < end; i++) layers[i] = layer;
  }
  return layers;
}
