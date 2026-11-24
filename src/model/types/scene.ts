import type { ObjectTransform, Vec3 } from '@/model/types/geometry';

export type SurfaceMode = 'material' | 'uv' | 'normal';

export type WireMode = 'off' | 'only' | 'over';

export type RenderBackend = 'raster' | 'pathtrace';

export interface WireOptions {
  color: number;
  depth: 'tested' | 'always';
}

export type ToneMappingMode = 'none' | 'aces' | 'reinhard' | 'linear';

export type DenoiseModel = 'small' | 'base';

export type CameraProjection = 'perspective' | 'orthographic';

export type EditPreviewTier = 'off' | 'low' | 'full';

export interface RayTracingConfig {
  maxBounces: number;
  frameBudget: number;
  maxSamples: number;
  renderScale: number;
  denoise: boolean;
  denoiseModel: DenoiseModel;
  filterGlossyFactor: number;
  clampDirect: number;
  clampIndirect: number;
}

export interface RenderConfig {
  wireOptions: WireOptions;
  toneMapping: ToneMappingMode;
  rayTracing?: RayTracingConfig;
}

export interface WindConfig {
  direction: Vec3;
  speed: number;
}

export type MeshSampling = 'lattice' | 'blueNoise';

export interface SimulationConfig {
  gravity: Vec3;
  wind: WindConfig;
  dt: number;
  substeps: number;
  constraintIterations: number;
  avatarCollision: boolean;
  floorCollision?: boolean;
  meshResolutionCm?: number;
  meshSampling?: MeshSampling;
  clothThicknessCm?: number;
  contactFrictionScale?: number;
  selfCollision?: boolean;
  layerSpacingCm?: number;
  seamTearing?: boolean;
}

export interface CameraConfig {
  position: Vec3;
  target: Vec3;
  fovDeg: number;
  projection: CameraProjection;
  viewHeightMeters: number;
}

export type CameraAnimationKind = 'orbit' | 'dolly' | 'pan' | 'crane';

export interface CameraAnimationConfig {
  kind: CameraAnimationKind;
  enabled: boolean;
  periodSec: number;
  amplitude: number;
}

export type LightType = 'directional' | 'point' | 'spot' | 'area';

export interface SceneLight {
  id: string;
  name: string;
  type: LightType;
  enabled: boolean;
  intensity: number;
  color: string;
  position: Vec3;
  target: Vec3;
  distance: number;
  coneAngleDeg: number;
  penumbra: number;
  width: number;
  height: number;
}

export type EnvironmentSource = 'builtin' | 'custom';

export interface LightConfig {
  lights: SceneLight[];
  iblLabel?: string;
  iblUrl?: string;
  iblObjectKey?: string;
  iblName?: string;
  iblSource?: EnvironmentSource;
  iblEnabled: boolean;
  iblIntensity: number;
}

export interface FloorConfig {
  width: number;
  depth: number;
  gridSpacing: number;
  gridVisible: boolean;
  transform?: ObjectTransform;
}

export interface ReferenceObjectRef {
  id: string;
  name: string;
  objectKey?: string;
  objectUrl?: string;
  visible: boolean;
  opacity: number;
  transform?: ObjectTransform;
}

export interface SceneConfig {
  lights: LightConfig;
  render: RenderConfig;
  simulation: SimulationConfig;
  referenceObjects?: ReferenceObjectRef[];
  camera?: CameraConfig;
  cameraAnimation?: CameraAnimationConfig;
  cameraName?: string;
  floorName?: string;
  floorVisible?: boolean;
  floor?: FloorConfig;
}
