/** Owns the WebGPU device, the three renderer and the backend caches. */

import * as THREE from 'three/webgpu';
import type { DevicePort, ExportPort } from '@/render/common';
import { AssetStore } from '@/render/backend/assets/assetStore';
import { Commands } from '@/render/backend/commands';
import { DenoiseEngine } from '@/render/backend/denoise/denoiseEngine';
import { ExportAdapter } from '@/render/backend/export/exportAdapter';
import { ProgramLibrary } from '@/render/backend/programs';
import { SceneStore } from '@/render/backend/scene/sceneStore';
import { Surface } from '@/render/backend/surface';
import { TargetPool } from '@/render/backend/targets';
import { TextureCache } from '@/render/backend/textures';
import { TraceEngine } from '@/render/backend/trace/traceEngine';
import type { BackendOptions } from '@/render/backend/types';

/**
 * Owns the renderer, device, commands, targets, textures, assets, scene store, programs, tracer,
 * denoiser and exporter. Upper layers see only the neutral interfaces returned here.
 */
export class Backend {
  readonly surface: Surface;
  readonly commands: Commands;
  readonly targets = new TargetPool();
  readonly programs = new ProgramLibrary();
  readonly textures = new TextureCache();
  readonly assets = new AssetStore();
  readonly scene: SceneStore;
  readonly trace: TraceEngine;
  readonly denoise: DenoiseEngine;
  readonly export: ExportPort;
  /** The same device behind the port the simulation declares. */
  readonly device: DevicePort;
  private disposedValue = false;

  private constructor(
    readonly renderer: THREE.WebGPURenderer,
    device: GPUDevice,
    canvas: HTMLCanvasElement,
    private readonly onDenoiseFailure?: (message: string) => void,
  ) {
    this.device = { device: () => device };
    this.surface = new Surface(canvas, renderer);
    this.commands = new Commands(renderer);
    this.scene = new SceneStore(this.assets, this.textures);
    this.commands.bindScene((handle, stage) => this.scene.sceneFor(handle, stage));
    void installAreaLightSupport();
    this.trace = new TraceEngine({
      renderer,
      device,
      scene: this.scene,
      commands: this.commands,
      viewSize: () => ({
        x: this.surface.canvas.clientWidth,
        y: this.surface.canvas.clientHeight,
      }),
    });
    this.denoise = new DenoiseEngine(
      renderer, this.commands, this.programs,
      message => this.onDenoiseFailure?.(message),
    );
    this.export = new ExportAdapter(this.assets, this.textures);
  }

  /** Initializes WebGPU and builds the shared resources one viewport owns. */
  static async create(
    canvas: HTMLCanvasElement,
    options: BackendOptions = {},
  ): Promise<Backend> {
    const renderer = await createThreeRenderer(canvas, options.antialias ?? false);
    const device = (renderer.backend as unknown as { device?: GPUDevice }).device;
    if (!device) {
      renderer.dispose();
      throw new Error('WebGPU renderer device unavailable after init');
    }
    const backend = new Backend(renderer, device, canvas, options.onDenoiseFailure);
    void device.lost.then(info => {
      // Ignore loss notifications that arrive after an intentional dispose.
      if (backend.disposed) return;
      options.onDeviceLost?.(String(info.reason));
    });
    return backend;
  }

  /** Whether the GPU resources were released. */
  get disposed(): boolean {
    return this.disposedValue;
  }

  /** Matches the drawing buffer to a new viewport size. */
  resize(width: number, height: number): void {
    this.surface.resize(width, height);
  }

  /** Frees every GPU resource. */
  dispose(): void {
    if (this.disposedValue) return;
    this.disposedValue = true;
    this.trace.dispose();
    this.denoise.dispose();
    this.scene.dispose();
    this.assets.dispose();
    this.textures.dispose();
    this.targets.dispose();
    this.programs.dispose();
    this.renderer.dispose();
  }
}

/** Loads the LTC tables rect area lights need; failure leaves area lights unlit. */
async function installAreaLightSupport(): Promise<void> {
  try {
    const { RectAreaLightTexturesLib } = await import(
      'three/examples/jsm/lights/RectAreaLightTexturesLib.js',
    );
    (THREE as unknown as { RectAreaLightNode: { setLTC(lib: unknown): void } })
      .RectAreaLightNode.setLTC(RectAreaLightTexturesLib.init());
  } catch (error) {
    console.warn('Rect area light support unavailable:', error);
  }
}

/** Creates and configures the three.js renderer the backend owns. */
async function createThreeRenderer(
  canvas: HTMLCanvasElement, antialias: boolean,
): Promise<THREE.WebGPURenderer> {
  const width = Math.max(1, canvas.clientWidth);
  const height = Math.max(1, canvas.clientHeight);
  const renderer = new THREE.WebGPURenderer({ canvas, antialias, alpha: false });
  await renderer.init();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height, false);
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = false;
  return renderer;
}
