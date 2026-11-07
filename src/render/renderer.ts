/** The renderer one viewport owns: the private GPU context, the scene and the frame manager. */

import * as THREE from 'three/webgpu';
import type {
  CameraProjection, LightConfig, RayTracingConfig, ToneMappingMode, ViewConfig,
} from '@/model/types';
import { createDefaultRayTracing } from '@/model';
import type { GpuDeviceProvider } from '@/common/ports';
import { RenderContext } from '@/render/context';
import { SceneMgr } from '@/render/scene/manager';
import type { SceneCamera, ViewportCamera } from '@/render/scene/camera';
import { FALLBACK_BACKGROUND } from '@/render/scene/environment';
import { buildStageFloor } from '@/render/scene/floor';
import { TraceProxies } from '@/render/trace/proxies';
import { ViewMode } from '@/render/modes/viewMode';
import { FrameMgr, type FrameStats } from '@/render/frame/manager';
import { PathTraceBackend } from '@/render/trace/backend';
import type { TraceDefer } from '@/render/trace/gate';

/** State of the ray tracing pipeline the view is in. */
export type RayTraceState =
  | 'inactive'
  | 'building'
  | 'deforming'
  | 'moving'
  | 'blending'
  | 'traced'
  | 'unsupported';

/** What a viewport needs to create a renderer. */
export interface RendererOptions {
  readonly canvas: HTMLCanvasElement;
  /** View settings the viewport starts with. */
  readonly config: ViewConfig;
  /** Called once when OIDN weights cannot be loaded; denoising stays off afterwards. */
  readonly onDenoiseFailure?: (message: string) => void;
}

/**
 * Owns everything one viewport draws with: the GPU context, the scene (slots, camera, lights,
 * materials) and the frame manager. Callers hold a `Renderer` and nothing inside it; objects reach
 * the scene through named slots, and a frame is one `render()` call.
 */
export class Renderer {
  private readonly frame: FrameMgr;
  /** Watcher that keeps the drawing buffer in sync with the viewport's layout size. */
  private resizeObserverValue?: ResizeObserver;
  private disposedValue = false;

  private constructor(
    /** The three.js renderer this viewport manages. */
    private readonly renderer: THREE.WebGPURenderer,
    /** Canvas and GPU device the renderer created; only this class hands them out. */
    private readonly ctx: RenderContext,
    /** Scene data, camera and lights; the scene manager owns all of them. */
    readonly scene: SceneMgr,
    private readonly viewMode: ViewMode,
    private readonly traceBackend: PathTraceBackend,
    private readonly traceProxies: TraceProxies,
    private viewConfig: ViewConfig,
    onDenoiseFailure?: (message: string) => void,
  ) {
    this.frame = new FrameMgr({
      renderer,
      sceneMgr: scene,
      camera: scene.camera,
      viewMode,
      trace: traceBackend,
      onDenoiserFailure: onDenoiseFailure,
    });
    this.frame.setDenoiseModel(viewConfig.rayTracing?.denoiseModel ?? 'base');
  }

  /** Initializes WebGPU and builds the scene, the view mode and the frame manager. */
  static async create(options: RendererOptions): Promise<Renderer> {
    const renderer = await createThreeRenderer(options.canvas);
    const device = (renderer.backend as unknown as { device?: GPUDevice }).device;
    if (!device) {
      renderer.dispose();
      throw new Error('WebGPU renderer device unavailable after init');
    }
    const ctx = new RenderContext(options.canvas, device);

    const scene = new SceneMgr(ctx);
    const proxies = new TraceProxies();
    buildStageFloor(scene, proxies);
    scene.setBackground(FALLBACK_BACKGROUND);

    const viewMode = new ViewMode(scene, options.config);
    const traceBackend = new PathTraceBackend({
      renderer, device, sceneMgr: scene, camera: scene.camera, proxies,
    });
    scene.setLightInvalidator(() => traceBackend.invalidate());
    return new Renderer(
      renderer, ctx, scene, viewMode, traceBackend, proxies, options.config,
      options.onDenoiseFailure,
    );
  }

  /** Canvas the frame is presented on. */
  get canvas(): HTMLCanvasElement {
    return this.ctx.canvas;
  }

  /** Watcher that keeps the drawing buffer in sync with the viewport's layout size. */
  set resizeObserver(observer: ResizeObserver | undefined) {
    this.resizeObserverValue = observer;
  }

  /** Whether the renderer and its GPU resources were released. */
  get disposed(): boolean {
    return this.disposedValue;
  }

  /** View settings the next frame resolves into a spec. */
  get config(): ViewConfig {
    return this.viewConfig;
  }

  /** The camera the scene manager owns; runtime code drives it through the Renderer. */
  get camera(): SceneCamera {
    return this.scene.camera;
  }

  /** Aspect of the drawing surface, guarded against a hidden pane. */
  aspect(): number {
    return this.ctx.aspect();
  }

  /** The GPUDevice the renderer was initialized with; simulation resources share it. */
  gpuDevice(): GPUDevice {
    return this.ctx.device;
  }

  /** Same device behind the port the simulation declares, so it never reaches into three.js. */
  gpuProvider(): GpuDeviceProvider {
    return { device: () => this.ctx.device };
  }

  /** Draws one frame and reports what it did. */
  render(): FrameStats {
    return this.frame.draw();
  }

  /** Matches the drawing buffer and both cameras to a new viewport size. */
  resize(width: number, height: number): void {
    // Hidden viewports report zero size; keep the last valid drawing buffer.
    if (width <= 0 || height <= 0) return;
    this.renderer.setSize(width, height, false);
    this.scene.resizeCamera(width / height);
  }

  /** Swaps the viewport between perspective and orthographic cameras. */
  setCameraProjection(projection: CameraProjection): void {
    this.scene.setCameraProjection(projection);
  }

  /** The camera the viewport renders, picks and frames with. */
  activeCamera(): ViewportCamera {
    return this.scene.activeCamera();
  }

  /**
   * Applies the viewport's view settings, touching only the parts that changed.
   *
   * The view settings (fill, wire, backend, tone mapping) rebuild the mode spec, the denoise model
   * is handed to the denoise pass, and the tracer is built on the first ray-traced frame. A setting
   * the user did not touch keeps the samples the tracer already accumulated: only a real change in
   * the ray tracing settings restarts the pass.
   */
  async applyRenderConfig(config: ViewConfig): Promise<void> {
    const previous = this.viewConfig;
    this.viewConfig = config;

    if (viewChanged(previous, config)) this.viewMode.applyConfig(config);
    const traceChanged = rayTracingChanged(previous.rayTracing, config.rayTracing);
    if (traceChanged && config.rayTracing) this.frame.setDenoiseModel(config.rayTracing.denoiseModel);
    if (previous.rayTracing?.denoise !== true && config.rayTracing?.denoise === true) {
      this.frame.retryDenoise();
    }

    if (config.backend === 'pathtrace' && config.wire !== 'only') {
      const wasReady = this.traceBackend.ready;
      await this.traceBackend.ensure(config.rayTracing ?? createDefaultRayTracing());
      // A tracer that was just built already carries these settings; sending them again resets it.
      if (wasReady && traceChanged && config.rayTracing) this.traceBackend.applyConfig(config.rayTracing);
      return;
    }
    if (traceChanged && config.rayTracing) this.traceBackend.applyConfig(config.rayTracing);
  }

  /** Rebuilds the scene's lights from the project's lighting settings. */
  applyLights(lights: LightConfig): void {
    this.scene.applyLights(lights);
  }

  /** Chooses the curve the post chain resolves the linear image with. */
  setToneMapping(mode: ToneMappingMode): void {
    if (this.viewConfig.toneMapping === mode) return;
    this.viewConfig = { ...this.viewConfig, toneMapping: mode };
    this.viewMode.applyConfig(this.viewConfig);
  }

  /** Which gate the last drawn frame is behind. */
  traceState(): RayTraceState {
    if (this.viewConfig.backend !== 'pathtrace' || this.viewConfig.wire === 'only') return 'inactive';
    if (this.traceBackend.capability && !this.traceBackend.capability.ok) return 'unsupported';
    if (!this.traceBackend.ready) return 'building';
    const stats = this.frame.lastFrame;
    if (!stats) return 'building';
    if (stats.defer) return stats.defer;
    return stats.weight < 1 ? 'blending' : 'traced';
  }

  /** Samples behind the last traced frame. */
  traceSamples(): { samples: number; accumulating: boolean } {
    const tracer = this.traceBackend.active;
    return {
      samples: tracer?.sampleCount ?? 0,
      accumulating: tracer?.accumulating ?? false,
    };
  }

  /** Drops a failed tracer and leaves the next frame on the raster base. */
  recoverTrace(): void {
    this.traceBackend.recover();
  }

  /** Tells the tracer that lights or the environment changed. */
  invalidateTrace(): void {
    this.traceBackend.invalidate();
  }

  /** Frees both rendering paths, including a ray tracer still being loaded. */
  dispose(): void {
    if (this.disposedValue) return;
    this.disposedValue = true;
    this.traceBackend.dispose();
    this.traceProxies.clear();
    this.frame.dispose();
    this.viewMode.dispose();
    this.scene.dispose();
    this.resizeObserverValue?.disconnect();
    this.renderer.dispose();
  }
}

/** Creates and configures the three.js renderer this viewport owns. */
async function createThreeRenderer(canvas: HTMLCanvasElement): Promise<THREE.WebGPURenderer> {
  // Keep a nonzero drawing buffer while the viewport is hidden by the layout.
  const width = Math.max(1, canvas.clientWidth);
  const height = Math.max(1, canvas.clientHeight);
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, alpha: false });
  await renderer.init();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height, false);
  // Tone mapping belongs to the post chain, which decides the curve per project; leaving a curve
  // here would apply a second one to anything three draws straight to the canvas.
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = false;
  return renderer;
}

/** Whether the settings that reshape the look of a frame changed. */
function viewChanged(a: ViewConfig, b: ViewConfig): boolean {
  return a.fill !== b.fill || a.wire !== b.wire || a.backend !== b.backend
    || a.toneMapping !== b.toneMapping
    || a.wireOptions.color !== b.wireOptions.color
    || a.wireOptions.depth !== b.wireOptions.depth;
}

/** Whether the ray tracing settings changed; every one of them restarts the sample pass. */
function rayTracingChanged(a: RayTracingConfig | undefined, b: RayTracingConfig | undefined): boolean {
  if (!a || !b) return a !== b;
  return a.maxBounces !== b.maxBounces || a.frameBudget !== b.frameBudget
    || a.maxSamples !== b.maxSamples || a.renderScale !== b.renderScale
    || a.denoise !== b.denoise || a.denoiseModel !== b.denoiseModel
    || a.filterGlossyFactor !== b.filterGlossyFactor
    || a.clampDirect !== b.clampDirect || a.clampIndirect !== b.clampIndirect;
}

export type { FrameStats, TraceDefer };
