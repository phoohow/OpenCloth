/** Turns the world and one view into a frame without touching three or the domain. */

import type {
  EntityFilter, FrameStats, RayTracingCapability, SceneSnapshot, TraceDefer, TraceReadiness,
  TraceSettings, TraceStatus, VersionStamp,
} from '@/render/common';
import { RayTracingUnsupportedError } from '@/render/common';
import type { Backend } from '@/render/backend';
import type { CameraHost } from '@/render/renderer/view/types';
import { CameraController } from '@/render/renderer/view/cameraController';
import { FrameGraph } from '@/render/renderer/frame/graph';
import {
  idleTrace, resetTrace, type FrameConditions, type FrameSize, type TraceOutput,
} from '@/render/renderer/frame/pass';
import { RendererFrameResources } from '@/render/renderer/frame/resources';
import { RasterPass } from '@/render/renderer/passes/rasterPass';
import { TracePass } from '@/render/renderer/passes/tracePass';
import { DenoisePass } from '@/render/renderer/passes/denoisePass';
import { CompositePass } from '@/render/renderer/passes/compositePass';
import { PostPass } from '@/render/renderer/passes/postPass';
import { HeatmapPass } from '@/render/renderer/passes/heatmapPass';
import { WirePass } from '@/render/renderer/passes/wirePass';
import { OverlayPass } from '@/render/renderer/passes/overlayPass';
import { PresentPass } from '@/render/renderer/passes/presentPass';
import { SceneBuilder, snapshotSignature } from '@/render/renderer/sceneBuilder';
import { buildDrawList } from '@/render/renderer/view/drawList';
import { traces } from '@/render/renderer/view/types';
import type { RenderView } from '@/render/renderer/view/types';
import type { WorldView } from '@/render/world';

/** Assembly inputs of the renderer; only `src/main.tsx` builds them. */
export interface RendererDeps {
  readonly backend: Backend;
  /** Called once when the one-time probe rejects this device. */
  readonly onTraceFailure?: (capability: RayTracingCapability) => void;
}

/** Narrow renderer facade the viewport consumes. */
export interface Renderer {
  readonly camera: CameraHost;
  render(view: RenderView, world: WorldView, versions: Readonly<VersionStamp>): FrameStats;
  traceStatus(view: RenderView): TraceStatus;
  buildExportSnapshot(
    world: WorldView,
    versions: Readonly<VersionStamp>,
    filter?: EntityFilter,
  ): SceneSnapshot;
  resize(size: { readonly width: number; readonly height: number }): void;
  dispose(): void;
}

/** Builds the renderer over a Backend instance. */
export function createRenderer(deps: RendererDeps): Renderer {
  return new RenderPipeline(deps);
}

/** Pass graph, frame resources, camera and tracer lifetime of one viewport. */
class RenderPipeline implements Renderer {
  readonly camera: CameraController;
  private readonly backend: Backend;
  private readonly sceneBuilder = new SceneBuilder();
  private readonly resources: RendererFrameResources;
  private readonly graph: FrameGraph;
  private readonly traceOutput: TraceOutput = idleTrace();
  private readonly onTraceFailure?: (capability: RayTracingCapability) => void;
  private traceSettings: TraceSettings | null = null;
  private traceFailure: RayTracingCapability | null = null;
  private lastDefer: TraceDefer | null = null;
  private lastTraced = false;
  private lastWeight = 0;
  private lastSamples = 0;
  private lastAccumulating = false;
  private lastSnapshot: SceneSnapshot | null = null;
  private lastSignature = '';
  private lastWorld: WorldView | null = null;
  private disposed = false;

  constructor(deps: RendererDeps) {
    this.backend = deps.backend;
    this.onTraceFailure = deps.onTraceFailure;
    this.camera = new CameraController(this.backend.surface.canvas, this.backend.aspect());
    this.resources = new RendererFrameResources(this.backend.targets);
    this.graph = new FrameGraph([
      new RasterPass(),
      new TracePass(this.backend.trace),
      new DenoisePass(this.backend.denoise),
      new CompositePass(this.backend.programs),
      new PostPass(this.backend.programs),
      new HeatmapPass(),
      new WirePass(),
      new OverlayPass(),
      new PresentPass(this.backend.programs),
    ]);
  }

  /** Reuses the last snapshot while its inputs are unchanged, then runs the pass graph. */
  render(view: RenderView, world: WorldView, versions: Readonly<VersionStamp>): FrameStats {
    const started = performance.now();
    const signature = snapshotSignature(view, versions, this.backend.textures.version);
    if (!this.lastSnapshot || this.lastWorld !== world || signature !== this.lastSignature) {
      const drawList = buildDrawList(world, view);
      this.lastSnapshot = this.sceneBuilder.build(world, drawList, versions);
      this.lastSignature = signature;
      this.lastWorld = world;
      this.backend.scene.apply(this.lastSnapshot);
    }
    this.backend.resize(view.viewport.width, view.viewport.height);
    this.camera.resize(view.viewport.width / Math.max(1, view.viewport.height));

    const size = this.frameSize(view);
    this.resources.ensure(size);

    const wantsTrace = traces(view);
    if (wantsTrace) this.prepareTrace(view.settings.trace, view, versions);
    const traceState = this.readiness(wantsTrace);

    resetTrace(this.traceOutput);
    const conditions: FrameConditions = {
      view,
      traceState,
      defer: traceState === 'ready' ? this.lastDefer : null,
    };
    const passes = this.graph.execute(conditions, pass => pass.execute({
      ...conditions,
      world,
      versions,
      resources: this.resources,
      commands: this.backend.commands,
      scene: this.backend.scene,
      trace: this.traceOutput,
    }));

    this.lastDefer = this.traceOutput.defer;
    this.lastTraced = this.traceOutput.traced;
    this.lastWeight = this.traceOutput.weight;
    this.lastSamples = this.traceOutput.samples;
    this.lastAccumulating = this.traceOutput.accumulating;
    return {
      passes,
      trace: { samples: this.lastSamples, accumulating: this.lastAccumulating },
      cpuMs: performance.now() - started,
    };
  }

  /** Reading of the last frame's trace gate. */
  traceStatus(view: RenderView): TraceStatus {
    if (!traces(view)) return 'inactive';
    if (this.traceFailure) return 'unsupported';
    if (!this.backend.trace.ready) return 'building';
    if (this.lastDefer) return this.lastDefer;
    if (!this.lastTraced) return 'building';
    if (this.lastWeight < 1) return 'blending';
    return 'traced';
  }

  /** Snapshot of the exportable world, built with the same translation as a frame. */
  buildExportSnapshot(
    world: WorldView,
    versions: Readonly<VersionStamp>,
    filter?: EntityFilter,
  ): SceneSnapshot {
    return this.sceneBuilder.buildExport(world, versions, filter);
  }

  resize(size: { readonly width: number; readonly height: number }): void {
    this.backend.resize(size.width, size.height);
    this.camera.resize(size.width / Math.max(1, size.height));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.lastSnapshot = null;
    this.lastWorld = null;
    this.graph.dispose();
    this.camera.dispose();
  }

  /** Builds the tracer on demand and stores changed settings once it exists. */
  private prepareTrace(
    settings: TraceSettings,
    view: RenderView,
    versions: Readonly<VersionStamp>,
  ): void {
    if (this.traceFailure) return;
    if (!this.backend.trace.ready) {
      void this.backend.trace
        .ensure(settings, view.camera, versions)
        .then(() => { this.traceSettings = settings; })
        .catch((error: unknown) => this.failTrace(error));
      return;
    }
    if (this.traceSettings && sameTraceSettings(this.traceSettings, settings)) return;
    this.traceSettings = settings;
    this.backend.trace.configure(settings);
  }

  /** Stores the probe verdict and reports it once. */
  private failTrace(error: unknown): void {
    const capability: RayTracingCapability = error instanceof RayTracingUnsupportedError
      ? { ok: false, failure: error.failure, detail: error.detail }
      : {
        ok: false,
        failure: 'setup-failed',
        detail: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      };
    this.traceFailure = capability;
    this.backend.trace.recover();
    this.onTraceFailure?.(capability);
  }

  /** Whether this frame can trace. */
  private readiness(wantsTrace: boolean): TraceReadiness {
    if (!wantsTrace) return 'inactive';
    if (this.traceFailure) return 'unsupported';
    return this.backend.trace.ready ? 'ready' : 'building';
  }

  /** Target sizes of one frame: drawing buffer for raster, CSS scale for tracing. */
  private frameSize(view: RenderView): FrameSize {
    const drawing = this.backend.surface.drawingBuffer;
    const scale = view.settings.trace.renderScale;
    return {
      width: Math.max(1, drawing.width),
      height: Math.max(1, drawing.height),
      traceWidth: Math.max(1, Math.round(view.viewport.width * scale)),
      traceHeight: Math.max(1, Math.round(view.viewport.height * scale)),
    };
  }
}

/** Field comparison of two trace settings; a new object with equal fields must not restart. */
function sameTraceSettings(a: TraceSettings, b: TraceSettings): boolean {
  return a.maxBounces === b.maxBounces
    && a.frameBudget === b.frameBudget
    && a.maxSamples === b.maxSamples
    && a.renderScale === b.renderScale
    && a.denoise === b.denoise
    && a.denoiseModel === b.denoiseModel
    && a.filterGlossyFactor === b.filterGlossyFactor
    && a.clampDirect === b.clampDirect
    && a.clampIndirect === b.clampIndirect;
}
