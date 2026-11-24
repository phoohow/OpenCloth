import type {
  AssetAnimation, AssetAppearance, AssetCollision, AssetDisplay, AssetHandle, AssetHit,
  AssetPlayback, AssetPort, AssetRegionPose, AssetSource, Bounds, ExportFormat, Ray, Transform,
} from '@/render/common';

import { meshTrianglesFromObject } from '@/render/backend/assets/avatarMeshCollider';
import {
  applyBodySkin, isSurfaceMesh, SELECTION_OVERLAY_NAME as SELECTION_OVERLAY,
} from '@/render/backend/assets/bodyMaterial';
import { loadModelFromFile, loadModelFromUrl } from '@/render/backend/assets/modelLoader';
import { ProceduralMotionDriver } from '@/render/backend/assets/proceduralMotion';
import { SoftBodyDeformer } from '@/render/backend/assets/softBody';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import * as THREE from 'three/webgpu';

const TRANSLUCENT_OPACITY = 0.35;

const SELECTION_MATERIAL = new THREE.MeshBasicMaterial({
  color: 0xfff3b0, transparent: true, opacity: 0.4, side: THREE.DoubleSide,
  depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
});

class ModelHandle implements AssetHandle {
  revision = 0;
  private readonly softBody = new SoftBodyDeformer();
  private readonly overlays: THREE.Mesh[] = [];
  private mixer: THREE.AnimationMixer | null;
  private action: THREE.AnimationAction | null = null;
  private activeClip = -1;
  private elapsed = 0;
  private playing = false;
  private highlighted = false;
  private disposed = false;
  private appearance: AssetAppearance = {};
  private display: AssetDisplay = 'visible';

  constructor(
    readonly key: string,
    readonly root: THREE.Object3D,
    private readonly clips: readonly THREE.AnimationClip[],
    private readonly motionDriver: ProceduralMotionDriver | null = null,
  ) {
    this.mixer = clips.length > 0 ? new THREE.AnimationMixer(root) : null;
  }

  get bounds(): Bounds {
    const box = new THREE.Box3().setFromObject(this.root);
    if (box.isEmpty()) return { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
    return {
      min: { x: box.min.x, y: box.min.y, z: box.min.z },
      max: { x: box.max.x, y: box.max.y, z: box.max.z },
    };
  }

  pose(transform: Transform): void {
    this.root.position.set(transform.position.x, transform.position.y, transform.position.z);
    this.root.rotation.set(transform.rotationEuler.x, transform.rotationEuler.y, transform.rotationEuler.z);
    this.root.scale.set(transform.scale.x, transform.scale.y, transform.scale.z);
    this.root.updateMatrixWorld(true);
    this.revision += 1;
  }

  setAppearance(appearance: AssetAppearance): void {
    this.appearance = appearance;
    applyBodySkin(this.root, this.appearanceFor(this.display));
    this.revision += 1;
  }

  setDisplay(display: AssetDisplay): void {
    this.display = display;
    this.root.visible = display !== 'hidden';
    applyBodySkin(this.root, this.appearanceFor(display));
    this.revision += 1;
  }

  private appearanceFor(display: AssetDisplay): AssetAppearance {
    return display === 'translucent' ? { ...this.appearance, opacity: TRANSLUCENT_OPACITY } : this.appearance;
  }

  setHighlighted(on: boolean): void {
    if (this.highlighted === on) return;
    this.highlighted = on;
    for (const overlay of this.overlays) overlay.removeFromParent();
    this.overlays.length = 0;
    if (!on) return;
    this.root.traverse(object => {
      if (!isSurfaceMesh(object)) return;
      const overlay = new THREE.Mesh(object.geometry, SELECTION_MATERIAL);
      overlay.name = SELECTION_OVERLAY;
      object.add(overlay);
      this.overlays.push(overlay);
    });
    this.revision += 1;
  }

  animations(): readonly AssetAnimation[] {
    return this.clips.map(clip => ({ name: clip.name, duration: clip.duration }));
  }

  regionPoses(): readonly AssetRegionPose[] {
    return this.motionDriver?.regionPoses() ?? [];
  }

  playback(): AssetPlayback {
    return { clip: this.activeClip, timeSeconds: this.elapsed, playing: this.playing };
  }

  private activate(clip: number, loop: boolean): THREE.AnimationAction | null {
    if (!this.mixer || clip < 0 || clip >= this.clips.length) return null;
    if (!this.action || this.activeClip !== clip) {
      this.action?.stop();
      this.action = this.mixer.clipAction(this.clips[clip]!);
      this.action.reset();
      this.activeClip = clip;
      this.elapsed = 0;
    }

    this.action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    this.action.enabled = true;
    return this.action;
  }

  private touched(): void {
    this.motionDriver?.update();
    this.revision += 1;
  }

  play(clip: number, loop = true): boolean {
    const action = this.activate(clip, loop);
    if (!action) return false;
    if (!loop && action.time >= action.getClip().duration - 1e-6) action.reset();
    this.elapsed = action.time;
    action.play();
    this.playing = true;
    this.touched();
    return true;
  }

  select(clip: number): boolean {
    const action = this.activate(clip, true);
    if (!action || !this.mixer) return false;
    action.play();
    action.time = 0;
    this.mixer.update(0);
    this.elapsed = 0;
    this.playing = false;
    this.touched();
    return true;
  }

  seek(seconds: number): void {
    if (!this.action || !this.mixer) return;
    const duration = Math.max(this.action.getClip().duration, 1e-6);
    const time = Math.min(Math.max(seconds, 0), duration);
    this.action.time = time;
    this.mixer.update(0);
    this.elapsed = time;
    this.touched();
  }

  setPlaying(playing: boolean): void {
    this.playing = playing;
    this.revision += 1;
  }

  advance(dtSeconds: number): boolean {
    if (!this.playing || !this.action || !this.mixer) return false;
    this.mixer.update(dtSeconds);
    this.elapsed = this.action.time;
    this.touched();
    return true;
  }

  raycast(ray: Ray): AssetHit | null {
    const raycaster = new THREE.Raycaster(
      new THREE.Vector3(ray.origin.x, ray.origin.y, ray.origin.z),
      new THREE.Vector3(ray.direction.x, ray.direction.y, ray.direction.z).normalize(),
    );
    this.root.updateMatrixWorld(true);
    const hit = raycaster.intersectObject(this.root, true)[0];
    if (!hit) return null;
    return {
      distance: hit.distance,
      point: { x: hit.point.x, y: hit.point.y, z: hit.point.z },
    };
  }

  collision(): AssetCollision | null {
    const vertices = meshTrianglesFromObject(this.root);
    if (vertices.length === 0) return null;
    const indices = new Uint32Array(vertices.length / 3);
    for (let i = 0; i < indices.length; i++) indices[i] = i;
    return { vertices, indices };
  }

  setSoftBody(enabled: boolean): void {
    this.softBody.setEnabled(enabled);
  }

  deform(positions: Float32Array, contact: Float32Array | null): boolean {
    if (!contact) return false;
    this.softBody.attach(this.root);
    if (this.motionDriver) {
      if (this.motionDriver.pose(this.softBody.dented)) this.softBody.rebase();
    }

    const changed = this.softBody.update(positions, contact);
    if (changed) this.revision += 1;
    return changed;
  }

  restore(): void {
    if (this.softBody.restore()) this.revision += 1;
  }

  async export(format: ExportFormat): Promise<ArrayBuffer> {
    this.root.updateMatrixWorld(true);
    this.motionDriver?.detachProxies();
    try {
      if (format === 'glb') {
        return await new Promise<ArrayBuffer>((resolve, reject) => {
          new GLTFExporter().parse(
            this.root,
            result => resolve(result as ArrayBuffer),
            reject,
            { binary: true },
          );
        });
      }

      if (format === 'obj') {
        return new TextEncoder().encode(new OBJExporter().parse(this.root)).buffer;
      }

      return new ArrayBuffer(0);
    } finally {
      this.motionDriver?.attachProxies(this.root);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.motionDriver?.dispose();
    for (const overlay of this.overlays) overlay.removeFromParent();
    this.overlays.length = 0;
    this.root.removeFromParent();
    const materials = new Set<THREE.Material>();
    const geometries = new Set<THREE.BufferGeometry>();
    this.root.traverse(child => {
      const mesh = child as THREE.Mesh;
      if (mesh.geometry) geometries.add(mesh.geometry);
      if (!mesh.material) return;
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of list) materials.add(material);
    });
    for (const material of materials) material.dispose();
    for (const geometry of geometries) geometry.dispose();
  }
}

export class AssetStore implements AssetPort {
  private readonly assets = new Map<string, ModelHandle>();

  async load(key: string, source: AssetSource): Promise<AssetHandle> {
    this.release(key);
    let root: THREE.Object3D;
    let clips: readonly THREE.AnimationClip[] = [];
    let motionTarget: Float32Array | null = null;
    if (source.kind === 'model') {
      const loaded = source.url
        ? await loadModelFromUrl(source.url, { targetHeight: source.targetHeight })
        : source.data
          ? await loadModelFromFile(new File([source.data], source.fileName ?? `${key}.glb`), {
            targetHeight: source.targetHeight,
          })
          : null;
      if (!loaded) throw new Error(`Asset source for ${key} has no url or bytes`);
      root = loaded.group;
      clips = loaded.animations;
    } else {
      root = new THREE.Group();
      root.name = key;
      for (const entry of source.meshes) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(entry.mesh.streams.position, 3));
        if (entry.mesh.streams.normal) {
          geometry.setAttribute('normal', new THREE.BufferAttribute(entry.mesh.streams.normal, 3));
        }

        if (entry.mesh.streams.uv) {
          geometry.setAttribute('uv', new THREE.BufferAttribute(entry.mesh.streams.uv, 2));
        }

        if (entry.mesh.index) geometry.setIndex(new THREE.BufferAttribute(entry.mesh.index, 1));
        const material = entry.material
          ? new THREE.MeshPhysicalMaterial({
            color: entry.material.color ?? '#e8c4a8',
            roughness: entry.material.roughness ?? 0.62,
            metalness: entry.material.metalness ?? 0,
          })
          : new THREE.MeshStandardMaterial({ color: '#e8c4a8', roughness: 0.62 });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = entry.name;
        if (entry.transform) {
          mesh.position.set(entry.transform.position.x, entry.transform.position.y, entry.transform.position.z);
          mesh.rotation.set(
            entry.transform.rotationEuler.x, entry.transform.rotationEuler.y, entry.transform.rotationEuler.z,
          );
          mesh.scale.set(entry.transform.scale.x, entry.transform.scale.y, entry.transform.scale.z);
        }

        root.add(mesh);
      }

      if (source.motion) {
        const carrier = source.meshes.find(entry => entry.name === source.motionMesh);
        if (!carrier) throw new Error(`Asset source for ${key} names no mesh to carry its motion`);
        motionTarget = carrier.mesh.streams.position;
      }
    }

    const driver = source.kind === 'meshes' && source.motion && motionTarget
      ? new ProceduralMotionDriver(root, motionTarget, source.motion)
      : null;
    const handle = new ModelHandle(key, root, driver ? driver.clips : clips, driver);
    this.assets.set(key, handle);
    return handle;
  }

  handle(key: string): AssetHandle | null {
    return this.assets.get(key) ?? null;
  }

  objectFor(key: string): THREE.Object3D | null {
    return this.assets.get(key)?.root ?? null;
  }

  release(key: string): void {
    const asset = this.assets.get(key);
    if (!asset) return;
    this.assets.delete(key);
    asset.dispose();
  }

  dispose(): void {
    for (const asset of this.assets.values()) asset.dispose();
    this.assets.clear();
  }
}
