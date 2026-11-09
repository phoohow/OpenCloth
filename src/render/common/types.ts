/** Shared render vocabulary: pure data exchanged by GPU, world, renderer and viewport. */

import type { Vec3 } from '@/base/math';

export type EntityId = number;
export type MeshId = number;
export type MaterialId = number;
export type LightId = number;
export type AssetKey = string;

/** Pixel sizes one frame needs. */
export interface FrameSize {
  /** Drawing-buffer size, in device pixels. */
  readonly width: number;
  readonly height: number;
  /** Path-traced size, in CSS pixels scaled by the tracer's own render scale. */
  readonly traceWidth: number;
  readonly traceHeight: number;
}

export interface Bounds {
  readonly min: Vec3;
  readonly max: Vec3;
}

export interface Transform {
  position: Vec3;
  /** Euler angles in radians, XYZ order. */
  rotationEuler: Vec3;
  scale: Vec3;
}

export interface Ray {
  readonly origin: Vec3;
  readonly direction: Vec3;
}

export interface RayHit {
  readonly entity: EntityId;
  readonly triangle: number;
  readonly distance: number;
  readonly point: Vec3;
  readonly barycentric: readonly [number, number, number];
}

export type MeshTopology = 'triangle' | 'line' | 'point';

export interface MeshStreams {
  /** Flat xyz triples. */
  position: Float32Array;
  /** Flat xyz normals, optional. */
  normal?: Float32Array;
  /** Flat uv pairs, optional. */
  uv?: Float32Array;
  /** Flat rgb triples, optional. */
  color?: Float32Array;
  /** One scalar per vertex, sampled by heatmap materials. */
  field?: Float32Array;
}

export interface MeshGroup {
  start: number;
  count: number;
  materialSlot: number;
}

export interface InstanceData {
  /** Flat column-major 4x4 matrices, one per instance. */
  matrices: Float32Array;
  /** Optional flat rgb per instance. */
  colors?: Float32Array;
  count: number;
}

export interface MeshData {
  topology: MeshTopology;
  streams: MeshStreams;
  index?: Uint32Array;
  groups?: readonly MeshGroup[];
  instances?: InstanceData;
  bounds?: Bounds;
}

export type MaterialKind = 'surface' | 'unlit' | 'line' | 'heatmap' | 'wire' | 'diagnostic';
export type MaterialMapSlot = 'albedo' | 'normal' | 'roughness' | 'metallic';
export type BlendMode = 'opaque' | 'alpha' | 'additive';
export type DepthMode = 'tested' | 'always';
export type SideMode = 'front' | 'back' | 'double';

export interface MaterialData {
  kind: MaterialKind;
  name?: string;
  color?: string | number;
  roughness?: number;
  metalness?: number;
  opacity?: number;
  vertexColors?: boolean;
  /** Texture keys resolved by the GPU texture port. */
  maps?: Partial<Record<MaterialMapSlot, string>>;
  /** Repeat and offset applied to every map of the material. */
  uvTiling?: { x: number; y: number };
  uvOffset?: { x: number; y: number };
  blending?: BlendMode;
  depth?: DepthMode;
  /** Overrides the depth write implied by blending; a translucent floor keeps it off. */
  depthWrite?: boolean;
  side?: SideMode;
  wireframe?: boolean;
  /** Negative values pull the surface toward the camera, as with three's polygon offset. */
  polygonOffset?: { factor: number; units: number };
  /** Fabric sheen of a surface material. */
  sheen?: number;
  sheenColor?: string | number;
  sheenRoughness?: number;
  transmission?: number;
  thickness?: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  anisotropy?: number;
  iridescence?: number;
  normalScale?: number;
  heatmap?: {
    readonly palette: readonly string[];
    readonly min: number;
    readonly max: number;
  };
}

export interface CameraState {
  readonly projection: 'perspective' | 'orthographic';
  readonly position: Vec3;
  readonly target: Vec3;
  readonly up: Vec3;
  readonly fovDeg: number;
  readonly viewHeightMeters: number;
  readonly aspect: number;
  readonly near: number;
  readonly far: number;
}

export type CameraProjection = 'perspective' | 'orthographic';

export interface CameraPose {
  readonly position: Vec3;
  readonly target: Vec3;
  readonly up?: Vec3;
  readonly fovDeg: number;
  readonly viewHeightMeters: number;
  readonly projection: CameraProjection;
}

export interface CameraHost {
  update(): void;
  snapshot(aspect?: number): CameraState;
  projection(): CameraProjection;
  setProjection(projection: CameraProjection): void;
  setPose(pose: CameraPose): void;
  frame(bounds: Bounds): void;
  ray(ndcX: number, ndcY: number, aspect?: number): Ray;
  onChange(listener: () => void): () => void;
}

export type LightType = 'directional' | 'point' | 'spot' | 'area';

export interface LightData {
  readonly type: LightType;
  readonly name: string;
  readonly color: string;
  readonly intensity: number;
  readonly position: Vec3;
  readonly target: Vec3;
  readonly distance: number;
  readonly coneAngleDeg: number;
  readonly penumbra: number;
  readonly width: number;
  readonly height: number;
  readonly enabled: boolean;
}

export interface EnvironmentData {
  readonly background: 'color' | 'texture' | 'none';
  readonly color: string;
  readonly textureKey: string | null;
  readonly intensity: number;
  /** Url the texture key was loaded from; empty while no image is used. */
  readonly url: string;
}

export interface VersionStamp {
  readonly topology: number;
  readonly geometry: number;
  readonly transform: number;
  readonly material: number;
  readonly visibility: number;
  readonly lights: number;
  readonly environment: number;
}

export type LayerId = 'underlay' | 'subject' | 'overlay' | 'gizmo';
export type EntityTag = string;

/** Entities drawn by the raster pipeline. */
export const CHANNEL_RASTER = 1;
/** Entities drawn by the path tracer. */
export const CHANNEL_TRACE = 2;
/** Entities drawn by both pipelines. */
export const CHANNEL_ALL = CHANNEL_RASTER | CHANNEL_TRACE;

export type ChannelMask = number;

export interface EntityFilter {
  readonly layers?: readonly LayerId[];
  readonly channels?: ChannelMask;
  /** Entities must carry every listed tag. */
  readonly tags?: readonly EntityTag[];
}

export type MaterialTechnique =
  | 'surface'
  | 'unlit'
  | 'line'
  | 'heatmap'
  | 'wire'
  | 'diagnostic'
  | 'asset';

/** Diagnostic fill drawn by the `diagnostic` technique. */
export type FillMode = 'physical' | 'uvCheck' | 'normal' | 'vertexNormal';

export type DrawStage = 'scene' | 'postTone' | 'gizmo';
export type DrawBucket = 'opaque' | 'transparent' | 'overlay' | 'gizmo';

export type WireMode = 'off' | 'only' | 'over';
export type RenderMode = 'raster' | 'pathtrace';
export type ToneMappingMode = 'none' | 'aces' | 'reinhard' | 'linear';
export type DenoiseModel = 'small' | 'base';

export interface WireOptions {
  readonly color: number;
  readonly depth: DepthMode;
}

export interface TraceSettings {
  readonly maxBounces: number;
  readonly frameBudget: number;
  readonly maxSamples: number;
  readonly renderScale: number;
  readonly denoise: boolean;
  readonly denoiseModel: DenoiseModel;
  readonly filterGlossyFactor: number;
  readonly clampDirect: number;
  readonly clampIndirect: number;
}

export interface ViewSettings {
  readonly fill: FillMode;
  readonly wire: WireMode;
  readonly mode: RenderMode;
  readonly wireOptions: WireOptions;
  readonly toneMapping: ToneMappingMode;
  readonly exposure: number;
  readonly trace: TraceSettings;
}

export interface ResolvedMaterial {
  readonly technique: MaterialTechnique;
  readonly data: MaterialData;
  readonly source: MaterialRef;
  /** World material revision behind the variant; absent for view-generated variants. */
  readonly revision?: number;
  /** Diagnostic fill mode carried into the GPU material compiler. */
  readonly diagnostic?: FillMode;
}

export type MaterialRef =
  | { readonly kind: 'material'; readonly id: MaterialId }
  | { readonly kind: 'asset'; readonly key: AssetKey; readonly slot: number };

export type MeshRef =
  | { readonly kind: 'mesh'; readonly id: MeshId }
  | { readonly kind: 'asset'; readonly key: AssetKey };

/** View-level display rule applied by tag, channel and stage. */
export interface DisplayOverride {
  readonly tags: readonly EntityTag[];
  readonly technique: MaterialTechnique;
  readonly channels: ChannelMask;
  readonly stage: DrawStage;
  readonly mode: 'replace' | 'over';
  readonly params?: Partial<MaterialData>;
}

export interface SceneItem {
  readonly key: EntityId;
  readonly mesh: MeshRef;
  readonly transform: Transform;
  /** Stage inside the raster root; the trace root always draws in `scene`. */
  readonly rasterStage: DrawStage;
  readonly bucket: DrawBucket;
  readonly rasterMaterials: readonly ResolvedMaterial[];
  readonly traceMaterials: readonly ResolvedMaterial[];
  readonly wire: ResolvedMaterial | null;
}

export interface SceneMesh extends MeshData {
  readonly id: MeshId;
  readonly revision: number;
}

export interface SceneSnapshot {
  readonly items: readonly SceneItem[];
  readonly meshes: readonly SceneMesh[];
  readonly lights: readonly LightData[];
  readonly environment: EnvironmentData;
  readonly versions: Readonly<VersionStamp>;
}

/** Gate that kept a frame on the raster base instead of tracing it. */
export type TraceDefer = 'moving' | 'deforming';

/** Whether the tracer can draw this frame at all. */
export type TraceReadiness = 'inactive' | 'building' | 'ready' | 'unsupported';

export type TraceStatus =
  | 'inactive'
  | 'building'
  | 'deforming'
  | 'moving'
  | 'blending'
  | 'traced'
  | 'unsupported';

export interface TraceStats {
  readonly samples: number;
  readonly accumulating: boolean;
}

export interface FrameStats {
  readonly passes: readonly string[];
  readonly trace: TraceStats;
  readonly cpuMs: number;
}

export type ExportFormat = 'glb' | 'obj' | 'fbx' | 'usd';
