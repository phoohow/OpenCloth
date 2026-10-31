import * as THREE from 'three/webgpu';
import { texture, uniform, uv } from 'three/tsl';
import { OIDNDenoiser, WebGPUPathTracer } from 'three-gpu-pathtracer/webgpu';
import { normalizeRayTracing } from '../../core/model/defaults';
import { bundledAssetUrl } from '../../core/assets/bundledAssetUrls';
import type { DenoiseModel, RayTracingConfig } from '../../core/model/types';
import { useUIStore } from '../../store/uiStore';

type PathTracingMaterial = THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial;
type GeometryWithBVH = THREE.BufferGeometry & { boundsTree?: { refit(): void } };
type InitUNetFromURL = (
  url: string,
  params: { device: GPUDevice },
  options: { aux?: boolean; hdr?: boolean; maxTileSize?: number | null; dynamicTile?: unknown },
) => Promise<unknown>;

interface SceneState {
  topologyKey: string;
  materialKey: string;
  transformKey: string;
}

// Weight files live in assets/weights and reach the site root through publicDir.
const OIDN_WEIGHTS_BASE = '/weights';
const OIDN_WEIGHTS = {
  'small': `${OIDN_WEIGHTS_BASE}/rt_hdr_alb_nrm_small.tza`,
  'base': `${OIDN_WEIGHTS_BASE}/rt_hdr_alb_nrm.tza`,
};
const OIDN_COLOR_WEIGHTS = `${OIDN_WEIGHTS_BASE}/rt_hdr.tza`;

/** Topology key no real scene can produce; marks that the viewport camera object changed. */
const CAMERA_SWAP_KEY = '|camera-swap|';

/** Minimum milliseconds between two readbacks of the per-pixel sample count. */
const SAMPLE_READBACK_MS = 250;

/** Per-frame camera drift under this matrix distance ends the interaction burst. */
const VIEW_SETTLE_TOLERANCE = 1e-4;

/** Per-frame camera drift over this matrix distance hands the view back to rasterization. */
const VIEW_MOVE_TOLERANCE = 2e-3;

/** Drift from the accumulated camera over this matrix distance restarts the sample pass. */
const CAMERA_RESTART_TOLERANCE = 2e-3;

/** Samples a pass must reach before the path-traced image stands alone without the raster base. */
const RASTER_BLEND_SAMPLES = 32;

/** Readback interval while a pass is still blending in, so the ramp stays smooth. */
const BLEND_READBACK_MS = 60;

/** Why the last drawn frame showed rasterization instead of the traced image. */
export type RayTraceDefer = 'deforming' | 'moving';

/** Progressive WebGPU path tracing for the meshes and lights in the existing scene. */
export class RayTracingRenderer {
  private readonly renderer: THREE.WebGPURenderer;
  private readonly tracer: WebGPUPathTracer;
  private readonly indexAttributes = new WeakMap<THREE.BufferGeometry, THREE.BufferAttribute | null>();
  private readonly denoisers = new Map<DenoiseModel, OIDNDenoiser>();
  private readonly denoiserLoading = new Map<DenoiseModel, Promise<OIDNDenoiser>>();
  private readonly drawingSize = new THREE.Vector2();
  private readonly tracerSize = new THREE.Vector2();
  private activeDenoiser: OIDNDenoiser | null = null;
  /** Model whose weights failed to load; clearing the denoise switch allows another attempt. */
  private failedDenoiseModel: DenoiseModel | null = null;
  private topologyKey = '';
  private materialKey = '';
  private transformKey = '';
  /** Camera matrices the tracer holds, or null when it never captured one. */
  private syncedCameraValues: number[] | null = null;
  /** Camera matrices read on the previous frame, for motion detection. */
  private lastCameraValues: number[] | null = null;
  private lightsDirty = false;
  private environmentDirty = false;
  private viewSignature = '';
  /** Whether the view is being manipulated; the viewport rasterizes while it is. */
  private viewMoving = false;
  /** Gate that held the last rendered frame on rasterization; null when the traced image was shown. */
  private lastDefer: RayTraceDefer | null = null;
  private frameBudget = 0;
  private measuredSamples = 0;
  private sampleGeneration = 0;
  private lastSampleReadback = Number.NEGATIVE_INFINITY;
  /** Raster view of the current frame, laid under the young path-traced samples. */
  private readonly blendTarget: THREE.RenderTarget;
  private readonly blendScene = new THREE.Scene();
  private readonly blendCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
  private readonly blendMesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicNodeMaterial>;
  private readonly blendAlpha: { value: number };
  private blendWeight = 0;
  private disposed = false;

  /** Whether dispose() has run; late async work checks this before touching the device. */
  get isDisposed(): boolean {
    return this.disposed;
  }

  constructor(renderer: THREE.WebGPURenderer, config: RayTracingConfig) {
    this.renderer = renderer;
    this.tracer = new WebGPUPathTracer(renderer);
    this.blendTarget = new THREE.RenderTarget(1, 1, { type: THREE.HalfFloatType });
    this.blendAlpha = uniform(0) as unknown as { value: number };
    const blendMaterial = new THREE.MeshBasicNodeMaterial({ transparent: true, depthTest: false, depthWrite: false });
    // A render target keeps row 0 at the top on WebGPU, so the quad samples it with v flipped.
    blendMaterial.colorNode = texture(this.blendTarget.texture, uv().flipY());
    blendMaterial.opacityNode = this.blendAlpha as never;
    this.blendMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blendMaterial);
    this.blendMesh.frustumCulled = false;
    this.blendScene.add(this.blendMesh);
    this.blendCamera.position.z = 1;
    // The drawing buffer includes the device pixel ratio, which would need four times the paths
    // for the same picture; the tracer is sized from the drawing area in CSS pixels instead.
    this.tracer.synchronizeRenderSize = false;
    // Unreachable low resolution preview: it would call setSize(), which discards the samples
    // accumulated so far. minSamples 0 and a zero fade also keep the full-res image drawn at full
    // opacity from the first frame instead of fading in over the clear color.
    this.tracer.renderDelay = 0;
    this.tracer.minSamples = 0;
    this.tracer.fadeDuration = 0;
    this.applyTracerSettings(normalizeRayTracing(config));
  }

  /** Re-collects punctual lights before the next sample. */
  invalidateLights(): void {
    this.lightsDirty = true;
  }

  /** Re-reads the environment texture and intensity before the next sample. */
  invalidateEnvironment(): void {
    this.environmentDirty = true;
  }

  /** Samples accumulated per pixel in the path-traced image; 0 while the view is in motion. */
  get sampleCount(): number {
    const limit = this.tracer.maxSamples;
    return limit > 0 ? Math.min(this.measuredSamples, limit) : this.measuredSamples;
  }

  /** Whether the pass is still adding samples, false once its sample budget is filled. */
  get isAccumulating(): boolean {
    return this.sampleCount < this.tracer.maxSamples;
  }

  /** Gate that kept the last `render` call from showing the traced image. */
  get deferReason(): RayTraceDefer | null {
    return this.lastDefer;
  }

  /** Whether the traced image is still laid under the raster frame it fades up from. */
  get isBlending(): boolean {
    return this.blendWeight < 1;
  }

  /** Averages the per-pixel sample counts straight from the tracer, bypassing the throttled readback. */
  async measureSampleAverage(): Promise<number> {
    if (this.disposed) return 0;
    const counts = await this.tracer.getSampleCountsAsync();
    return counts.avg;
  }

  /** Applies project settings, loading OIDN weights lazily when denoising turns on. */
  async setConfig(config: RayTracingConfig): Promise<void> {
    if (this.disposed) return;
    const normalized = normalizeRayTracing(config);
    this.applyTracerSettings(normalized);
    if (!normalized.denoise) this.failedDenoiseModel = null;
    if (normalized.denoise && this.failedDenoiseModel !== normalized.denoiseModel) {
      const denoiser = await this.ensureDenoiser(normalized.denoiseModel);
      if (!this.disposed && denoiser && this.activeDenoiser !== denoiser) {
        this.tracer.setDenoiser(denoiser);
        this.activeDenoiser = denoiser;
      }
    } else {
      this.tracer.setDenoiser(null);
      this.activeDenoiser = null;
    }
    this.tracer.reset();
    this.restartSampling();
  }

  /**
   * Synchronizes scene changes and advances the progressive render by one GPU step.
   * @returns whether the canvas shows the path-traced image; `false` while the view is being
   *   manipulated, when the caller draws the raster frame instead.
   */
  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera | THREE.OrthographicCamera): boolean {
    if (this.disposed) return false;
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld();

    this.rebindCamera(camera);
    this.syncRenderSize();

    const now = performance.now();
    const state = readSceneState(scene);
    const cameraValues = readCameraValues(camera);
    const signature = `${state.topologyKey}|${state.materialKey}|${state.transformKey}`;
    const sceneChanged = signature !== this.viewSignature;
    const frameDrift = cameraDistance(this.lastCameraValues, cameraValues);
    this.viewSignature = signature;
    this.lastCameraValues = cameraValues;
    // Two thresholds keep the orbit damping from alternating between the pipelines every frame.
    this.viewMoving = sceneChanged ||
      frameDrift > (this.viewMoving ? VIEW_SETTLE_TOLERANCE : VIEW_MOVE_TOLERANCE);
    if (this.viewMoving) this.restartSampling();

    const cameraChanged = cameraDistance(this.syncedCameraValues, cameraValues) > CAMERA_RESTART_TOLERANCE;
    const unsynced = state.topologyKey !== this.topologyKey || state.materialKey !== this.materialKey ||
      state.transformKey !== this.transformKey || cameraChanged ||
      this.lightsDirty || this.environmentDirty;
    if (unsynced && this.viewMoving) {
      this.lastDefer = sceneChanged ? 'deforming' : 'moving';
      return false;
    }

    if (unsynced) {
      if (state.topologyKey !== this.topologyKey) {
        withPathTracingScene(scene, () => {
          this.refitGeometry(scene);
          this.tracer.setScene(scene, camera);
        });
        this.lightsDirty = false;
        this.environmentDirty = false;
        this.syncedCameraValues = cameraValues;
      } else {
        withPathTracingScene(scene, () => {
          if (this.lightsDirty) {
            this.tracer.updateLights();
            this.lightsDirty = false;
          }
          if (this.environmentDirty) {
            this.tracer.updateEnvironment();
            this.environmentDirty = false;
          }
          if (state.materialKey !== this.materialKey) this.tracer.updateMaterials();
          if (state.transformKey !== this.transformKey) this.tracer.updateTransforms();
        });
        if (cameraChanged) {
          this.tracer.updateCamera();
          this.syncedCameraValues = cameraValues;
        }
      }

      this.topologyKey = state.topologyKey;
      this.materialKey = state.materialKey;
      this.transformKey = state.transformKey;
      this.restartSampling();
    }

    withPathTracingScene(scene, () => this.tracer.renderSample());
    if (this.blendWeight < 1) this.drawRasterOverlay(scene, camera);
    this.readSampleCount(now);
    this.lastDefer = null;
    return true;
  }

  /** Draws the raster view of the frame over the path-traced image, faded by the sample count. */
  private drawRasterOverlay(scene: THREE.Scene, camera: THREE.PerspectiveCamera | THREE.OrthographicCamera): void {
    this.renderer.getDrawingBufferSize(this.drawingSize);
    const width = Math.max(1, Math.floor(this.drawingSize.x));
    const height = Math.max(1, Math.floor(this.drawingSize.y));
    if (this.blendTarget.width !== width || this.blendTarget.height !== height) this.blendTarget.setSize(width, height);

    this.renderer.setRenderTarget(this.blendTarget);
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);

    const autoClear = this.renderer.autoClear;
    this.renderer.autoClear = false;
    try {
      this.blendAlpha.value = 1 - this.blendWeight;
      this.renderer.render(this.blendScene, this.blendCamera);
    } finally {
      // A texture background only clears when autoClear is on, so it must always be restored.
      this.renderer.autoClear = autoClear;
    }
  }

  /** Samples the pass must reach before the raster base is gone. */
  private get blendLimit(): number {
    const maxSamples = this.tracer.maxSamples;
    return maxSamples > 0 ? Math.min(RASTER_BLEND_SAMPLES, maxSamples) : RASTER_BLEND_SAMPLES;
  }

  /** Discards the reported count; accumulation restarts from the next sample. */
  private restartSampling(): void {
    this.sampleGeneration += 1;
    this.measuredSamples = 0;
    this.blendWeight = 0;
    this.lastSampleReadback = Number.NEGATIVE_INFINITY;
  }

  /**
   * Sizes the accumulation buffer to the drawing area in CSS pixels and gives every pixel a path
   * slot, so a sample round covers the whole image instead of lighting it in bands.
   */
  private syncRenderSize(): void {
    this.renderer.getSize(this.drawingSize);
    const scale = this.tracer.renderScale;
    const width = Math.max(1, Math.floor(this.drawingSize.x * scale));
    const height = Math.max(1, Math.floor(this.drawingSize.y * scale));
    if (this.tracerSize.x !== width || this.tracerSize.y !== height) {
      this.tracerSize.set(width, height);
      this.tracer.setSize(width, height);
    }
    const budget = Math.max(this.frameBudget, width * height);
    if (this.tracer.frameBudget !== budget) this.tracer.frameBudget = budget;
  }

  /** Reads the per-pixel sample count from the tracer, at most once per readback interval. */
  private readSampleCount(now: number): void {
    const interval = this.blendWeight < 1 ? BLEND_READBACK_MS : SAMPLE_READBACK_MS;
    if (now - this.lastSampleReadback < interval) return;
    this.lastSampleReadback = now;
    const generation = this.sampleGeneration;
    void this.tracer.getSampleCountsAsync().then(counts => {
      if (this.disposed || generation !== this.sampleGeneration) return;
      this.measuredSamples = Math.round(counts.avg);
      this.blendWeight = Math.min(1, this.measuredSamples / this.blendLimit);
    });
  }

  /** Rebuilds the ray generator when the viewport swaps between its two cameras. */
  private rebindCamera(camera: THREE.PerspectiveCamera | THREE.OrthographicCamera): void {
    const bound = (this.tracer as unknown as { camera?: THREE.Camera }).camera;
    if (!bound || bound === camera) return;
    // The scene recapture rebinds the tracer, its guides and the denoiser to the new camera.
    this.topologyKey = CAMERA_SWAP_KEY;
    this.syncedCameraValues = null;
    this.restartSampling();
    this.tracer.reset();
  }

  /** Frees the BVH buffers, compute pipelines, denoiser and accumulation targets. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const denoiser of this.denoisers.values()) denoiser.dispose();
    this.denoisers.clear();
    this.denoiserLoading.clear();
    this.blendMesh.geometry.dispose();
    this.blendMesh.material.dispose();
    this.blendTarget.dispose();
    this.tracer.dispose();
  }

  /** Refits moved cloth vertices and rebuilds BVHs whose topology changed. */
  private refitGeometry(scene: THREE.Scene): void {
    const visited = new Set<THREE.BufferGeometry>();
    scene.traverse(object => {
      if (!(object instanceof THREE.Mesh) || !pathMaterials(object)) return;
      const geometry = object.geometry as GeometryWithBVH;
      if (visited.has(geometry)) return;
      visited.add(geometry);

      const index = geometry.index;
      const previousIndex = this.indexAttributes.get(geometry);
      if (previousIndex !== undefined && previousIndex !== index) {
        delete geometry.boundsTree;
      } else {
        geometry.boundsTree?.refit();
      }
      this.indexAttributes.set(geometry, index);
    });
  }

  /** Updates the settings that do not need the asynchronous denoiser. */
  private applyTracerSettings(config: RayTracingConfig): void {
    this.tracer.maxBounces = config.maxBounces;
    this.frameBudget = config.frameBudget;
    this.tracer.maxSamples = config.maxSamples;
    this.tracer.renderScale = config.renderScale;
    this.tracer.filterGlossyFactor = config.filterGlossyFactor;
    this.tracer.clampDirect = config.clampDirect;
    this.tracer.clampIndirect = config.clampIndirect;
  }

  /** Creates a guided OIDN model once per selected weight, returning null after a failed load. */
  private async ensureDenoiser(model: DenoiseModel): Promise<OIDNDenoiser | null> {
    const existing = this.denoisers.get(model);
    if (existing) return existing;
    let loading = this.denoiserLoading.get(model);
    if (!loading) {
      loading = import('oidn-webgpu').then(oidn => {
        if (this.disposed) throw new Error('ray tracing renderer disposed');
        const initUNet = oidn.initUNetFromURL as unknown as InitUNetFromURL;
        const denoiser = new OIDNDenoiser({
          initUNetFromURL: initUNet,
          auxWeightsUrl: bundledAssetUrl(OIDN_WEIGHTS[model]),
          colorWeightsUrl: bundledAssetUrl(OIDN_COLOR_WEIGHTS),
        });
        const guarded = guardDenoiser(denoiser, error => {
          this.failedDenoiseModel = model;
          this.reportDenoiserFailure(error);
          this.activeDenoiser = null;
          this.tracer.setDenoiser(null);
        });
        this.denoisers.set(model, guarded);
        this.denoiserLoading.delete(model);
        return guarded;
      }).catch(error => {
        this.denoiserLoading.delete(model);
        throw error;
      });
      this.denoiserLoading.set(model, loading);
    }
    try {
      return await loading;
    } catch (error) {
      this.failedDenoiseModel = model;
      this.reportDenoiserFailure(error);
      this.activeDenoiser = null;
      this.tracer.setDenoiser(null);
      return null;
    }
  }

  /** Logs an OIDN failure and tells the user how to retry the weight download. */
  private reportDenoiserFailure(error: unknown): void {
    console.warn('OIDN denoiser unavailable:', error);
    useUIStore.getState().showToast('OIDN 降噪权重加载失败，已改用无降噪渲染；关闭再开启降噪可重试。');
  }
}

/** Intercepts asynchronous OIDN failures so path tracing can continue without a denoiser. */
function guardDenoiser(denoiser: OIDNDenoiser, onError: (error: unknown) => void): OIDNDenoiser {
  let reported = false;
  const report = (error: unknown): void => {
    if (reported) return;
    reported = true;
    onError(error);
  };

  return new Proxy(denoiser, {
    get(target, property, receiver) {
      if (property === 'update') {
        return (texture: THREE.Texture) => {
          try {
            return target.update(texture);
          } catch (error) {
            report(error);
            return null;
          }
        };
      }
      if (property === 'denoise') {
        return async (...args: Parameters<OIDNDenoiser['denoise']>) => {
          try {
            await target.denoise(...args);
          } catch (error) {
            report(error);
          }
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

/** Reads only meshes supported by the path tracer; helper overlays stay out of the keys. */
function readSceneState(scene: THREE.Scene): SceneState {
  const topology: string[] = [];
  const materials: string[] = [];
  const transforms: string[] = [];
  scene.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const meshMaterials = pathMaterials(object);
    if (!meshMaterials) return;
    const geometry = object.geometry;
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    const uv = geometry.getAttribute('uv');
    const materialIds = meshMaterials.map(material => material.uuid).join(',');
    topology.push([
      object.uuid,
      geometry.uuid,
      geometry.index?.uuid ?? '',
      position.version,
      normal?.version ?? 0,
      uv?.version ?? 0,
      geometry.groups.length,
      materialIds,
      isEffectivelyVisible(object) ? 1 : 0,
    ].join(':'));
    materials.push(...meshMaterials.map(material => `${material.uuid}:${material.version}`));
    transforms.push(...object.matrixWorld.elements.map(value => value.toFixed(6)));
  });
  return {
    topologyKey: topology.join('|'),
    materialKey: materials.join('|'),
    transformKey: transforms.join('|'),
  };
}

/** Camera transform and projection values that invalidate accumulated samples. */
function readCameraValues(camera: THREE.PerspectiveCamera | THREE.OrthographicCamera): number[] {
  return [...camera.matrixWorld.elements, ...camera.projectionMatrix.elements];
}

/** Largest entry-wise change between two camera snapshots; Infinity when there is nothing to match. */
function cameraDistance(from: number[] | null, to: number[]): number {
  if (!from || from.length !== to.length) return Number.POSITIVE_INFINITY;
  let distance = 0;
  for (let i = 0; i < to.length; i++) distance = Math.max(distance, Math.abs(to[i] - from[i]));
  return distance;
}

/** Whether a mesh and all its ancestors are visible. */
function isEffectivelyVisible(object: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (!current.visible) return false;
    current = current.parent;
  }
  return true;
}

/** Physical materials accepted by the path tracer, including an optional floor substitute. */
function pathMaterials(mesh: THREE.Mesh): PathTracingMaterial[] | null {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  if (materials.every(isPathTracingMaterial)) return materials;
  const substitute = mesh.userData.pathTracingMaterial as THREE.Material | undefined;
  if (!Array.isArray(mesh.material) && substitute && isPathTracingMaterial(substitute)) return [substitute];
  return null;
}

/** Whether the WebGPU path tracer supports this material model. */
function isPathTracingMaterial(material: THREE.Material): material is PathTracingMaterial {
  return (material as THREE.MeshStandardMaterial).isMeshStandardMaterial === true;
}

/** Temporarily substitutes the floor material and hides unsupported helper meshes. */
function withPathTracingScene(scene: THREE.Scene, update: () => void): void {
  const restore: Array<() => void> = [];
  scene.traverse(object => {
    if (!(object instanceof THREE.Mesh) || pathMaterials(object)) return;
    if (object.visible) {
      object.visible = false;
      restore.push(() => { object.visible = true; });
    }
  });
  scene.traverse(object => {
    if (!(object instanceof THREE.Mesh) || !object.visible) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (materials.every(isPathTracingMaterial)) return;
    const substitute = object.userData.pathTracingMaterial as THREE.Material | undefined;
    if (!substitute || Array.isArray(object.material)) return;
    const original = object.material;
    object.material = substitute;
    restore.push(() => { object.material = original; });
  });
  try {
    update();
  } finally {
    for (let i = restore.length - 1; i >= 0; i--) restore[i]();
  }
}
