/** WebGPU path tracing of the scene, drawn into a render target instead of the canvas. */

import * as THREE from 'three/webgpu';
import { WebGPUPathTracer } from 'three-gpu-pathtracer/webgpu';
import type { TraceDefer, TraceSettings, VersionStamp } from '@/render/common';
import type { Commands } from '@/render/backend/commands';
import type { SceneStore } from '@/render/backend/scene/sceneStore';
import type { TargetHandle } from '@/render/backend/types';
import { TraceGate, readCameraValues } from '@/render/backend/trace/traceGate';

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

/** Whether every entry of a material list is traceable. */
function isPathTracingMaterial(material: THREE.Material | THREE.Material[]): boolean {
  const list = Array.isArray(material) ? material : [material];
  return list.every(isTraceableMaterial);
}

/**
 * Hides meshes whose material the tracer cannot represent. Always restores what it hid.
 */
function hideUntraceableMeshes(scene: THREE.Scene): () => void {
  const hidden: THREE.Object3D[] = [];
  scene.traverse(object => {
    if (!(object instanceof THREE.Mesh) || !object.visible) return;
    if (isPathTracingMaterial(object.material)) return;
    object.visible = false;
    hidden.push(object);
  });
  return () => {
    for (const object of hidden) object.visible = true;
  };
}

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

/** Scene changes since the last capture, by what the tracer has to redo. */
interface VersionDiff {
  recapture: boolean;
  material: boolean;
  transform: boolean;
  lights: boolean;
  environment: boolean;
  any: boolean;
}

/** Progressive path tracer over the scene's traceable entities. */
export class PathTracer {
  private readonly tracer: WebGPUPathTracer;
  private readonly gate = new TraceGate();
  private readonly indexAttributes = new WeakMap<THREE.BufferGeometry, THREE.BufferAttribute | null>();
  private readonly positionAttributes = new WeakMap<THREE.BufferGeometry, THREE.BufferAttribute | null>();
  private readonly groupSignatures = new WeakMap<THREE.BufferGeometry, string>();
  private readonly tracerSize = new THREE.Vector2();
  private captured: Readonly<VersionStamp> | null = null;
  /** Deform version seen on the previous frame; a change means the cloth is still being simulated. */
  private lastSeenDeform = -1;
  /** Transform version seen on the previous frame; a change means something is still animating. */
  private lastSeenTransform = -1;
  private measuredSamples = 0;
  private sampleGeneration = 0;
  private lastSampleReadback = Number.NEGATIVE_INFINITY;
  private frameBudget = 0;
  private disposed = false;

  constructor(renderer: THREE.WebGPURenderer, settings: TraceSettings) {
    this.tracer = new WebGPUPathTracer(renderer);
    // The drawing buffer includes the device pixel ratio, which would need four times the paths
    // for the same picture; the tracer is sized from the drawing area in CSS pixels instead.
    this.tracer.synchronizeRenderSize = false;
    this.tracer.renderDelay = 0;
    this.tracer.minSamples = 0;
    this.tracer.fadeDuration = 0;
    this.applySettings(settings);
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

  /** Samples the blend-in needs; capped by the pass limit so a short render still takes over. */
  private get blendSamples(): number {
    const limit = this.tracer.maxSamples;
    return limit > 0 ? Math.min(RASTER_BLEND_SAMPLES, limit) : RASTER_BLEND_SAMPLES;
  }

  /** Stores new settings and restarts the pass. */
  applyConfig(settings: TraceSettings): void {
    if (this.disposed) return;
    this.applySettings(settings);
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
    scene: SceneStore,
    versions: Readonly<VersionStamp>,
    camera: THREE.PerspectiveCamera | THREE.OrthographicCamera,
    target: TargetHandle,
    commands: Commands,
  ): TraceFrame {
    if (this.disposed) return idle(this.sampleCount);
    const restore = hideUntraceableMeshes(scene.traceSceneRoot);
    try {
      return this.renderFrame(scene, versions, camera, target, commands);
    } finally {
      restore();
    }
  }

  /** One traced step, with the scene already pruned to its traceable presentation. */
  private renderFrame(
    scene: SceneStore,
    versions: Readonly<VersionStamp>,
    camera: THREE.PerspectiveCamera | THREE.OrthographicCamera,
    target: TargetHandle,
    commands: Commands,
  ): TraceFrame {
    scene.traceSceneRoot.updateMatrixWorld(true);
    camera.updateMatrixWorld();

    this.rebindCamera(camera);
    this.syncRenderSize(target);

    const cameraValues = readCameraValues(camera);
    // Vertices or transforms that moved since the previous frame mean the scene is still running.
    // Every move invalidates the captured scene, and rebuilding it is far more expensive than the
    // samples are worth, so the raster base keeps the frame until it settles — then one recapture
    // catches up. Without this a moving avatar would restart the pass every frame and never
    // accumulate a single sample.
    const deforming = versions.geometry !== this.lastSeenDeform;
    this.lastSeenDeform = versions.geometry;
    const transforming = versions.transform !== this.lastSeenTransform;
    this.lastSeenTransform = versions.transform;
    const change = this.diff(versions);
    const verdict = this.gate.observe(cameraValues);
    const unsynced = change.any || verdict.restart;

    if (unsynced && (verdict.moving || deforming || transforming)) {
      this.restartSampling();
      const defer: TraceDefer = deforming || transforming ? 'deforming' : 'moving';
      return { drawn: false, defer, samples: 0, weight: 0, accumulating: true };
    }

    if (unsynced) {
      this.syncScene(scene, versions, camera, cameraValues, change, verdict.restart);
      this.restartSampling();
    }

    commands.setTarget(target, true);
    try {
      this.tracer.renderSample();
    } finally {
      commands.setTarget(null, true);
    }

    this.readSampleCount(performance.now());
    return {
      drawn: true,
      defer: null,
      samples: this.sampleCount,
      weight: Math.min(1, this.measuredSamples / this.blendSamples),
      accumulating: this.accumulating,
    };
  }

  /** Discards the accumulated samples and refits what the tracer holds. */
  reset(): void {
    this.tracer.reset();
    this.gate.reset();
    this.captured = null;
    this.restartSampling();
  }

  /** Frees the BVH buffers, pipelines and accumulation targets. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.tracer.dispose();
  }

  /** Which parts of the capture the new versions invalidate. */
  private diff(versions: Readonly<VersionStamp>): VersionDiff {
    const previous = this.captured;
    const recapture = !previous
      || previous.topology !== versions.topology
      || previous.geometry !== versions.geometry
      || previous.visibility !== versions.visibility;
    const material = !previous || previous.material !== versions.material;
    const transform = !previous || previous.transform !== versions.transform;
    const lights = !previous || previous.lights !== versions.lights;
    const environment = !previous || previous.environment !== versions.environment;
    return {
      recapture, material, transform, lights, environment,
      any: recapture || material || transform || lights || environment,
    };
  }

  /** Recolours lights, environment, materials, transforms or the whole scene, as needed. */
  private syncScene(
    scene: SceneStore,
    versions: Readonly<VersionStamp>,
    camera: THREE.PerspectiveCamera | THREE.OrthographicCamera,
    cameraValues: number[],
    change: VersionDiff,
    cameraRestart: boolean,
  ): void {
    // Deformed vertices live in the same buffers as before, so the topology is unchanged — but the
    // acceleration structure the kernels trace against was packed from the old positions. `setScene`
    // is the only entry that rebuilds and re-uploads it, so a deform counts as a recapture too.
    if (change.recapture) {
      this.refitGeometry(scene);
      this.tracer.setScene(scene.traceSceneRoot, camera);
      // Samples gathered against the previous geometry would blend into the new one.
      this.tracer.reset();
    } else {
      if (change.lights) this.tracer.updateLights();
      if (change.environment) this.tracer.updateEnvironment();
      if (change.material) this.tracer.updateMaterials();
      if (change.transform) this.tracer.updateTransforms();
    }
    // The ray generator holds its own copy of the camera; a view change reaches the tracer only
    // through this call, or the pass keeps sampling the view it was captured with.
    if (!change.recapture || cameraRestart) this.tracer.updateCamera();
    this.captured = { ...versions };
    this.gate.markSynced(cameraValues);
  }

  /** Refits moved cloth vertices and rebuilds BVHs whose index or group ranges changed. */
  private refitGeometry(scene: SceneStore): void {
    const visited = new Set<THREE.BufferGeometry>();
    scene.traceSceneRoot.traverse(child => {
      if (!(child instanceof THREE.Mesh)) return;
      const geometry = child.geometry as GeometryWithBVH;
      if (visited.has(geometry)) return;
      visited.add(geometry);
      const index = geometry.index;
      const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
      const signature = groupSignature(geometry);
      const previousIndex = this.indexAttributes.get(geometry);
      const previousPosition = this.positionAttributes.get(geometry);
      const previousSignature = this.groupSignatures.get(geometry);
      // MeshBVH packs one root per group, so either a new index buffer or a new set of ranges
      // leaves the tree describing triangles that are no longer drawn. A replaced position buffer
      // is just as fatal: refit reads the array captured when the tree was built, not the new one.
      if (previousIndex !== undefined && previousIndex !== index) delete geometry.boundsTree;
      else if (previousPosition !== undefined && previousPosition !== (position ?? null)) {
        delete geometry.boundsTree;
      } else if (previousSignature !== undefined && previousSignature !== signature) {
        delete geometry.boundsTree;
      } else geometry.boundsTree?.refit();
      this.indexAttributes.set(geometry, index);
      this.positionAttributes.set(geometry, position ?? null);
      this.groupSignatures.set(geometry, signature);
    });
  }

  /** Rebuilds the ray generator when the viewport swaps between its two cameras. */
  private rebindCamera(camera: THREE.PerspectiveCamera | THREE.OrthographicCamera): void {
    const bound = (this.tracer as unknown as { camera?: THREE.Camera }).camera;
    if (!bound || bound === camera) return;
    this.captured = null;
    this.gate.reset();
    this.tracer.reset();
    this.restartSampling();
  }

  /**
   * Sizes the accumulation buffer to the render size and gives every pixel a path slot, so a
   * sample round covers the whole image instead of lighting it in bands.
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
    const interval = this.measuredSamples / this.blendSamples < 1 ? BLEND_READBACK_MS : SAMPLE_READBACK_MS;
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
  private applySettings(settings: TraceSettings): void {
    this.tracer.maxBounces = settings.maxBounces;
    this.frameBudget = settings.frameBudget;
    this.tracer.maxSamples = settings.maxSamples;
    this.tracer.renderScale = settings.renderScale;
    this.tracer.filterGlossyFactor = settings.filterGlossyFactor;
    this.tracer.clampDirect = settings.clampDirect;
    this.tracer.clampIndirect = settings.clampIndirect;
  }
}

/** Frame result of a pass that did not run. */
function idle(samples: number): TraceFrame {
  return { drawn: false, defer: null, samples, weight: 0, accumulating: false };
}
