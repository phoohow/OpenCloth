import type { Vec3 } from '@/base/math';

export const CHANNEL_RASTER = 1;

export const CHANNEL_TRACE = 2;

export const CHANNEL_ALL = CHANNEL_RASTER | CHANNEL_TRACE;

export type EntityId = number;

export type MeshId = number;

export type MaterialId = number;

export type LightId = number;

export type AssetKey = string;

export interface FrameSize {
  readonly width: number;
  readonly height: number;
  readonly traceWidth: number;
  readonly traceHeight: number;
}

export interface Bounds {
  readonly min: Vec3;
  readonly max: Vec3;
}

export interface Transform {
  position: Vec3;
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
  readonly position: Float32Array;
  readonly normal?: Float32Array;
  readonly uv?: Float32Array;
  readonly color?: Float32Array;
  readonly field?: Float32Array;
}

export interface MeshGroup {
  start: number;
  count: number;
  materialSlot: number;
}

export interface InstanceData {
  matrices: Float32Array;
  colors?: Float32Array;
  count: number;
}

export interface MeshData {
  readonly topology: MeshTopology;
  readonly streams: MeshStreams;
  readonly index?: Uint32Array;
  readonly groups?: readonly MeshGroup[];
  readonly instances?: InstanceData;
  readonly bounds?: Bounds;
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
  maps?: Partial<Record<MaterialMapSlot, string>>;
  uvTiling?: { x: number; y: number };
  uvOffset?: { x: number; y: number };
  blending?: BlendMode;
  depth?: DepthMode;
  depthWrite?: boolean;
  side?: SideMode;
  wireframe?: boolean;
  polygonOffset?: { factor: number; units: number };
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

export type ChannelMask = number;

export interface EntityFilter {
  readonly layers?: readonly LayerId[];
  readonly channels?: ChannelMask;
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

export type SurfaceMode = 'material' | 'uv' | 'normal';

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
  readonly fill: SurfaceMode;
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
  readonly revision?: number;
  readonly diagnostic?: SurfaceMode;
}

export type MaterialRef =
  | { readonly kind: 'material'; readonly id: MaterialId }
  | { readonly kind: 'asset'; readonly key: AssetKey; readonly slot: number };

export type MeshRef =
  | { readonly kind: 'mesh'; readonly id: MeshId }
  | { readonly kind: 'asset'; readonly key: AssetKey };

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

export type TraceDefer = 'moving' | 'deforming';

export type TraceReadiness = 'inactive' | 'building' | 'ready' | 'unsupported';

export type TraceStatus =
  | 'inactive'
  | 'building'
  | 'deforming'
  | 'moving'
  | 'blending'
  | 'tracing'
  | 'finished'
  | 'unsupported';

export interface TraceStats {
  readonly samples: number;
  readonly accumulating: boolean;
}

export interface FrameStats {
  readonly passes: readonly string[];
  readonly trace: TraceStats;
  readonly denoiseCount: number;
  readonly cpuMs: number;
}

export type ExportFormat = 'glb' | 'obj' | 'fbx' | 'usd';
