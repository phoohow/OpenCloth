/** Opaque model assets and the neutral handles the viewport manipulates. */

import * as THREE from 'three/webgpu';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import type {
  AssetAnimation, AssetAppearance, AssetCollision, AssetDisplay, AssetHandle, AssetHit,
  AssetPlayback, AssetPort, AssetSource, Bounds, ExportFormat, Ray, Transform,
} from '@/render/common';
import { meshTrianglesFromObject } from '@/render/backend/assets/avatarMeshCollider';
import { applyBodySkin } from '@/render/backend/assets/bodyMaterial';
import { SoftBodyDeformer } from '@/render/backend/assets/softBody';
import { loadModelFromFile, loadModelFromUrl } from '@/render/backend/assets/modelLoader';

/** Name of the clone meshes marking a selected asset. */
const SELECTION_OVERLAY = 'avatarSelectionOverlay';

/** Translucent material of the selection clone. */
const SELECTION_MATERIAL = new THREE.MeshBasicMaterial({
  color: 0xfff3b0, transparent: true, opacity: 0.4, side: THREE.DoubleSide,
  depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
});

/** Neutral model asset: imported or procedural geometry with optional motion clips. */
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

  constructor(
    readonly key: string,
    readonly root: THREE.Object3D,
    private readonly clips: readonly THREE.AnimationClip[],
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
    applyBodySkin(this.root, appearance);
    this.revision += 1;
  }

  setDisplay(display: AssetDisplay): void {
    this.root.visible = display !== 'hidden';
    this.root.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || mesh.name === SELECTION_OVERLAY) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        const standard = material as THREE.MeshStandardMaterial;
        standard.transparent = display === 'translucent';
        standard.opacity = display === 'translucent' ? 0.35 : 1;
      }
    });
    this.revision += 1;
  }

  setHighlighted(on: boolean): void {
    if (this.highlighted === on) return;
    this.highlighted = on;
    for (const overlay of this.overlays) overlay.removeFromParent();
    this.overlays.length = 0;
    if (!on) return;
    this.root.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || mesh.name === SELECTION_OVERLAY) return;
      const overlay = new THREE.Mesh(mesh.geometry, SELECTION_MATERIAL);
      overlay.name = SELECTION_OVERLAY;
      overlay.renderOrder = 2;
      mesh.add(overlay);
      this.overlays.push(overlay);
    });
    this.revision += 1;
  }

  animations(): readonly AssetAnimation[] {
    return this.clips.map(clip => ({ name: clip.name, duration: clip.duration }));
  }

  playback(): AssetPlayback {
    return { clip: this.activeClip, timeSeconds: this.elapsed, playing: this.playing };
  }

  play(clip: number, loop = true): boolean {
    if (!this.mixer || clip < 0 || clip >= this.clips.length) return false;
    if (!this.action || this.activeClip !== clip) {
      this.action?.stop();
      const action = this.mixer.clipAction(this.clips[clip]!);
      action.reset();
      action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
      action.enabled = true;
      this.action = action;
      this.activeClip = clip;
      this.elapsed = 0;
    }
    this.action.play();
    this.playing = true;
    this.revision += 1;
    return true;
  }

  seek(seconds: number): void {
    if (!this.action || !this.mixer) return;
    const duration = Math.max(this.action.getClip().duration, 1e-6);
    const time = Math.min(Math.max(seconds, 0), duration);
    this.action.time = time;
    this.mixer.update(0);
    this.elapsed = time;
    this.revision += 1;
  }

  setPlaying(playing: boolean): void {
    this.playing = playing;
    this.revision += 1;
  }

  advance(dtSeconds: number): boolean {
    if (!this.playing || !this.action || !this.mixer) return false;
    this.mixer.update(dtSeconds);
    this.elapsed = this.action.time;
    this.revision += 1;
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

  deform(positions: Float32Array, contact: Float32Array | null): boolean {
    if (!contact) return false;
    this.softBody.attach(this.root);
    const changed = this.softBody.update(positions, contact);
    if (changed) this.revision += 1;
    return changed;
  }

  restore(): void {
    if (this.softBody.restore()) this.revision += 1;
  }

  async export(format: ExportFormat): Promise<ArrayBuffer> {
    this.root.updateMatrixWorld(true);
    if (format === 'glb') {
      return new Promise<ArrayBuffer>((resolve, reject) => {
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
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
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

/** Owns every opaque asset behind a stable key. */
export class AssetStore implements AssetPort {
  private readonly assets = new Map<string, ModelHandle>();

  /** Loads a model file or wraps procedural meshes; failures reject. */
  async load(key: string, source: AssetSource): Promise<AssetHandle> {
    this.release(key);
    let root: THREE.Object3D;
    let clips: readonly THREE.AnimationClip[] = [];
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
    }
    const handle = new ModelHandle(key, root, clips);
    this.assets.set(key, handle);
    return handle;
  }

  handle(key: string): AssetHandle | null {
    return this.assets.get(key) ?? null;
  }

  /** Three object of one asset, for the scene store. */
  objectFor(key: string): THREE.Object3D | null {
    return this.assets.get(key)?.root ?? null;
  }

  release(key: string): void {
    const asset = this.assets.get(key);
    if (!asset) return;
    this.assets.delete(key);
    asset.dispose();
  }

  /** Frees every asset. */
  dispose(): void {
    for (const asset of this.assets.values()) asset.dispose();
    this.assets.clear();
  }
}
