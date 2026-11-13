import type { FabricPhysics } from '@/model/types';
import type { TriangleMesh } from '@/pattern/triangulate';

/** One GPU distance constraint: a particle pair held near a rest length. */
export interface Constraint {
  p0: number;
  p1: number;
  restLength: number;
  compliance: number;
  /** Distance beyond which the constraint tears; absent constraints never tear. */
  tearLength?: number;
}

/** Fabric weight (g/m²) used when a panel has no material record. */
const FABRIC_DEFAULT_MASS_PER_AREA = 180;

/** Area a particle outside every panel stands for, in square meters. */
const NOMINAL_PARTICLE_AREA_M2 = 1e-4;

/** Mass the nominal patch and degenerate panel vertices get, in kilograms. */
const NOMINAL_PARTICLE_MASS_KG = (FABRIC_DEFAULT_MASS_PER_AREA / 1000) * NOMINAL_PARTICLE_AREA_M2;

/** Merged geometry and constraints of all pattern pieces handed to the GPU solver. */
export interface ClothSimInput {
  /**
   * Merged 3D particle positions across all pattern pieces, flat [x,y,z,...], in meters. Starts at
   * the initial layout; the solver reads back into this array, so the render mesh, picking and
   * highlights all see the live positions.
   */
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
    /** Material physics of the piece; stiffness shapes its constraints and areal weight its mass. */
    physics: FabricPhysics;
    /** Collision layer of the piece, 0 is the innermost. */
    collisionLayer?: number;
    /** Collision clearance of the piece in meters; absent uses the scene cloth thickness. */
    thicknessMeters?: number;
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
 * Per-particle inverse mass in kg⁻¹ from the physical panel mass; particles outside every panel
 * keep the nominal patch mass. The solver integrates accelerations, so this is the only inertia
 * the cloth has.
 */
export function computeBaseInvMass(
  input: ClothSimInput,
  physics: FabricPhysics[],
  particleCount: number,
): Float32Array {
  const mass = computeParticleMass(input, physics, particleCount);
  const out = new Float32Array(particleCount);
  for (let i = 0; i < particleCount; i++) {
    const value = mass[i]!;
    out[i] = 1 / (value > 0 ? value : NOMINAL_PARTICLE_MASS_KG);
  }
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

/**
 * Per-particle mass in kilograms: each panel's areal weight spread over its own mesh area. This is
 * the inertia the solver integrates and the mass the drag force acts on; particles outside every
 * panel take the default weight over a nominal 1 cm² patch.
 */
export function computeParticleMass(
  input: ClothSimInput,
  physics: FabricPhysics[],
  particleCount: number,
): Float32Array<ArrayBuffer> {
  const out = new Float32Array(particleCount).fill(NOMINAL_PARTICLE_MASS_KG);
  input.panels.forEach((panel, slot) => {
    const kgPerM2 = Math.max(physics[slot]?.massPerArea ?? FABRIC_DEFAULT_MASS_PER_AREA, 1) / 1000;
    const shares = vertexAreas(panel.mesh);
    const end = Math.min(panel.vertexOffset + panel.mesh.vertexCount, particleCount);
    for (let i = panel.vertexOffset; i < end; i++) {
      out[i] = kgPerM2 * shares[i - panel.vertexOffset]!;
    }
  });
  return out;
}

/** Mean rest area one particle of a panel mesh stands for, in square meters. */
export function meanParticleAreaM2(mesh: TriangleMesh): number {
  if (mesh.vertexCount <= 0) return NOMINAL_PARTICLE_AREA_M2;
  const shares = vertexAreas(mesh);
  let total = 0;
  for (let i = 0; i < shares.length; i++) total += shares[i]!;
  return total / mesh.vertexCount;
}

/**
 * Factor from the mass unit the compliance presets are tuned against to the physical per-particle
 * mass. XPBD's alpha term has to grow with the inverse-mass sum, so it scales by
 * oldMass / newMass. The fabric weight cancels, leaving 10 / mean vertex area in square meters.
 */
export function complianceMassScale(mesh: TriangleMesh): number {
  return 10 / Math.max(meanParticleAreaM2(mesh), 1e-12);
}

/** Area each vertex of a flat panel mesh stands for, in square meters; the mesh is in centimetres. */
function vertexAreas(mesh: TriangleMesh): Float32Array {
  const areas = new Float32Array(mesh.vertexCount);
  const { positions, indices } = mesh;
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const a = indices[t]!;
    const b = indices[t + 1]!;
    const c = indices[t + 2]!;
    const ax = positions[a * 2]!;
    const ay = positions[a * 2 + 1]!;
    const bx = positions[b * 2]!;
    const by = positions[b * 2 + 1]!;
    const cx = positions[c * 2]!;
    const cy = positions[c * 2 + 1]!;
    const third = Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 6 * 1e-4;
    areas[a] += third;
    areas[b] += third;
    areas[c] += third;
  }
  return areas;
}

/** Per-particle collision clearance in meters from each panel record. */
export function computeParticleThickness(
  input: ClothSimInput,
  particleCount: number,
  fallback: number,
): Float32Array<ArrayBuffer> {
  const out = new Float32Array(particleCount).fill(fallback);
  for (const panel of input.panels) {
    const value = panel.thicknessMeters ?? fallback;
    const end = Math.min(panel.vertexOffset + panel.mesh.vertexCount, particleCount);
    for (let i = panel.vertexOffset; i < end; i++) out[i] = value;
  }
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
