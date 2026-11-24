import type { Commands } from '@/render/backend/commands';
import type { SceneStore } from '@/render/backend/scene/sceneStore';
import type { TargetHandle } from '@/render/backend/types';
import type { TraceDefer, TraceSettings, VersionStamp } from '@/render/common';

import { TraceGate, readCameraValues } from '@/render/backend/trace/traceGate';
import { WebGPUPathTracer } from 'three-gpu-pathtracer/webgpu';
import * as THREE from 'three/webgpu';

const SAMPLE_READBACK_MS = 250;

export const RASTER_BLEND_SAMPLES = 32;

const BLEND_READBACK_MS = 60;

type GeometryWithBVH = THREE.BufferGeometry & { boundsTree?: { refit(): void } };

export interface TraceFrame {
  readonly drawn: boolean;
  readonly defer: TraceDefer | null;
  readonly samples: number;
  readonly weight: number;
  readonly accumulating: boolean;
}

interface VersionDiff {
  recapture: boolean;
  material: boolean;
  transform: boolean;
  lights: boolean;
  environment: boolean;
  any: boolean;
}

function groupSignature(geometry: THREE.BufferGeometry): string {
  let out = '';
  for (const group of geometry.groups) out += `${group.start}:${group.count}:${group.materialIndex};`;
  return out;
}

function isTraceableMaterial(material: THREE.Material): boolean {
  return (material as THREE.MeshStandardMaterial).isMeshStandardMaterial === true;
}

function isPathTracingMaterial(material: THREE.Material | THREE.Material[]): boolean {
  const list = Array.isArray(material) ? material : [material];
  return list.every(isTraceableMaterial);
}

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

export class PathTracer {
  private readonly tracer: WebGPUPathTracer;
  private readonly gate = new TraceGate();
  private readonly indexAttributes = new WeakMap<THREE.BufferGeometry, THREE.BufferAttribute | null>();
  private readonly positionAttributes = new WeakMap<THREE.BufferGeometry, THREE.BufferAttribute | null>();
  private readonly groupSignatures = new WeakMap<THREE.BufferGeometry, string>();
  private readonly tracerSize = new THREE.Vector2();
  private captured: Readonly<VersionStamp> | null = null;
  private lastSeenDeform = -1;
  private lastSeenTransform = -1;
  private measuredSamples = 0;
  private sampleGeneration = 0;
  private lastSampleReadback = Number.NEGATIVE_INFINITY;
  private frameBudget = 0;
  private disposed = false;

  constructor(renderer: THREE.WebGPURenderer, settings: TraceSettings) {
    this.tracer = new WebGPUPathTracer(renderer);
    this.tracer.synchronizeRenderSize = false;
    this.tracer.renderDelay = 0;
    this.tracer.minSamples = 0;
    this.tracer.fadeDuration = 0;
    this.applySettings(settings);
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  get sampleCount(): number {
    const limit = this.tracer.maxSamples;
    return limit > 0 ? Math.min(this.measuredSamples, limit) : this.measuredSamples;
  }

  get renderScale(): number {
    return this.tracer.renderScale;
  }

  get accumulating(): boolean {
    return this.sampleCount < this.tracer.maxSamples;
  }

  private get blendSamples(): number {
    const limit = this.tracer.maxSamples;
    return limit > 0 ? Math.min(RASTER_BLEND_SAMPLES, limit) : RASTER_BLEND_SAMPLES;
  }

  applyConfig(settings: TraceSettings): void {
    if (this.disposed) return;
    this.applySettings(settings);
    this.tracer.reset();
    this.restartSampling();
  }

  async measureSampleAverage(): Promise<number> {
    if (this.disposed) return 0;
    const counts = await this.tracer.getSampleCountsAsync();
    return counts.avg;
  }

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

  reset(): void {
    this.tracer.reset();
    this.gate.reset();
    this.captured = null;
    this.restartSampling();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.tracer.dispose();
  }

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

  private syncScene(
    scene: SceneStore,
    versions: Readonly<VersionStamp>,
    camera: THREE.PerspectiveCamera | THREE.OrthographicCamera,
    cameraValues: number[],
    change: VersionDiff,
    cameraRestart: boolean,
  ): void {
    if (change.recapture) {
      this.refitGeometry(scene);
      this.tracer.setScene(scene.traceSceneRoot, camera);
      this.tracer.reset();
    } else {
      if (change.lights) this.tracer.updateLights();
      if (change.environment) this.tracer.updateEnvironment();
      if (change.material) this.tracer.updateMaterials();
      if (change.transform) this.tracer.updateTransforms();
    }

    if (!change.recapture || cameraRestart) this.tracer.updateCamera();
    this.captured = { ...versions };
    this.gate.markSynced(cameraValues);
  }

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

  private rebindCamera(camera: THREE.PerspectiveCamera | THREE.OrthographicCamera): void {
    const bound = (this.tracer as unknown as { camera?: THREE.Camera }).camera;
    if (!bound || bound === camera) return;
    this.captured = null;
    this.gate.reset();
    this.tracer.reset();
    this.restartSampling();
  }

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

  private restartSampling(): void {
    this.sampleGeneration += 1;
    this.measuredSamples = 0;
    this.lastSampleReadback = Number.NEGATIVE_INFINITY;
  }

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

function idle(samples: number): TraceFrame {
  return { drawn: false, defer: null, samples, weight: 0, accumulating: false };
}
