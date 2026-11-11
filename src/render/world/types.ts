/** World records: common data plus the ids and revisions the world assigns. */

import type {
  Bounds, ChannelMask, DrawStage, EntityFilter, EntityId, EntityTag, EnvironmentData, InstanceData,
  LayerId, LightData, MaterialData, MaterialId, MaterialRef, MeshData, MeshGroup, MeshId, MeshRef,
  Ray, RayHit, Transform, VersionStamp,
} from '@/render/common';

export type {
  AssetKey, Bounds, CameraHost, CameraPose, CameraProjection, CameraState, ChannelMask,
  DenoiseModel, DrawBucket, DrawStage, EntityFilter, EntityId, EntityTag,
  EnvironmentData, FillMode, FrameStats, InstanceData, LayerId, LightData, LightId, MaterialData,
  MaterialId, MaterialKind, MaterialMapSlot, MaterialRef, MaterialTechnique, MeshData, MeshGroup,
  MeshId, MeshRef, MeshStreams, MeshTopology, Ray, RayHit, RenderMode, ResolvedMaterial,
  SceneItem, SceneSnapshot, TraceSettings, TraceStats, TraceStatus, ToneMappingMode, Transform,
  VersionStamp, ViewSettings, WireMode, WireOptions, ExportFormat,
} from '@/render/common';
export {
  CHANNEL_ALL, CHANNEL_RASTER, CHANNEL_TRACE,
} from '@/render/common';

/** A drawable entity owned by the world. */
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

/** Geometry record; age is the revision the GPU compares. */
export interface Mesh extends MeshData {
  readonly id: MeshId;
  readonly revision: number;
}

/** Material record; age is the revision the GPU compares. */
export interface Material extends MaterialData {
  readonly id: MaterialId;
  readonly revision: number;
}

/** A light record with the id the world assigned. */
export interface RenderLight extends LightData {
  readonly id: number;
}

export type RenderEnvironment = EnvironmentData;
export type RenderVersions = VersionStamp;
export type MeshDesc = MeshData;
export type MaterialDesc = MaterialData;

/** Fields a new entity is created from; omitted values take layer defaults. */
export interface EntityDesc {
  layer: LayerId;
  tags?: Iterable<EntityTag>;
  transform?: Transform;
  mesh: MeshRef;
  materials?: readonly MaterialRef[];
  channels?: ChannelMask;
  bounds?: Bounds;
}

/** Fields one entity update may replace. */
export interface EntityPatch {
  layer?: LayerId;
  tags?: Iterable<EntityTag>;
  transform?: Transform;
  mesh?: MeshRef;
  materials?: readonly MaterialRef[];
  channels?: ChannelMask;
  bounds?: Bounds;
}

/** Streams a mesh update may replace; omitted streams keep their contents. */
export interface MeshPatch {
  topology?: MeshData['topology'];
  streams?: Partial<MeshData['streams']>;
  index?: Uint32Array;
  groups?: readonly MeshGroup[];
  instances?: InstanceData;
  bounds?: Bounds;
}

/** Material fields an update may replace; `kind` is fixed for the material's lifetime. */
export interface MaterialPatch extends Partial<Omit<MaterialData, 'kind'>> { }

/** A light created without an id. */
export interface LightDesc extends Omit<RenderLight, 'id'> { }

/** Light fields an update may replace. */
export interface LightPatch extends Partial<Omit<RenderLight, 'id'>> { }

/** Environment fields an update may replace. */
export type EnvironmentDesc = Partial<RenderEnvironment>;

/** Whether a layer is drawn before or after tone mapping, traced, picked or exported. */
export interface LayerPolicy {
  readonly stage: DrawStage;
  readonly traceable: boolean;
  readonly pickable: boolean;
  readonly exportable: boolean;
}

/** Writes accepted by the world. */
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
  /** Bumps a version for opaque asset contents the world cannot see. */
  touch(kind: keyof RenderVersions): void;
}

/** Read-only queries over one stable frame of the world. */
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

/** The three narrow ports the viewport and renderer hold. */
export interface WorldPorts {
  readonly writer: WorldWriter;
  readonly view: WorldView;
  readonly versions: Readonly<RenderVersions>;
}
