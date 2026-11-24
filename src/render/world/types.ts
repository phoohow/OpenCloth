import type {
  Bounds, ChannelMask, DrawStage, EntityFilter, EntityId, EntityTag, EnvironmentData, InstanceData,
  LayerId, LightData, MaterialData, MaterialId, MaterialRef, MeshData, MeshGroup, MeshId, MeshRef,
  Ray, RayHit, Transform, VersionStamp,
} from '@/render/common';

export {
  CHANNEL_ALL, CHANNEL_RASTER, CHANNEL_TRACE, type AssetKey, type Bounds, type CameraHost,
  type CameraPose, type CameraProjection, type CameraState, type ChannelMask, type DenoiseModel,
  type DrawBucket, type DrawStage, type EntityFilter, type EntityId, type EntityTag,
  type EnvironmentData, type SurfaceMode, type FrameStats, type InstanceData, type LayerId,
  type LightData, type LightId, type MaterialData, type MaterialId, type MaterialKind,
  type MaterialMapSlot, type MaterialRef, type MaterialTechnique, type MeshData, type MeshGroup,
  type MeshId, type MeshRef, type MeshStreams, type MeshTopology, type Ray, type RayHit,
  type RenderMode, type ResolvedMaterial, type SceneItem, type SceneSnapshot, type TraceSettings,
  type TraceStats, type TraceStatus, type ToneMappingMode, type Transform, type VersionStamp,
  type ViewSettings, type WireMode, type WireOptions, type ExportFormat,
} from '@/render/common';

export interface RenderEntity {
  readonly id: EntityId;
  readonly layer: LayerId;
  readonly tags: ReadonlySet<EntityTag>;
  readonly transform: Transform;
  readonly mesh: MeshRef;
  readonly materials: readonly MaterialRef[];
  readonly channels: ChannelMask;
  readonly bounds: Bounds;
}

export interface Mesh extends MeshData {
  readonly id: MeshId;
  readonly revision: number;
}

export interface Material extends MaterialData {
  readonly id: MaterialId;
  readonly revision: number;
}

export interface RenderLight extends LightData {
  readonly id: number;
}

export type RenderEnvironment = EnvironmentData;

export type RenderVersions = VersionStamp;

export type MeshDesc = MeshData;

export type MaterialDesc = MaterialData;

export interface EntityDesc {
  layer: LayerId;
  tags?: Iterable<EntityTag>;
  transform?: Transform;
  mesh: MeshRef;
  materials?: readonly MaterialRef[];
  channels?: ChannelMask;
  bounds?: Bounds;
}

export interface EntityPatch {
  layer?: LayerId;
  tags?: Iterable<EntityTag>;
  transform?: Transform;
  mesh?: MeshRef;
  materials?: readonly MaterialRef[];
  channels?: ChannelMask;
  bounds?: Bounds;
}

export interface MeshPatch {
  topology?: MeshData['topology'];
  streams?: Partial<MeshData['streams']>;
  index?: Uint32Array;
  groups?: readonly MeshGroup[];
  instances?: InstanceData;
  bounds?: Bounds;
}

export interface MaterialPatch extends Partial<Omit<MaterialData, 'kind'>> { }

export interface LightDesc extends Omit<RenderLight, 'id'> { }

export interface LightPatch extends Partial<Omit<RenderLight, 'id'>> { }

export type EnvironmentDesc = Partial<RenderEnvironment>;

export interface LayerPolicy {
  readonly stage: DrawStage;
  readonly traceable: boolean;
  readonly pickable: boolean;
  readonly exportable: boolean;
}

export interface WorldWriter {
  createMesh(desc: MeshData): MeshId;
  updateMesh(id: MeshId, patch: MeshPatch): void;
  destroyMesh(id: MeshId): void;
  createMaterial(desc: MaterialData): MaterialId;
  updateMaterial(id: MaterialId, patch: MaterialPatch): void;
  destroyMaterial(id: MaterialId): void;
  createEntity(desc: EntityDesc): EntityId;
  updateEntity(id: EntityId, patch: EntityPatch): void;
  destroyEntity(id: EntityId): void;
  addLight(desc: LightDesc): number;
  updateLight(id: number, patch: LightPatch): void;
  removeLight(id: number): void;
  clearLights(): void;
  setEnvironment(desc: EnvironmentDesc): void;
  touch(kind: keyof RenderVersions): void;
}

export interface WorldView {
  entities(filter?: EntityFilter): readonly RenderEntity[];
  entity(id: EntityId): RenderEntity | null;
  mesh(id: MeshId): Mesh | null;
  material(id: MaterialId): Material | null;
  lights(): readonly RenderLight[];
  environment(): RenderEnvironment;
  bounds(filter?: EntityFilter): Bounds;
  raycast(ray: Ray, filter?: EntityFilter): RayHit | null;
}

export interface WorldPorts {
  readonly writer: WorldWriter;
  readonly view: WorldView;
  readonly versions: Readonly<RenderVersions>;
}
