/** The renderer one viewport owns: the GPU context, the scene and the frame manager. */

import type {
  CameraProjection, LightConfig, RayTracingConfig, RenderConfig, ToneMappingMode,
} from '@/model/types';
import { createDefaultRayTracing } from '@/model';
import type { GpuDeviceProvider } from '@/common/ports';
import { ViewportDevice, rendererDevice } from '@/render/device/viewport';
import { SceneMgr } from '@/render/scene/manager';
import { SceneCamera, type ViewportCamera } from '@/render/scene/camera';
import { SceneLights } from '@/render/scene/lights';
import { FALLBACK_BACKGROUND } from '@/render/scene/environment';
import { buildStageFloor } from '@/render/scene/floor';
import { TraceProxies } from '@/render/trace/proxies';
import { ModeRegistry } from '@/render/modes/registry';
import { FrameMgr, type FrameStats } from '@/render/frame/manager';
import { PathTraceBackend } from '@/render/trace/backend';
import type { TraceDefer } from '@/render/trace/gate';

/** Stage of the ray tracing pipeline the view is in. */
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
  /** Render settings the project starts with. */
  readonly config: RenderConfig;
  /** Called once when OIDN weights cannot be loaded; denoising stays off afterwards. */
  readonly onDenoiseFailure?: (message: string) => void;
}

/**
 * Owns everything one viewport draws with: the GPU context, the scene (slots, camera, lights,
 * materials) and the frame manager. Callers hold a `Renderer` and nothing inside it; objects reach
 * the scene through named slots, and a frame is one `render()` call.
 */
export class Renderer {
  private constructor(
    private readonly device: ViewportDevice,
    /** Scene data: four layers, named slots, the camera, lights and the environment. */
    readonly scene: SceneMgr,
    /** The two cameras and the orbit gestures of this viewport. */
    readonly camera: SceneCamera,
    private readonly lights: SceneLights,
    private readonly modes: ModeRegistry,
    private readonly traceBackend: PathTraceBackend,
    private readonly traceProxies: TraceProxies,
    private readonly frame: FrameMgr,
    private renderConfig: RenderConfig,
  ) { }

  /** Initializes WebGPU and builds the scene, the modes and the frame manager. */
  static async create(options: RendererOptions): Promise<Renderer> {
    const device = await ViewportDevice.create(options.canvas);
    const scene = new SceneMgr();
    const proxies = new TraceProxies();
    buildStageFloor(scene, proxies);
    scene.setBackground(FALLBACK_BACKGROUND);

    const camera = new SceneCamera(device);
    const modes = new ModeRegistry(scene, options.config);
    const traceBackend = new PathTraceBackend({ device, sceneMgr: scene, camera, proxies });
    const frame = new FrameMgr({
      device,
      sceneMgr: scene,
      camera,
      modes,
      trace: traceBackend,
      onDenoiserFailure: options.onDenoiseFailure,
    });
    const lights = new SceneLights(scene, () => traceBackend.invalidate());
    return new Renderer(
      device, scene, camera, lights, modes, traceBackend, proxies, frame, options.config,
    );
  }

  /** Canvas the frame is presented on. */
  get canvas(): HTMLCanvasElement {
    return this.device.canvas;
  }

  /** Watcher that keeps the drawing buffer in sync with the viewport's layout size. */
  set resizeObserver(observer: ResizeObserver | undefined) {
    this.device.resizeObserver = observer;
  }

  /** Whether the renderer and its GPU context were released. */
  get disposed(): boolean {
    return this.device.disposed;
  }

  /** Render settings the next frame resolves into a spec. */
  get config(): RenderConfig {
    return this.renderConfig;
  }

  /** Aspect of the drawing surface, guarded against a hidden pane. */
  aspect(): number {
    return this.device.aspect();
  }

  /** The GPUDevice the renderer was initialized with; simulation resources share it. */
  gpuDevice(): GPUDevice {
    return rendererDevice(this.device);
  }

  /** Same device behind the port the simulation declares, so it never reaches into three.js. */
  gpuProvider(): GpuDeviceProvider {
    return { device: () => rendererDevice(this.device) };
  }

  /** Draws one frame and reports what it did. */
  render(): FrameStats {
    return this.frame.draw();
  }

  /** Matches the drawing buffer and both cameras to a new viewport size. */
  resize(width: number, height: number): void {
    // Hidden viewports report zero size; keep the last valid drawing buffer.
    if (width <= 0 || height <= 0) return;
    this.device.resize(width, height);
    this.camera.resize(width / height);
  }

  /** Swaps the viewport between perspective and orthographic cameras. */
  setCameraProjection(projection: CameraProjection): void {
    this.camera.setProjection(projection);
  }

  /** The camera the viewport renders, picks and frames with. */
  activeCamera(): ViewportCamera {
    return this.camera.camera;
  }

  /**
   * Applies the project's render settings, touching only the parts that changed.
   *
   * The view settings (fill, wire, backend, tone mapping) rebuild the mode spec, the denoise model
   * is handed to the denoise stage, and the tracer is built on the first ray-traced frame. A setting
   * the user did not touch keeps the samples the tracer already accumulated: only a real change in
   * the ray tracing settings restarts the pass.
   */
  async applyRenderConfig(config: RenderConfig): Promise<void> {
    const previous = this.renderConfig;
    this.renderConfig = config;

    if (viewChanged(previous, config)) this.modes.applyConfig(config);
    const traceChanged = rayTracingChanged(previous.rayTracing, config.rayTracing);
    if (traceChanged && config.rayTracing) this.frame.setDenoiseModel(config.rayTracing.denoiseModel);

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
    this.lights.applyConfig(lights);
  }

  /** Chooses the curve the post chain resolves the linear image with. */
  setToneMapping(mode: ToneMappingMode): void {
    if (this.renderConfig.toneMapping === mode) return;
    this.renderConfig = { ...this.renderConfig, toneMapping: mode };
    this.modes.applyConfig(this.renderConfig);
  }

  /** Which gate the last drawn frame is behind. */
  traceState(): RayTraceState {
    if (this.renderConfig.backend !== 'pathtrace' || this.renderConfig.wire === 'only') return 'inactive';
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
    if (this.device.disposed) return;
    this.traceBackend.dispose();
    this.traceProxies.clear();
    this.frame.dispose();
    this.modes.dispose();
    this.camera.dispose();
    this.scene.dispose();
    this.device.dispose();
  }
}

/** Whether the settings that reshape the look of a frame changed. */
function viewChanged(a: RenderConfig, b: RenderConfig): boolean {
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
