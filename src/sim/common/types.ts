import type { FabricPhysics } from '@/model/types';

export const CONSTRAINT_GROUP_ORDER = ['structural', 'shear', 'crease', 'seam'] as const;

export type ParticleIndex = number;

export type ConstraintGroupKind = typeof CONSTRAINT_GROUP_ORDER[number];

export interface PanelMesh {
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
  readonly vertexCount: number;
  readonly triangleCount: number;
}

export interface Constraint {
  p0: ParticleIndex;
  p1: ParticleIndex;
  restLength: number;
  compliance: number;
  tearLength?: number;
}

export interface PanelInput {
  readonly panelId: string;
  readonly vertexOffset: number;
  readonly mesh: PanelMesh;
  readonly positions3D: Float32Array;
  readonly restPositions: Float32Array;
  physics: FabricPhysics;
  collisionLayer?: number;
  thicknessMeters?: number;
  creaseEdges?: readonly number[];
}

export interface ClothSimInput {
  positions: Float32Array;
  readonly indices: Uint32Array;
  readonly panels: readonly PanelInput[];
  seams: readonly Constraint[];
  readonly pinnedIndices?: readonly ParticleIndex[];
  readonly particleCount: number;
  readonly triangleCount: number;
}

export interface CollisionSurface {
  readonly origin: [number, number, number];
  readonly cell: number;
  readonly dims: [number, number, number];
  readonly cellStart: Uint32Array;
  readonly cellTriangles: Uint32Array;
  readonly vertices: Float32Array;
  readonly triangleCount: number;
}

export interface ColliderGrid {
  readonly triangleCount: number;
  readonly origin: [number, number, number];
  readonly cell: number;
  readonly dims: [number, number, number];
}

export interface SolverFrame {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly contact: Float32Array;
}

export type SolverStatus = 'empty' | 'building' | 'ready' | 'failed';

export interface SolverStats {
  readonly status: SolverStatus;
  readonly particles: number;
  readonly triangles: number;
  readonly constraints: number;
  readonly batches: number;
  readonly substeps: number;
  readonly dispatches: number;
  readonly readbackLagFrames: number;
  readonly timeSeconds: number;
  readonly lastError: string | null;
}

export interface ParticlePickHit {
  index: number;
  distance: number;
  panelIndex: number;
}
