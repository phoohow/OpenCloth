/**
 * Everything around the garment: lights, rendering, the solver configuration, reference
 * objects and the saved camera.
 */

import type { ObjectTransform, Vec3 } from './geometry';

// ============ Scene ============

/** Light kinds the viewport can render. */
export type LightType = 'directional' | 'point' | 'spot' | 'area';

/** One punctual light in the scene. */
export interface SceneLight {
  id: string;
  name: string;
  type: LightType;
  /** Off when false; the light stays in the project and in the outliner. */
  enabled: boolean;
  /** Brightness: lux-like for directional lights, candela-like for point and spot lights. */
  intensity: number;
  color: string;
  /** World position in meters; a directional light only uses its direction from the target. */
  position: Vec3;
  /** Point the light aims at; unused by point lights. */
  target: Vec3;
  /** Range in meters, 0 for unlimited. Point, spot and area lights. */
  distance: number;
  /** Full cone angle of a spot light, in degrees. */
  coneAngleDeg: number;
  /** Softness of a spot cone's edge, 0 is a hard edge. */
  penumbra: number;
  /** Emitter width and height in meters, for area lights. */
  width: number;
  height: number;
}

/** Scene lighting from the project's lights plus an environment image. */
export interface LightConfig {
  /** Punctual lights, in outliner order. */
  lights: SceneLight[];
  /** Outliner display name of the environment light; the image name stays in `iblName`. */
  iblLabel?: string;
  /** Url of an equirectangular environment image; absent selects the bundled default. */
  iblUrl?: string;
  /** Object-store key of an imported environment image. */
  iblObjectKey?: string;
  /** File name of the imported environment image. */
  iblName?: string;
  /** Off when false; the environment image stays selected for lighting and backdrop. */
  iblEnabled: boolean;
  /** Multiplier for the environment image's lighting contribution. */
  iblIntensity: number;
}

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

/** Persisted descriptor of an imported reference object. */
export interface ReferenceObjectRef {
  id: string;
  name: string;
  /** Blob key in the local object store; absent when the file is no longer available. */
  objectKey?: string;
  /** Embedded model data URL written on save; takes precedence over `objectKey`. */
  objectUrl?: string;
  visible: boolean;
  opacity: number;
  /** Scene placement; absent means the identity transform. */
  transform?: ObjectTransform;
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

/** Everything around the garment: lighting, rendering, solving and reference objects. */
export interface SceneConfig {
  lights: LightConfig;
  render: RenderConfig;
  simulation: SimulationConfig;
  referenceObjects?: ReferenceObjectRef[];
  /** Saved camera placement, restored when the project opens. */
  camera?: CameraConfig;
  /** Outliner display name of the viewport camera. */
  cameraName?: string;
}
