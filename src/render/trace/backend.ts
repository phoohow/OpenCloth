/** Lifetime of the path tracer: lazily built, probed once, and read by the trace pass. */

import * as THREE from 'three/webgpu';
import type { RayTracingConfig } from '@/model/types';
import type { SceneMgr } from '@/render/scene/manager';
import type { SceneCamera } from '@/render/scene/camera';
import type { TraceProxies } from '@/render/trace/proxies';
import type { PathTracer } from '@/render/trace/pathTracer';
import {
  probeRayTracing, RayTracingUnsupportedError, type RayTracingCapability,
} from '@/render/trace/capability';

/** What the backend needs from the viewport. */
export interface TraceBackendDeps {
  /** The viewport's three.js renderer, owned by the Renderer. */
  readonly renderer: THREE.WebGPURenderer;
  readonly device: GPUDevice;
  readonly sceneMgr: SceneMgr;
  readonly camera: SceneCamera;
  readonly proxies: TraceProxies;
}

/**
 * The tracer as the trace pass sees it. The pass asks whether one is active; it never builds one.
 */
export interface TraceBackend {
  readonly active: PathTracer | null;
  readonly ready: boolean;
  readonly capability: RayTracingCapability | null;
  ensure(config: RayTracingConfig): Promise<void>;
  applyConfig(config: RayTracingConfig): void;
  invalidate(): void;
  recover(): void;
  dispose(): void;
}

/**
 * Owns the tracer instance: builds it on the first ray-traced frame, probes the device once and
 * falls back to rasterization when the probe fails.
 */
export class PathTraceBackend implements TraceBackend {
  capability: RayTracingCapability | null = null;
  private tracer: PathTracer | null = null;
  private loading: Promise<PathTracer | null> | null = null;
  private disposed = false;
  /** Increments on recovery and teardown; a build from an older generation is discarded. */
  private generation = 0;

  constructor(private readonly deps: TraceBackendDeps) { }

  /** Tracer currently drawing, or null before the first ray-traced frame. */
  get active(): PathTracer | null {
    return this.tracer;
  }

  /** Whether a tracer is built and installed. */
  get ready(): boolean {
    return this.tracer !== null;
  }

  /** Builds and probes the tracer on first use; a rejected device raises. */
  async ensure(config: RayTracingConfig): Promise<void> {
    if (this.disposed || this.tracer) return;
    if (this.capability && !this.capability.ok) throw new RayTracingUnsupportedError(this.capability);
    const generation = this.generation;
    if (!this.loading) this.loading = this.build(config);
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
  applyConfig(config: RayTracingConfig): void {
    this.tracer?.applyConfig(config);
  }

  /** Tells the tracer that lights or the environment changed. */
  invalidate(): void {
    this.tracer?.invalidateLights();
    this.tracer?.invalidateEnvironment();
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
  private async build(config: RayTracingConfig): Promise<PathTracer | null> {
    const { renderer, device, sceneMgr, camera, proxies } = this.deps;
    // Loaded lazily: the path tracer and its kernels are only needed once a frame asks for them.
    const { PathTracer } = await import('@/render/trace/pathTracer');
    if (this.disposed) return null;
    const tracer = new PathTracer(renderer, proxies, config);
    if (this.disposed) {
      tracer.dispose();
      return null;
    }
    const probeTarget = this.probeTarget(renderer);
    let capability: RayTracingCapability | null;
    try {
      capability = this.capability ?? await probeRayTracing(
        renderer, device, tracer, sceneMgr, camera.camera, probeTarget,
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

  /** Small target the probe renders into, so it never has to touch the canvas. */
  private probeTarget(renderer: THREE.WebGPURenderer): THREE.RenderTarget {
    const size = new THREE.Vector2();
    renderer.getSize(size);
    return new THREE.RenderTarget(
      Math.max(1, Math.floor(size.x)),
      Math.max(1, Math.floor(size.y)),
      { type: THREE.HalfFloatType, depthBuffer: false },
    );
  }
}
