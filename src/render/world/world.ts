/** Render world: entities, meshes, materials, lights and their change counters. */

import { intersectRayTriangle3, readPoint3At } from '@/base/geom';
import { defaultChannels } from '@/render/world/layers';
import type {
  Bounds,
  EntityDesc,
  EntityFilter,
  EntityId,
  EntityPatch,
  EnvironmentDesc,
  LightDesc,
  LightId,
  LightPatch,
  Material,
  MaterialData,
  MaterialId,
  MaterialPatch,
  Mesh,
  MeshDesc,
  MeshId,
  MeshPatch,
  MeshRef,
  RenderEntity,
  RenderEnvironment,
  Ray,
  RayHit,
  RenderLight,
  RenderVersions,
  Transform,
  WorldPorts,
  WorldView,
  WorldWriter,
} from '@/render/world/types';
import { cloneTransform, IDENTITY_TRANSFORM, transformBounds, transformPoint } from '@/render/world/transform';
import { bump, createVersions } from '@/render/world/versions';

/** Bounds used for an opaque asset whose owner did not supply one. */
const FALLBACK_BOUNDS: Bounds = {
  min: { x: -1, y: -1, z: -1 },
  max: { x: 1, y: 1, z: 1 },
};

/** Empty bounds, returned when a query matches nothing. */
const EMPTY_BOUNDS: Bounds = {
  min: { x: 0, y: 0, z: 0 },
  max: { x: 0, y: 0, z: 0 },
};

/** The world's default backdrop: no image, a flat colour. */
const DEFAULT_ENVIRONMENT: RenderEnvironment = {
  background: 'color',
  color: '#2a2a2e',
  textureKey: null,
  intensity: 1,
  url: '',
};

/** Owns render entities, meshes, materials, lights and the environment; every write bumps the matching {@link RenderVersions} counter. */
class WorldStore {
  private readonly entityMap = new Map<EntityId, RenderEntity>();
  private readonly meshMap = new Map<MeshId, Mesh>();
  private readonly materialMap = new Map<MaterialId, Material>();
  private readonly lightMap = new Map<LightId, RenderLight>();
  private environmentValue: RenderEnvironment = { ...DEFAULT_ENVIRONMENT };
  private readonly versionState: RenderVersions = createVersions();
  private nextEntityId = 1;
  private nextMeshId = 1;
  private nextMaterialId = 1;
  private nextLightId = 1;
  private readonly viewValue: WorldView;

  constructor() {
    this.viewValue = {
      entities: filter => this.listEntities(filter),
      entity: id => this.entityMap.get(id) ?? null,
      mesh: id => this.meshMap.get(id) ?? null,
      material: id => this.materialMap.get(id) ?? null,
      lights: () => [...this.lightMap.values()],
      environment: () => this.environmentValue,
      bounds: filter => this.computeBounds(filter),
      raycast: (ray, filter) => this.raycast(ray, filter),
    };
  }

  /** Change counters; consumers keep their own copy and compare. */
  get versions(): Readonly<RenderVersions> {
    return this.versionState;
  }

  /** Read-only queries. */
  get view(): WorldView {
    return this.viewValue;
  }

  /** Mutation surface. */
  writer(): WorldWriter {
    return {
      createMesh: desc => this.createMesh(desc),
      updateMesh: (id, patch) => this.updateMesh(id, patch),
      destroyMesh: id => this.destroyMesh(id),
      createMaterial: desc => this.createMaterial(desc),
      updateMaterial: (id, patch) => this.updateMaterial(id, patch),
      destroyMaterial: id => this.destroyMaterial(id),
      createEntity: desc => this.createEntity(desc),
      updateEntity: (id, patch) => this.updateEntity(id, patch),
      destroyEntity: id => this.destroyEntity(id),
      addLight: desc => this.addLight(desc),
      updateLight: (id, patch) => this.updateLight(id, patch),
      removeLight: id => this.removeLight(id),
      clearLights: () => this.clearLights(),
      setEnvironment: desc => this.setEnvironment(desc),
      touch: kind => bump(this.versionState, kind),
    };
  }

  private createMesh(desc: MeshDesc): MeshId {
    const id = this.nextMeshId++;
    const mesh: Mesh = {
      ...desc,
      id,
      revision: 1,
      bounds: desc.bounds ?? boundsOfPositions(desc.streams.position),
    };
    this.meshMap.set(id, mesh);
    bump(this.versionState, 'topology');
    return id;
  }

  private updateMesh(id: MeshId, patch: MeshPatch): void {
    const current = this.meshMap.get(id);
    if (!current) return;
    const topologyChanged = patch.topology !== undefined || patch.index !== undefined
      || patch.groups !== undefined || patch.instances !== undefined;
    const streamsChanged = patch.streams !== undefined;
    const next: Mesh = {
      ...current,
      ...(patch.topology !== undefined ? { topology: patch.topology } : {}),
      ...(patch.streams ? { streams: { ...current.streams, ...patch.streams } } : {}),
      ...(patch.index !== undefined ? { index: patch.index } : {}),
      ...(patch.groups !== undefined ? { groups: patch.groups } : {}),
      ...(patch.instances !== undefined ? { instances: patch.instances } : {}),
      revision: current.revision + 1,
    };
    const bounds = patch.bounds ?? boundsOfPositions(next.streams.position);
    this.meshMap.set(id, { ...next, bounds });
    if (topologyChanged) bump(this.versionState, 'topology');
    if (streamsChanged) bump(this.versionState, 'geometry');
    this.refreshEntityBounds(id);
  }

  private destroyMesh(id: MeshId): void {
    if (!this.meshMap.delete(id)) return;
    bump(this.versionState, 'topology');
  }

  private createMaterial(desc: MaterialData): MaterialId {
    const id = this.nextMaterialId++;
    this.materialMap.set(id, { ...desc, id, revision: 1 });
    bump(this.versionState, 'material');
    return id;
  }

  private updateMaterial(id: MaterialId, patch: MaterialPatch): void {
    const current = this.materialMap.get(id);
    if (!current) return;
    this.materialMap.set(id, { ...current, ...patch, revision: current.revision + 1 });
    bump(this.versionState, 'material');
  }

  private destroyMaterial(id: MaterialId): void {
    if (!this.materialMap.delete(id)) return;
    bump(this.versionState, 'material');
  }

  private createEntity(desc: EntityDesc): EntityId {
    const id = this.nextEntityId++;
    const transform = cloneTransform(desc.transform ?? IDENTITY_TRANSFORM);
    const entity: RenderEntity = {
      id,
      layer: desc.layer,
      tags: new Set(desc.tags ?? []),
      transform,
      mesh: desc.mesh,
      materials: desc.materials ?? [],
      channels: desc.channels ?? defaultChannels(desc.layer),
      bounds: desc.bounds ?? this.boundsFor(desc.mesh, transform),
    };
    this.entityMap.set(id, entity);
    bump(this.versionState, 'topology');
    bump(this.versionState, 'visibility');
    return id;
  }

  private updateEntity(id: EntityId, patch: EntityPatch): void {
    const current = this.entityMap.get(id);
    if (!current) return;
    const layerChanged = patch.layer !== undefined && patch.layer !== current.layer;
    const tagsChanged = patch.tags !== undefined;
    const channels = patch.channels ?? (layerChanged ? defaultChannels(patch.layer!) : current.channels);
    const channelsChanged = channels !== current.channels;
    const transformChanged = patch.transform !== undefined;
    const meshChanged = patch.mesh !== undefined && !sameMeshRef(patch.mesh, current.mesh);
    const materialsChanged = patch.materials !== undefined;
    const transform = patch.transform ? cloneTransform(patch.transform) : current.transform;
    const mesh = patch.mesh ?? current.mesh;
    const bounds = patch.bounds ?? (transformChanged || meshChanged
      ? this.boundsFor(mesh, transform)
      : current.bounds);
    const boundsChanged = !sameBounds(bounds, current.bounds);
    const next: RenderEntity = {
      ...current,
      layer: patch.layer ?? current.layer,
      tags: tagsChanged ? new Set(patch.tags ?? []) : current.tags,
      transform,
      mesh,
      materials: patch.materials ?? current.materials,
      channels,
      bounds,
    };
    this.entityMap.set(id, next);
    if (transformChanged) bump(this.versionState, 'transform');
    if (meshChanged) bump(this.versionState, 'topology');
    if (materialsChanged) bump(this.versionState, 'material');
    if (layerChanged || tagsChanged || channelsChanged || boundsChanged) {
      bump(this.versionState, 'visibility');
    }
  }

  private destroyEntity(id: EntityId): void {
    if (!this.entityMap.delete(id)) return;
    bump(this.versionState, 'topology');
    bump(this.versionState, 'visibility');
  }

  private addLight(desc: LightDesc): LightId {
    const id = this.nextLightId++;
    this.lightMap.set(id, { ...desc, id });
    bump(this.versionState, 'lights');
    return id;
  }

  private updateLight(id: LightId, patch: LightPatch): void {
    const current = this.lightMap.get(id);
    if (!current) return;
    this.lightMap.set(id, { ...current, ...patch, id });
    bump(this.versionState, 'lights');
  }

  private removeLight(id: LightId): void {
    if (!this.lightMap.delete(id)) return;
    bump(this.versionState, 'lights');
  }

  private clearLights(): void {
    if (this.lightMap.size === 0) return;
    this.lightMap.clear();
    bump(this.versionState, 'lights');
  }

  private setEnvironment(desc: EnvironmentDesc): void {
    this.environmentValue = { ...this.environmentValue, ...desc };
    bump(this.versionState, 'environment');
  }

  private listEntities(filter?: EntityFilter): readonly RenderEntity[] {
    const out: RenderEntity[] = [];
    for (const entity of this.entityMap.values()) {
      if (!matches(entity, filter)) continue;
      out.push(entity);
    }
    return out;
  }

  private computeBounds(filter?: EntityFilter): Bounds {
    let first = true;
    const min = { x: 0, y: 0, z: 0 };
    const max = { x: 0, y: 0, z: 0 };
    for (const entity of this.entityMap.values()) {
      if (!matches(entity, filter)) continue;
      if (first) {
        min.x = entity.bounds.min.x; min.y = entity.bounds.min.y; min.z = entity.bounds.min.z;
        max.x = entity.bounds.max.x; max.y = entity.bounds.max.y; max.z = entity.bounds.max.z;
        first = false;
        continue;
      }
      min.x = Math.min(min.x, entity.bounds.min.x);
      min.y = Math.min(min.y, entity.bounds.min.y);
      min.z = Math.min(min.z, entity.bounds.min.z);
      max.x = Math.max(max.x, entity.bounds.max.x);
      max.y = Math.max(max.y, entity.bounds.max.y);
      max.z = Math.max(max.z, entity.bounds.max.z);
    }
    return first ? { ...EMPTY_BOUNDS } : { min, max };
  }

  private raycast(ray: Ray, filter?: EntityFilter): RayHit | null {
    let best: RayHit | null = null;
    for (const entity of this.entityMap.values()) {
      if (!matches(entity, filter)) continue;
      if (entity.mesh.kind !== 'mesh') continue;
      const mesh = this.meshMap.get(entity.mesh.id);
      if (!mesh || mesh.topology !== 'triangle') continue;
      const positions = mesh.streams.position;
      const index = mesh.index;
      const triangleCount = index ? Math.floor(index.length / 3) : Math.floor(positions.length / 9);
      for (let triangle = 0; triangle < triangleCount; triangle++) {
        const a = triangleIndex(index, triangle * 3);
        const b = triangleIndex(index, triangle * 3 + 1);
        const c = triangleIndex(index, triangle * 3 + 2);
        const p0 = transformPoint(readPoint3At(positions, a), entity.transform);
        const p1 = transformPoint(readPoint3At(positions, b), entity.transform);
        const p2 = transformPoint(readPoint3At(positions, c), entity.transform);
        const hit = intersectRayTriangle3(ray.origin, ray.direction, p0, p1, p2);
        if (!hit) continue;
        if (best && hit.distance >= best.distance) continue;
        best = {
          entity: entity.id,
          triangle,
          distance: hit.distance,
          point: {
            x: ray.origin.x + ray.direction.x * hit.distance,
            y: ray.origin.y + ray.direction.y * hit.distance,
            z: ray.origin.z + ray.direction.z * hit.distance,
          },
          barycentric: [1 - hit.u - hit.v, hit.u, hit.v] as const,
        };
      }
    }
    return best;
  }

  private boundsFor(mesh: MeshRef, transform: Transform): Bounds {
    if (mesh.kind === 'asset') return { ...FALLBACK_BOUNDS };
    const record = this.meshMap.get(mesh.id);
    if (!record) return { ...EMPTY_BOUNDS };
    return transformBounds(record.bounds ?? boundsOfPositions(record.streams.position), transform);
  }

  /** Recomputes the bounds of every entity that references this mesh. */
  private refreshEntityBounds(meshId: MeshId): void {
    let changed = false;
    for (const [id, entity] of this.entityMap) {
      if (entity.mesh.kind !== 'mesh' || entity.mesh.id !== meshId) continue;
      const bounds = this.boundsFor(entity.mesh, entity.transform);
      if (sameBounds(bounds, entity.bounds)) continue;
      this.entityMap.set(id, { ...entity, bounds });
      changed = true;
    }
    if (changed) bump(this.versionState, 'visibility');
  }
}

/** Creates a render world and its write/read ports. */
export function createRenderWorld(): WorldPorts {
  const store = new WorldStore();
  return {
    writer: store.writer(),
    view: store.view,
    versions: store.versions,
  };
}

/** Whether an entity passes a query filter. */
function matches(entity: RenderEntity, filter?: EntityFilter): boolean {
  if (!filter) return true;
  if (filter.layers && !filter.layers.includes(entity.layer)) return false;
  if (filter.channels !== undefined && (entity.channels & filter.channels) === 0) return false;
  if (filter.tags && !filter.tags.every(tag => entity.tags.has(tag))) return false;
  return true;
}

/** Bounds of a flat xyz buffer. */
function boundsOfPositions(positions: Float32Array): Bounds {
  if (positions.length < 3) return { ...EMPTY_BOUNDS };
  const min = { x: positions[0]!, y: positions[1]!, z: positions[2]! };
  const max = { x: positions[0]!, y: positions[1]!, z: positions[2]! };
  for (let i = 3; i + 2 < positions.length; i += 3) {
    const x = positions[i]!;
    const y = positions[i + 1]!;
    const z = positions[i + 2]!;
    min.x = Math.min(min.x, x); min.y = Math.min(min.y, y); min.z = Math.min(min.z, z);
    max.x = Math.max(max.x, x); max.y = Math.max(max.y, y); max.z = Math.max(max.z, z);
  }
  return { min, max };
}

/** Whether two mesh references point at the same resource. */
function sameMeshRef(a: MeshRef, b: MeshRef): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind === 'mesh'
    ? a.id === (b as { id: MeshId }).id
    : a.key === (b as { key: string }).key;
}

/** Whether two bounds are equal within an exact comparison; edits are discrete. */
function sameBounds(a: Bounds, b: Bounds): boolean {
  return a.min.x === b.min.x && a.min.y === b.min.y && a.min.z === b.min.z
    && a.max.x === b.max.x && a.max.y === b.max.y && a.max.z === b.max.z;
}

/** Vertex index of one triangle corner. */
function triangleIndex(index: Uint32Array | undefined, offset: number): number {
  return index ? index[offset] ?? 0 : offset;
}
