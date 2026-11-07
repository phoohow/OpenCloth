/** WebGPU path tracing of the scene, drawn into a render target instead of the canvas. */

import * as THREE from 'three/webgpu';
import { WebGPUPathTracer } from 'three-gpu-pathtracer/webgpu';
import { normalizeRayTracing } from '@/model';
import type { RayTracingConfig } from '@/model/types';
import type { SceneMgr } from '@/render/scene/manager';
import { LAYERS, LAYER_ORDER } from '@/render/scene/layers';
import { TraceGate, readCameraValues, type TraceDefer } from '@/render/trace/gate';
import type { TraceProxies } from '@/render/trace/proxies';

type GeometryWithBVH = THREE.BufferGeometry & { boundsTree?: { refit(): void } };

/**
 * Fingerprint of a geometry's group ranges. MeshBVH builds one BVH root per group, so this is what
 * decides which triangles the tracer can reach.
 */
function groupSignature(geometry: THREE.BufferGeometry): string {
  let out = '';
  for (const group of geometry.groups) out += `${group.start}:${group.count}:${group.materialIndex};`;
  return out;
}

/** Whether the tracer has a material model for this material. */
function isTraceableMaterial(material: THREE.Material): boolean {
  return (material as THREE.MeshStandardMaterial).isMeshStandardMaterial === true;
}

/**
 * Hides meshes whose material the tracer cannot represent and that have no proxy standing in for
 * them. Always restores what it hid.
 */
function hideUntraceableMeshes(scene: THREE.Scene, proxies: TraceProxies): () => void {
  const hidden: THREE.Object3D[] = [];
  scene.traverse(object => {
    if (!(object instanceof THREE.Mesh) || !object.visible || proxies.has(object)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (materials.every(isTraceableMaterial)) return;
    object.visible = false;
    hidden.push(object);
  });
  return () => {
    for (const object of hidden) object.visible = true;
  };
}

/** Topology key no real scene can produce; marks that the viewport camera object changed. */
const CAMERA_SWAP_KEY = -1;

/** Minimum milliseconds between two readbacks of the per-pixel sample count. */
const SAMPLE_READBACK_MS = 250;

/** Samples a pass must reach before the traced image stands alone without the raster base. */
export const RASTER_BLEND_SAMPLES = 32;

/** Readback interval while a pass is still blending in, so the ramp stays smooth. */
const BLEND_READBACK_MS = 60;

/** What one trace step produced. */
export interface TraceFrame {
  /** Whether this frame drew traced samples into the target. */
  readonly drawn: boolean;
  /** Gate that kept the frame on the raster base, when it did. */
  readonly defer: TraceDefer | null;
  /** Samples accumulated per pixel. */
  readonly samples: number;
  /** Weight of the traced image over the raster base, 0..1. */
  readonly weight: number;
  /** Whether the pass is still adding samples. */
  readonly accumulating: boolean;
}

/** Progressive path tracer over the objects the scene marks as traceable. */
export class PathTracer {
  private readonly tracer: WebGPUPathTracer;
  private readonly gate = new TraceGate();
  private readonly indexAttributes = new WeakMap<THREE.BufferGeometry, THREE.BufferAttribute | null>();
  private readonly groupSignatures = new WeakMap<THREE.BufferGeometry, string>();
  private readonly tracerSize = new THREE.Vector2();
  private topologyVersion = CAMERA_SWAP_KEY;
  private deformVersion = -1;
  /** Group version seen on the last capture; a change rebuilds the BVH roots of that geometry. */
  private groupsVersion = -1;
  /** Deform version seen on the previous frame; a change means the cloth is still being simulated. */
  private lastSeenDeform = -1;
  private lightsDirty = false;
  private environmentDirty = false;
  private measuredSamples = 0;
  private sampleGeneration = 0;
  private lastSampleReadback = Number.NEGATIVE_INFINITY;
  private frameBudget = 0;
  private disposed = false;

  constructor(
    private readonly renderer: THREE.WebGPURenderer,
    private readonly proxies: TraceProxies,
    config: RayTracingConfig,
  ) {
    this.tracer = new WebGPUPathTracer(renderer);
    // The drawing buffer includes the device pixel ratio, which would need four times the paths
    // for the same picture; the tracer is sized from the drawing area in CSS pixels instead.
    this.tracer.synchronizeRenderSize = false;
    this.tracer.renderDelay = 0;
    this.tracer.minSamples = 0;
    this.tracer.fadeDuration = 0;
    this.applySettings(normalizeRayTracing(config));
  }

  /** Whether dispose() has run; late async work checks this before touching the device. */
  get isDisposed(): boolean {
    return this.disposed;
  }

  /** Samples accumulated per pixel; 0 while the view is in motion. */
  get sampleCount(): number {
    const limit = this.tracer.maxSamples;
    return limit > 0 ? Math.min(this.measuredSamples, limit) : this.measuredSamples;
  }

  /** Fraction of the drawing area the traced image is rendered at. */
  get renderScale(): number {
    return this.tracer.renderScale;
  }

  /** Whether the pass is still adding samples. */
  get accumulating(): boolean {
    return this.sampleCount < this.tracer.maxSamples;
  }

  /** Re-collects punctual lights before the next sample. */
  invalidateLights(): void {
    this.lightsDirty = true;
  }

  /** Re-reads the environment texture and intensity before the next sample. */
  invalidateEnvironment(): void {
    this.environmentDirty = true;
  }

  /** Stores new settings and restarts the pass. */
  applyConfig(config: RayTracingConfig): void {
    if (this.disposed) return;
    this.applySettings(normalizeRayTracing(config));
    this.tracer.reset();
    this.restartSampling();
  }

  /** Averages the per-pixel sample counts straight from the tracer. */
  async measureSampleAverage(): Promise<number> {
    if (this.disposed) return 0;
    const counts = await this.tracer.getSampleCountsAsync();
    return counts.avg;
  }

  /**
   * Advances the progressive render by one GPU step and draws it into `target`.
   * @returns what the frame produced; `drawn: false` leaves the raster base in charge.
   */
  render(
    sceneMgr: SceneMgr,
    camera: THREE.PerspectiveCamera | THREE.OrthographicCamera,
    target: THREE.RenderTarget,
  ): TraceFrame {
    if (this.disposed) return idle(this.sampleCount);
    // Only the layers the table marks traceable may reach the BVH; overlays and gizmos are
    // raster-only and their geometry is not something the tracer can walk. Inside those layers,
    // meshes the tracer has no material model for are hidden too — a single one makes the whole
    // pass fail, which reads as "this GPU cannot path trace". The scene's trace masks are applied
    // last, so an object the runtime masked out never reaches the TLAS either.
    return sceneMgr.withoutUntracedLayers(() => {
      const restoreMasks = sceneMgr.applyTraceMasks();
      const restore = hideUntraceableMeshes(sceneMgr.scene, this.proxies);
      try {
        return this.renderFrame(sceneMgr, camera, target);
      } finally {
        restore();
        restoreMasks();
      }
    });
  }

  /** One traced step, with the scene already pruned to the traceable layers. */
  private renderFrame(
    sceneMgr: SceneMgr,
    camera: THREE.PerspectiveCamera | THREE.OrthographicCamera,
    target: THREE.RenderTarget,
  ): TraceFrame {
    sceneMgr.updateMatrixWorld();
    camera.updateMatrixWorld();

    this.rebindCamera(camera);
    this.syncRenderSize(target);

    const cameraValues = readCameraValues(camera);
    const revisions = sceneMgr.revisions;
    // Vertices that moved since the previous frame mean the simulation is still running. Every move
    // invalidates the BVH, and rebuilding it is far more expensive than the samples are worth, so
    // the raster base keeps the frame until the cloth settles — then one recapture catches up.
    const deforming = revisions.deform !== this.lastSeenDeform;
    this.lastSeenDeform = revisions.deform;
    const sceneChanged = this.gate.needsSync(revisions);
    const verdict = this.gate.observe(cameraValues);
    const unsynced = sceneChanged || verdict.restart || this.lightsDirty || this.environmentDirty;

    if (unsynced && (verdict.moving || deforming)) {
      this.restartSampling();
      const defer: TraceDefer = deforming ? 'deforming' : 'moving';
      return { drawn: false, defer, samples: 0, weight: 0, accumulating: true };
    }

    if (unsynced) {
      this.syncScene(sceneMgr, camera, cameraValues, sceneChanged);
      this.restartSampling();
    }

    this.renderer.setRenderTarget(target);
    try {
      this.proxies.run(() => this.tracer.renderSample());
    } finally {
      this.renderer.setRenderTarget(null);
    }

    this.readSampleCount(performance.now());
    return {
      drawn: true,
      defer: null,
      samples: this.sampleCount,
      weight: Math.min(1, this.measuredSamples / RASTER_BLEND_SAMPLES),
      accumulating: this.accumulating,
    };
  }

  /** Discards the accumulated samples and refits what the tracer holds. */
  reset(): void {
    this.tracer.reset();
    this.gate.reset();
    this.topologyVersion = CAMERA_SWAP_KEY;
    this.groupsVersion = -1;
    this.restartSampling();
  }

  /** Frees the BVH buffers, pipelines and accumulation targets. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.tracer.dispose();
  }

  /** Recolours lights, environment, materials, transforms or the whole scene, as needed. */
  private syncScene(
    sceneMgr: SceneMgr,
    camera: THREE.PerspectiveCamera | THREE.OrthographicCamera,
    cameraValues: number[],
    sceneChanged: boolean,
  ): void {
    const revisions = sceneMgr.revisions;
    const topology = revisions.topology;
    // Deformed vertices live in the same buffers as before, so the topology is unchanged — but the
    // acceleration structure the kernels trace against was packed from the old positions. `setScene`
    // is the only entry that rebuilds and re-uploads it, so a deform counts as a recapture too.
    // A group change is a recapture as well: MeshBVH builds one root per geometry group, so the set
    // of ranges is what decides which triangles exist for the tracer at all.
    const recapture = topology !== this.topologyVersion
      || this.topologyVersion === CAMERA_SWAP_KEY
      || revisions.deform !== this.deformVersion
      || revisions.groups !== this.groupsVersion;
    this.proxies.run(() => {
      if (recapture) {
        this.refitGeometry(sceneMgr);
        this.tracer.setScene(sceneMgr.scene, camera);
        // Samples gathered against the previous geometry would blend into the new one.
        this.tracer.reset();
        this.lightsDirty = false;
        this.environmentDirty = false;
        return;
      }
      if (this.lightsDirty) {
        this.tracer.updateLights();
        this.lightsDirty = false;
      }
      if (this.environmentDirty) {
        this.tracer.updateEnvironment();
        this.environmentDirty = false;
      }
      this.tracer.updateMaterials();
      this.tracer.updateTransforms();
      // The ray generator holds its own copy of the camera; a view change reaches the tracer only
      // through this call, or the pass keeps sampling the view it was captured with.
      this.tracer.updateCamera();
    });
    this.deformVersion = revisions.deform;
    this.topologyVersion = topology;
    this.groupsVersion = revisions.groups;
    this.gate.markSynced(revisions, cameraValues);
    if (!sceneChanged) this.gate.markCameraSynced(cameraValues);
  }

  /** Refits moved cloth vertices and rebuilds BVHs whose index or group ranges changed. */
  private refitGeometry(sceneMgr: SceneMgr): void {
    const visited = new Set<THREE.BufferGeometry>();
    for (const id of LAYER_ORDER) {
      if (!LAYERS[id].trace) continue;
      for (const object of sceneMgr.objectsIn(id)) {
        object.traverse(child => {
          if (!(child instanceof THREE.Mesh) || !isPathTracingMaterial(child.material)) return;
          const geometry = child.geometry as GeometryWithBVH;
          if (visited.has(geometry)) return;
          visited.add(geometry);
          const index = geometry.index;
          const signature = groupSignature(geometry);
          const previousIndex = this.indexAttributes.get(geometry);
          const previousSignature = this.groupSignatures.get(geometry);
          // MeshBVH packs one root per group, so either a new index buffer or a new set of ranges
          // leaves the tree describing triangles that are no longer drawn.
          if (previousIndex !== undefined && previousIndex !== index) delete geometry.boundsTree;
          else if (previousSignature !== undefined && previousSignature !== signature) {
            delete geometry.boundsTree;
          } else geometry.boundsTree?.refit();
          this.indexAttributes.set(geometry, index);
          this.groupSignatures.set(geometry, signature);
        });
      }
    }
  }

  /** Rebuilds the ray generator when the viewport swaps between its two cameras. */
  private rebindCamera(camera: THREE.PerspectiveCamera | THREE.OrthographicCamera): void {
    const bound = (this.tracer as unknown as { camera?: THREE.Camera }).camera;
    if (!bound || bound === camera) return;
    this.topologyVersion = CAMERA_SWAP_KEY;
    this.gate.reset();
    this.tracer.reset();
    this.restartSampling();
  }

  /**
   * Sizes the accumulation buffer to the drawing area in CSS pixels and gives every pixel a path
   * slot, so a sample round covers the whole image instead of lighting it in bands.
   */
  private syncRenderSize(target: THREE.RenderTarget): void {
    const width = Math.max(1, target.width);
    const height = Math.max(1, target.height);
    if (this.tracerSize.x !== width || this.tracerSize.y !== height) {
      this.tracerSize.set(width, height);
      this.tracer.setSize(width, height);
    }
    const budget = Math.max(this.frameBudget, width * height);
    if (this.tracer.frameBudget !== budget) this.tracer.frameBudget = budget;
  }

  /** Reads the per-pixel sample count from the tracer, at most once per readback interval. */
  private readSampleCount(now: number): void {
    const interval = this.measuredSamples / RASTER_BLEND_SAMPLES < 1 ? BLEND_READBACK_MS : SAMPLE_READBACK_MS;
    if (now - this.lastSampleReadback < interval) return;
    this.lastSampleReadback = now;
    const generation = this.sampleGeneration;
    void this.tracer.getSampleCountsAsync().then(counts => {
      if (this.disposed || generation !== this.sampleGeneration) return;
      this.measuredSamples = Math.round(counts.avg);
    });
  }

  /** Discards the reported count; accumulation restarts from the next sample. */
  private restartSampling(): void {
    this.sampleGeneration += 1;
    this.measuredSamples = 0;
    this.lastSampleReadback = Number.NEGATIVE_INFINITY;
  }

  /** Applies the settings that do not need an asynchronous load. */
  private applySettings(config: RayTracingConfig): void {
    this.tracer.maxBounces = config.maxBounces;
    this.frameBudget = config.frameBudget;
    this.tracer.maxSamples = config.maxSamples;
    this.tracer.renderScale = config.renderScale;
    this.tracer.filterGlossyFactor = config.filterGlossyFactor;
    this.tracer.clampDirect = config.clampDirect;
    this.tracer.clampIndirect = config.clampIndirect;
  }
}

/** Frame result of a pass that did not run. */
function idle(samples: number): TraceFrame {
  return { drawn: false, defer: null, samples, weight: 0, accumulating: false };
}

/** Whether the tracer supports this material model. */
function isPathTracingMaterial(material: THREE.Material | THREE.Material[]): boolean {
  const list = Array.isArray(material) ? material : [material];
  return list.every(entry => (entry as THREE.MeshStandardMaterial).isMeshStandardMaterial === true);
}
