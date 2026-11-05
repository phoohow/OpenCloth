/** View and solver settings persisted with a project, grouped away from scene entities. */

import type { Vec3 } from '@/model/types/geometry';

/** Viewport shading and rendering modes. */
export type RenderMode = 'shaded' | 'raytraced' | 'wireframe' | 'shadedWireframe' | 'uvCheck' | 'normalVis';

/** Tone-mapping operators offered by the renderer. */
export type ToneMappingMode = 'none' | 'aces' | 'reinhard' | 'linear';

/** Denoiser model selected for a finished path-traced frame. */
export type DenoiseModel = 'small' | 'base';

/** Projection the 3D viewport renders through. */
export type CameraProjection = 'perspective' | 'orthographic';

/** 3D fidelity the cloth follows an in-flight 2D edit with. */
export type EditPreviewTier = 'off' | 'low' | 'full';

/** Tuning for the WebGPU path tracer and its progressive samples. */
export interface RayTracingConfig {
  maxBounces: number;
  /** Path slots dispatched in each accumulation frame. */
  frameBudget: number;
  /** Samples each pixel reaches before rendering and denoising stop. */
  maxSamples: number;
  /** Full-resolution render size as a fraction of the canvas. */
  renderScale: number;
  denoise: boolean;
  denoiseModel: DenoiseModel;
  /** Blur applied to glossy reflections to suppress fireflies. */
  filterGlossyFactor: number;
  /** Direct-light contribution clamp; 0 disables clamping. */
  clampDirect: number;
  /** Indirect-light contribution clamp; 0 disables clamping. */
  clampIndirect: number;
}

/** Viewport rendering settings. */
export interface RenderConfig {
  mode: RenderMode;
  toneMapping: ToneMappingMode;
  rayTracing?: RayTracingConfig;
}

/** Constant wind pushing the cloth. */
export interface WindConfig {
  direction: Vec3;
  speed: number;
}

/** How a panel mesh's interior sample points are distributed. */
export type MeshSampling = 'lattice' | 'blueNoise';

/** Solver settings. */
export interface SimulationConfig {
  gravity: Vec3;
  wind: WindConfig;
  /** Fixed timestep in seconds. */
  dt: number;
  substeps: number;
  constraintIterations: number;
  avatarCollision: boolean;
  /** Target simulation mesh edge length in cm; smaller means finer cloth. */
  meshResolutionCm?: number;
  /** Interior mesh point distribution; absent means the hexagonal lattice. */
  meshSampling?: MeshSampling;
  /** Cloth thickness in cm; the minimum clearance against the body and the floor. */
  clothThicknessCm?: number;
  /** CPU self-collision pass after each readback; absent or false skips it entirely. */
  selfCollision?: boolean;
  /** Extra separation per collision-layer step, in cm. */
  layerSpacingCm?: number;
  /** Seam constraints tear once stretched past their strength-derived limit; absent or false never tears. */
  seamTearing?: boolean;
}

/** Saved viewport camera placement: orbit target, eye position and lens framing. */
export interface CameraConfig {
  position: Vec3;
  target: Vec3;
  /** Vertical field of view in degrees; meaningful while the projection is perspective. */
  fovDeg: number;
  projection: CameraProjection;
  /** World height the orthographic frustum spans in meters; meaningful while orthographic. */
  viewHeightMeters: number;
}
