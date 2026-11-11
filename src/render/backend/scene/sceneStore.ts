/** Caches two GPU scene roots (raster and trace) built from one pure-data snapshot. */

import * as THREE from 'three/webgpu';
import { degToRad } from '@/base/math';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type {
  AssetKey, DrawStage, EntityId, InstanceData, LightData, MeshData, MeshId, ResolvedMaterial,
  SceneItem, SceneMesh, SceneSnapshot, Transform,
} from '@/render/common';
import type { SceneHandle } from '@/render/backend/types';
import { GeometryCache } from '@/render/backend/scene/geometryCache';
import { MaterialCompiler } from '@/render/backend/scene/materialCompiler';
import { disposeDiagnosticMaterials } from '@/render/backend/scene/diagnostics';
import type { TextureCache } from '@/render/backend/textures';

/** The object source the scene store reads asset objects from. */
export interface AssetObjects {
  objectFor(key: AssetKey): THREE.Object3D | null;
}

interface RasterEntry {
  readonly root: THREE.Object3D;
  stage: DrawStage;
  wire: THREE.Mesh | null;
  meshId: MeshId | null;
  assetKey: AssetKey | null;
  instanceCount: number;
}

interface TraceEntry {
  readonly root: THREE.Object3D;
  meshId: MeshId | null;
  assetKey: AssetKey | null;
  instanceCount: number;
  source: THREE.Object3D | null;
}

/** Owns the raster, trace and wire scenes and their shared geometry/material caches. */
export class SceneStore {
  private readonly rasterScene = new THREE.Scene();
  private readonly sceneGroup = new THREE.Group();
  private readonly postToneGroup = new THREE.Group();
  private readonly gizmoGroup = new THREE.Group();
  private readonly traceScene = new THREE.Scene();
  private readonly traceGroup = new THREE.Group();
  /** The wire overlay is unlit, so its root carries no lights and no background. */
  private readonly wireScene = new THREE.Scene();
  private readonly wireGroup = new THREE.Group();
  private readonly lights: THREE.Group[] = [new THREE.Group(), new THREE.Group()];
  private readonly ambients = [
    new THREE.AmbientLight(0xffffff, 0.15),
    new THREE.AmbientLight(0xffffff, 0.15),
  ];
  private readonly rasterEntries = new Map<EntityId, RasterEntry>();
  private readonly traceEntries = new Map<EntityId, TraceEntry>();
  private readonly meshMap = new Map<MeshId, SceneMesh>();
  private readonly geometries = new GeometryCache();
  private readonly materials = new MaterialCompiler();
  private rasterHandle: SceneHandle;
  private traceHandle: SceneHandle;
  private wireHandle: SceneHandle;
  private revision = 0;
  private lastLights = -1;
  private lastEnvironment = -1;
  private lastTextureVersion = -1;
  /** Backdrop of the scene stage; overlay stages render with no background. */
  private background: THREE.Texture | THREE.Color | null = null;

  constructor(private readonly assets: AssetObjects, private readonly textures: TextureCache) {
    this.sceneGroup.name = 'stage:scene';
    this.postToneGroup.name = 'stage:postTone';
    this.gizmoGroup.name = 'stage:gizmo';
    this.rasterScene.add(this.sceneGroup, this.postToneGroup, this.gizmoGroup, this.lights[0]!);
    this.rasterScene.add(this.ambients[0]!);
    this.traceGroup.name = 'traceRoot';
    this.traceScene.add(this.traceGroup, this.lights[1]!);
    this.traceScene.add(this.ambients[1]!);
    this.wireGroup.name = 'wireRoot';
    this.wireScene.add(this.wireGroup);
    this.rasterHandle = {
      id: 'raster', revision: 0, geometryRevision: 0, materialRevision: 0, stage: 'scene',
    };
    this.traceHandle = {
      id: 'trace', revision: 0, geometryRevision: 0, materialRevision: 0, stage: 'scene',
    };
    // The wire root has a single group; its stage only records that it draws over the tone curve.
    this.wireHandle = {
      id: 'wire', revision: 0, geometryRevision: 0, materialRevision: 0, stage: 'postTone',
    };
  }

  get raster(): SceneHandle {
    return this.rasterHandle;
  }

  get trace(): SceneHandle {
    return this.traceHandle;
  }

  get wire(): SceneHandle {
    return this.wireHandle;
  }

  /** Whether any entity draws a wire overlay; the wire pass then has something to put down. */
  get hasWire(): boolean {
    return this.wireGroup.children.length > 0;
  }

  /** Whether raster items exist in the display-space stage. */
  hasStage(stage: DrawStage): boolean {
    return this.group(stage).children.length > 0;
  }

  /** Applies one snapshot to every root and returns what changed. */
  apply(snapshot: SceneSnapshot): void {
    this.meshMap.clear();
    for (const mesh of snapshot.meshes) this.meshMap.set(mesh.id, mesh);
    this.syncLights(snapshot);
    this.syncEnvironment(snapshot);
    const seenRaster = new Set<EntityId>();
    const seenTrace = new Set<EntityId>();
    for (const item of snapshot.items) {
      seenRaster.add(item.key);
      this.syncRaster(item);
      if (item.traceMaterials.length > 0) {
        seenTrace.add(item.key);
        this.syncTrace(item);
      }
    }
    for (const [id, entry] of this.rasterEntries) {
      if (seenRaster.has(id)) continue;
      this.removeRaster(entry);
      this.rasterEntries.delete(id);
    }
    for (const [id, entry] of this.traceEntries) {
      if (seenTrace.has(id)) continue;
      this.removeTrace(entry);
      this.traceEntries.delete(id);
    }
    this.revision += 1;
    this.rasterHandle = {
      id: 'raster',
      revision: this.revision,
      geometryRevision: snapshot.versions.geometry,
      materialRevision: snapshot.versions.material,
      stage: 'scene',
    };
    this.traceHandle = {
      id: 'trace',
      revision: this.revision,
      geometryRevision: snapshot.versions.geometry,
      materialRevision: snapshot.versions.material,
      stage: 'scene',
    };
    this.wireHandle = {
      id: 'wire',
      revision: this.revision,
      geometryRevision: snapshot.versions.geometry,
      materialRevision: snapshot.versions.material,
      stage: 'postTone',
    };
  }

  /** Three root for one stage of a scene handle. */
  sceneFor(handle: SceneHandle, stage: DrawStage): THREE.Scene {
    if (handle.id === 'trace') {
      this.traceGroup.visible = true;
      return this.traceScene;
    }
    // The wire root holds one group and draws over a finished frame, so it has no stages.
    if (handle.id === 'wire') return this.wireScene;
    this.sceneGroup.visible = stage === 'scene';
    this.postToneGroup.visible = stage === 'postTone';
    this.gizmoGroup.visible = stage === 'gizmo';
    // Overlay stages draw over the composed image without the scene backdrop.
    this.rasterScene.background = stage === 'scene' ? this.background : null;
    return this.rasterScene;
  }

  /** Three scene the denoiser rasterizes auxiliary guides from. */
  get traceSceneRoot(): THREE.Scene {
    return this.traceScene;
  }

  dispose(): void {
    for (const entry of this.rasterEntries.values()) this.removeRaster(entry);
    for (const entry of this.traceEntries.values()) this.removeTrace(entry);
    this.rasterEntries.clear();
    this.traceEntries.clear();
    this.geometries.dispose();
    this.materials.dispose();
    for (const group of this.lights) clearLights(group);
    for (const ambient of this.ambients) ambient.dispose();
    disposeDiagnosticMaterials();
  }

  private syncRaster(item: SceneItem): void {
    const existing = this.rasterEntries.get(item.key);
    if (item.rasterMaterials.length === 0 && item.wire === null) {
      if (existing) {
        this.removeRaster(existing);
        this.rasterEntries.delete(item.key);
      }
      return;
    }
    if (item.mesh.kind === 'asset') {
      const source = this.assets.objectFor(item.mesh.key);
      if (!source) return;
      let entry = existing;
      if (!entry || entry.assetKey !== item.mesh.key) {
        if (entry) this.removeRaster(entry);
        entry = {
          root: source, stage: item.rasterStage, wire: null, meshId: null,
          assetKey: item.mesh.key, instanceCount: 0,
        };
        this.rasterEntries.set(item.key, entry);
        this.group(item.rasterStage).add(entry.root);
      }
      this.selectStage(entry, item.rasterStage);
      entry.root.visible = item.rasterMaterials.length > 0 || item.wire !== null;
      return;
    }
    const mesh = this.meshData(item.mesh.id);
    if (!mesh) return;
    const geometry = this.geometries.get(mesh);
    const instanceCount = mesh.instances?.count ?? 0;
    let entry = existing;
    if (!entry || entry.meshId !== mesh.id || entry.instanceCount !== instanceCount) {
      if (entry) this.removeRaster(entry);
      entry = {
        root: createObject(mesh.topology, geometry, instanceCount), stage: item.rasterStage,
        wire: null, meshId: mesh.id, assetKey: null, instanceCount,
      };
      this.rasterEntries.set(item.key, entry);
      this.group(item.rasterStage).add(entry.root);
    }
    const root = entry.root as THREE.Mesh;
    root.geometry = geometry;
    if (root instanceof THREE.InstancedMesh && mesh.instances) copyInstances(root, mesh.instances);
    root.material = this.materialList(item.rasterMaterials);
    // Wire-only frames leave the shaded root in place but not drawn.
    root.visible = item.rasterMaterials.length > 0 || item.wire === null;
    this.syncWire(entry, item);
    this.selectStage(entry, item.rasterStage);
    applyTransform(root, item.transform, item.key);
  }

  private syncTrace(item: SceneItem): void {
    const existing = this.traceEntries.get(item.key);
    if (item.traceMaterials.length === 0) {
      if (existing) {
        this.removeTrace(existing);
        this.traceEntries.delete(item.key);
      }
      return;
    }
    if (item.mesh.kind === 'asset') {
      const source = this.assets.objectFor(item.mesh.key);
      if (!source) return;
      let entry = existing;
      if (!entry || entry.assetKey !== item.mesh.key) {
        if (entry) this.removeTrace(entry);
        const root = cloneSkeleton(source);
        entry = { root, meshId: null, assetKey: item.mesh.key, instanceCount: 0, source };
        this.traceEntries.set(item.key, entry);
        this.traceGroup.add(root);
      }
      entry.root.matrixAutoUpdate = false;
      entry.root.matrix.copy(source.matrixWorld);
      entry.root.matrixWorldNeedsUpdate = true;
      entry.root.visible = source.visible;
      return;
    }
    const mesh = this.meshData(item.mesh.id);
    if (!mesh) return;
    const geometry = this.geometries.get(mesh);
    const instanceCount = mesh.instances?.count ?? 0;
    let entry = existing;
    if (!entry || entry.meshId !== mesh.id || entry.instanceCount !== instanceCount) {
      if (entry) this.removeTrace(entry);
      entry = {
        root: createObject(mesh.topology, geometry, instanceCount), meshId: mesh.id,
        assetKey: null, instanceCount, source: null,
      };
      this.traceEntries.set(item.key, entry);
      this.traceGroup.add(entry.root);
    }
    const root = entry.root as THREE.Mesh;
    root.geometry = geometry;
    if (root instanceof THREE.InstancedMesh && mesh.instances) copyInstances(root, mesh.instances);
    root.material = this.materialList(item.traceMaterials);
    applyTransform(root, item.transform, item.key);
  }

  private materialList(variants: readonly ResolvedMaterial[]): THREE.Material | THREE.Material[] {
    const materials = variants
      .filter(variant => variant.technique !== 'asset')
      .map(variant => this.materials.get(variant, this.textures));
    const list = materials.length > 0 ? materials : [this.materials.defaultMaterial()];
    return list.length === 1 ? list[0]! : list;
  }

  private syncWire(entry: RasterEntry, item: SceneItem): void {
    if (item.wire) {
      const wire = entry.wire ?? new THREE.Mesh((entry.root as THREE.Mesh).geometry);
      wire.geometry = (entry.root as THREE.Mesh).geometry;
      wire.material = this.materials.get(item.wire, this.textures);
      wire.renderOrder = 1;
      wire.frustumCulled = false;
      // The wire stands beside the root in the overlay group, so it carries its own pose.
      applyTransform(wire, item.transform, item.key);
      wire.name = `wire:${item.key}`;
      if (entry.wire) return;
      entry.wire = wire;
      // A wire is a guide rather than shading, so it has its own root and is drawn past the tone
      // curve in either pipeline: a traced frame replaces the raster image, and both then show one
      // wire colour.
      this.wireGroup.add(wire);
    } else if (entry.wire) {
      this.wireGroup.remove(entry.wire);
      entry.wire = null;
    }
  }

  private selectStage(entry: RasterEntry, stage: DrawStage): void {
    if (entry.stage === stage) return;
    this.group(entry.stage).remove(entry.root);
    entry.stage = stage;
    this.group(stage).add(entry.root);
  }

  private syncLights(snapshot: SceneSnapshot): void {
    if (snapshot.versions.lights === this.lastLights) return;
    this.lastLights = snapshot.versions.lights;
    for (const group of this.lights) clearLights(group);
    for (let i = 0; i < this.lights.length; i++) {
      for (const light of snapshot.lights) buildLight(light, this.lights[i]!);
    }
  }

  private syncEnvironment(snapshot: SceneSnapshot): void {
    if (snapshot.versions.environment === this.lastEnvironment
      && this.textures.version === this.lastTextureVersion) return;
    this.lastEnvironment = snapshot.versions.environment;
    this.lastTextureVersion = this.textures.version;
    const environment = snapshot.environment;
    const texture = environment.background === 'texture' && environment.textureKey
      ? this.textures.get(environment.textureKey)
      : null;
    this.background = environment.background === 'none'
      ? null
      : texture ?? new THREE.Color(environment.color);
    this.traceScene.background = this.background;
    this.rasterScene.background = this.sceneGroup.visible ? this.background : null;
    for (const scene of [this.rasterScene, this.traceScene]) {
      scene.environment = texture;
      scene.environmentIntensity = environment.intensity;
    }
    for (const ambient of this.ambients) ambient.intensity = environment.intensity * 0.15;
  }

  private group(stage: DrawStage): THREE.Group {
    if (stage === 'scene') return this.sceneGroup;
    if (stage === 'postTone') return this.postToneGroup;
    return this.gizmoGroup;
  }

  private meshData(id: MeshId): SceneMesh | null {
    return this.meshMap.get(id) ?? null;
  }

  private removeRaster(entry: RasterEntry): void {
    this.group(entry.stage).remove(entry.root);
    if (entry.wire) this.wireGroup.remove(entry.wire);
  }

  private removeTrace(entry: TraceEntry): void {
    this.traceGroup.remove(entry.root);
  }
}

/** Three object matching a topology and an instance count. */
function createObject(
  topology: MeshData['topology'], geometry: THREE.BufferGeometry, instances = 0,
): THREE.Object3D {
  const object = instances > 0 && topology === 'triangle'
    ? new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial(), Math.max(1, instances))
    : topology === 'line'
      ? new THREE.LineSegments(geometry)
      : topology === 'point' ? new THREE.Points(geometry) : new THREE.Mesh(geometry);
  object.frustumCulled = false;
  return object;
}

/** Copies instance matrices and colours into the instanced object's own buffers. */
function copyInstances(mesh: THREE.InstancedMesh, instances: InstanceData): void {
  (mesh.instanceMatrix.array as Float32Array).set(instances.matrices);
  mesh.instanceMatrix.needsUpdate = true;
  if (!instances.colors) return;
  const attribute = mesh.instanceColor
    ?? new THREE.InstancedBufferAttribute(new Float32Array(instances.count * 3), 3);
  (attribute.array as Float32Array).set(instances.colors);
  attribute.needsUpdate = true;
  mesh.instanceColor = attribute;
}

/** Applies the entity transform and tags the root for export and inspection. */
function applyTransform(root: THREE.Object3D, transform: Transform, key: EntityId): void {
  root.position.set(transform.position.x, transform.position.y, transform.position.z);
  root.rotation.set(transform.rotationEuler.x, transform.rotationEuler.y, transform.rotationEuler.z);
  root.scale.set(transform.scale.x, transform.scale.y, transform.scale.z);
  root.name = `entity:${key}`;
}

/** Builds one three light from contract data. */
function buildLight(light: LightData, group: THREE.Group): void {
  const color = new THREE.Color(light.color);
  const position = new THREE.Vector3(light.position.x, light.position.y, light.position.z);
  const target = new THREE.Vector3(light.target.x, light.target.y, light.target.z);
  let object: THREE.Light;
  switch (light.type) {
    case 'directional': {
      const directional = new THREE.DirectionalLight(color, light.intensity);
      directional.position.copy(position);
      directional.target.position.copy(target);
      group.add(directional.target);
      object = directional;
      break;
    }
    case 'point':
      object = new THREE.PointLight(color, light.intensity, light.distance, 2);
      object.position.copy(position);
      break;
    case 'spot': {
      const spot = new THREE.SpotLight(
        color, light.intensity, light.distance,
        degToRad(light.coneAngleDeg), light.penumbra, 2,
      );
      spot.position.copy(position);
      spot.target.position.copy(target);
      group.add(spot.target);
      object = spot;
      break;
    }
    case 'area': {
      const area = new THREE.RectAreaLight(color, light.intensity, light.width, light.height);
      area.position.copy(position);
      area.lookAt(target);
      object = area;
      break;
    }
  }
  object.name = light.name;
  object.visible = light.enabled;
  group.add(object);
}

/** Removes and frees every light in a group. */
function clearLights(group: THREE.Group): void {
  for (const child of [...group.children]) {
    group.remove(child);
    (child as THREE.Light).dispose?.();
  }
}
