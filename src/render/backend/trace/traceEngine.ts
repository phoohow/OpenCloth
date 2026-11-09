/** Lifetime of the path tracer: lazily built, probed once, and drawn by the trace pass. */

import * as THREE from 'three/webgpu';
import type { CameraState, TraceSettings, TraceStats, VersionStamp } from '@/render/common';
import type { Commands } from '@/render/backend/commands';
import type { SceneStore } from '@/render/backend/scene/sceneStore';
import type { TargetHandle } from '@/render/backend/types';
import type { PathTracer, TraceFrame } from '@/render/backend/trace/pathTracer';
import {
  probeRayTracing, RayTracingUnsupportedError, type RayTracingCapability,
} from '@/render/backend/trace/capability';

/** What the tracer reads from the GPU. */
export interface TraceEngineDeps {
  readonly renderer: THREE.WebGPURenderer;
  readonly device: GPUDevice;
  readonly scene: SceneStore;
  readonly commands: Commands;
  readonly viewSize: () => { readonly x: number; readonly y: number };
}

/** Owns the tracer instance and the one-time capability probe. */
export class TraceEngine {
  capability: RayTracingCapability | null = null;
  private tracer: PathTracer | null = null;
  private loading: Promise<PathTracer | null> | null = null;
  private disposed = false;
  private generation = 0;

  constructor(private readonly deps: TraceEngineDeps) { }

  get ready(): boolean {
    return this.tracer !== null;
  }

  get samples(): TraceStats {
    return {
      samples: this.tracer?.sampleCount ?? 0,
      accumulating: this.tracer?.accumulating ?? false,
    };
  }

  /** Builds and probes the tracer on first use; a rejected device raises. */
  async ensure(settings: TraceSettings, camera: CameraState, versions: Readonly<VersionStamp>): Promise<void> {
    if (this.disposed || this.tracer) return;
    if (this.capability && !this.capability.ok) throw new RayTracingUnsupportedError(this.capability);
    const generation = this.generation;
    if (!this.loading) this.loading = this.build(settings, camera, versions);
    const loading = this.loading;
    let built: PathTracer | null;
    try {
      built = await loading;
    } finally {
      if (this.loading === loading) this.loading = null;
    }
    if (!built || this.disposed || generation !== this.generation) {
      built?.dispose();
      return;
    }
    this.tracer = built;
  }

  /** Stores new settings on a ready tracer. */
  configure(settings: TraceSettings): void {
    this.tracer?.applyConfig(settings);
  }

  /** Draws one traced step into the target. */
  trace(
    camera: CameraState,
    versions: Readonly<VersionStamp>,
    target: TargetHandle,
  ): TraceFrame {
    if (!this.tracer) {
      return { drawn: false, defer: null, samples: 0, weight: 0, accumulating: false };
    }
    const threeCamera = this.deps.commands.cameraFor(camera);
    return this.tracer.render(this.deps.scene, versions, threeCamera, target, this.deps.commands);
  }

  /** Drops the failed tracer and leaves the frame on the raster base. */
  recover(): void {
    this.generation += 1;
    this.tracer?.dispose();
    this.tracer = null;
    this.loading = null;
  }

  dispose(): void {
    this.disposed = true;
    this.generation += 1;
    this.tracer?.dispose();
    this.tracer = null;
    void this.loading?.then(tracer => tracer?.dispose()).catch(() => { });
    this.loading = null;
  }

  /** Creates the tracer, runs the one-time probe and frees it when the device cannot trace. */
  private async build(
    settings: TraceSettings, camera: CameraState, versions: Readonly<VersionStamp>,
  ): Promise<PathTracer | null> {
    const { PathTracer } = await import('@/render/backend/trace/pathTracer');
    if (this.disposed) return null;
    const tracer = new PathTracer(this.deps.renderer, settings);
    if (this.disposed) {
      tracer.dispose();
      return null;
    }
    const probeTarget = new THREE.RenderTarget(
      Math.max(1, Math.floor(this.deps.viewSize().x)),
      Math.max(1, Math.floor(this.deps.viewSize().y)),
      { type: THREE.HalfFloatType, depthBuffer: false },
    );
    let capability: RayTracingCapability | null;
    try {
      capability = await probeRayTracing(
        this.deps.device,
        this.deps.commands,
        tracer,
        this.deps.scene,
        versions,
        this.deps.commands.cameraFor(camera),
        probeTarget,
        this.deps.viewSize(),
      );
    } finally {
      probeTarget.dispose();
    }
    if (capability) {
      this.capability = capability;
      if (!capability.ok) {
        tracer.dispose();
        throw new RayTracingUnsupportedError(capability);
      }
    }
    if (this.disposed) {
      tracer.dispose();
      return null;
    }
    return tracer;
  }
}
