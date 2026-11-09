/** OIDN denoising over the traced radiance, before it is composited. */

import * as THREE from 'three/webgpu';
import type { OIDNDenoiser } from 'three-gpu-pathtracer/webgpu';
import type { CameraState, DenoiseModel } from '@/render/common';
import { bundledAssetUrl } from '@/base/platform/assetUrls';
import type { Commands } from '@/render/backend/commands';
import type { ProgramLibrary } from '@/render/backend/programs';
import type { SceneStore } from '@/render/backend/scene/sceneStore';
import {
  asTargetHandle, asTextureHandle, type TargetHandle, type TextureHandle,
} from '@/render/backend/types';

type InitUNetFromURL = (
  url: string,
  params: { device: GPUDevice },
  options: { aux?: boolean; hdr?: boolean; maxTileSize?: number | null; dynamicTile?: unknown },
) => Promise<unknown>;

/** Weight files live in assets/weights and reach the site root through publicDir. */
const OIDN_WEIGHTS_BASE = '/weights';

/** Guided and colour-only weight files per model size. */
const OIDN_WEIGHTS: Record<DenoiseModel, string> = {
  small: `${OIDN_WEIGHTS_BASE}/rt_hdr_alb_nrm_small.tza`,
  base: `${OIDN_WEIGHTS_BASE}/rt_hdr_alb_nrm.tza`,
};

/** Weights for the model without auxiliary buffers. */
const OIDN_COLOR_WEIGHTS = `${OIDN_WEIGHTS_BASE}/rt_hdr.tza`;

/** Frames between two denoise passes. */
const DENOISE_INTERVAL_FRAMES = 32;

/** A pass this long without finishing means the weights or the device failed silently. */
const DENOISE_TIMEOUT_MS = 15000;

/** Inputs one denoise opportunity carries. */
export interface DenoiseFrame {
  readonly radiance: TargetHandle;
  readonly samples: number;
  readonly weight: number;
  readonly accumulating: boolean;
  readonly restarted: boolean;
}

/**
 * Cleans sampled radiance between tracing and compositing. The filter waits for the fade-in,
 * cleans once, then refreshes on a cadence while samples keep arriving.
 */
export class DenoiseEngine {
  private denoiser: OIDNDenoiser | null = null;
  private loading: Promise<OIDNDenoiser | null> | null = null;
  private failedModel: DenoiseModel | null = null;
  private model: DenoiseModel = 'base';
  /** Traced frames the engine was free for, so a running pass does not consume the cadence. */
  private frame = 0;
  /** Frame the last pass finished on, or -1 before the first one of a pass run. */
  private finishedAt = -1;
  private denoisedSamples = 0;
  /** When the current pass started, in `performance.now()` milliseconds; 0 when none is running. */
  private startedAt = 0;
  private output: THREE.RenderTarget | null = null;
  private disposed = false;
  private generation = 0;

  constructor(
    private readonly renderer: THREE.WebGPURenderer,
    private readonly commands: Commands,
    private readonly programs: ProgramLibrary,
    private readonly onFailure?: (message: string) => void,
  ) { }

  /** Selects the model; a different model drops the weights and reloads on the next pass. */
  configure(model: DenoiseModel): void {
    if (this.model === model) return;
    this.model = model;
    this.failedModel = null;
    this.generation += 1;
    this.loading = null;
    this.denoiser?.dispose();
    this.denoiser = null;
    this.finishedAt = -1;
    this.denoisedSamples = 0;
    this.startedAt = 0;
    this.clearOutput();
  }

  /** Clears a failed load so turning denoising back on retries it. */
  retry(): void {
    this.failedModel = null;
  }

  /** Drops the cleaned image and starts the cadence over; the samples no longer match it. */
  reset(): void {
    this.denoiser?.reset();
    this.frame = 0;
    this.finishedAt = -1;
    this.denoisedSamples = 0;
    this.startedAt = 0;
    this.clearOutput();
  }

  /**
   * Cleans the radiance on the cadence the viewport wants: once when the raster blend-in ends,
   * once every {@link DENOISE_INTERVAL_FRAMES} frames after that, and once when the pass settles.
   * @returns the image the compositor should sample, or null while the raw radiance stands.
   */
  run(
    scene: SceneStore,
    camera: CameraState,
    frame: DenoiseFrame,
  ): TextureHandle | null {
    if (this.failedModel === this.model) return this.heldTexture();
    // A restart throws the samples away, so the filtered image goes with them.
    if (frame.restarted) {
      this.reset();
      return null;
    }

    const denoiser = this.denoiser;
    if (!denoiser) {
      this.ensure();
      return null;
    }

    // A finished pass is collected before the cadence is asked again. Asking first would let the
    // next pass reset the denoiser in the frame the image arrived, so a pass that takes longer
    // than the interval would throw away every result it produced and never reach the screen.
    if (!denoiser.running && denoiser.complete) {
      const cleaned = denoiser.texture;
      if (cleaned) this.publish(cleaned, frame.radiance);
      // The image now lives in this engine's own target, so the denoiser can start over.
      denoiser.reset();
      this.finishedAt = this.frame;
      this.startedAt = 0;
      return this.heldTexture();
    }

    this.frame += 1;
    // A running pass is spread over frames and finishes on its own; its result is picked up above.
    if (denoiser.running) return this.checkTimeout(denoiser);

    if (this.due(frame)) {
      denoiser.reset();
      this.denoisedSamples = frame.samples;
      this.startedAt = performance.now();
      this.apply(scene, camera, frame.radiance);
    }
    return this.heldTexture();
  }

  /** Gives up on a pass that never finished and reports why. */
  private checkTimeout(denoiser: OIDNDenoiser): TextureHandle | null {
    if (this.startedAt === 0 || performance.now() - this.startedAt <= DENOISE_TIMEOUT_MS) {
      return this.heldTexture();
    }
    // The weights load inside the library and a rejection there never reaches this code, so a
    // pass that never finishes is the only signal that denoising is unavailable.
    this.startedAt = 0;
    this.failedModel = this.model;
    this.denoiser = null;
    denoiser.dispose();
    this.clearOutput();
    this.onFailure?.('OIDN 降噪未能启动，已改用无降噪渲染；关闭再开启降噪可重试。');
    return this.heldTexture();
  }

  /** The held image as a sampled texture, or null when none is ready. */
  private heldTexture(): TextureHandle | null {
    return this.output ? asTextureHandle(this.output.texture) : null;
  }

  dispose(): void {
    this.disposed = true;
    this.generation += 1;
    this.denoiser?.dispose();
    this.denoiser = null;
    this.loading = null;
    this.clearOutput();
  }

  /** Whether the cadence says to clean the samples now. */
  private due(frame: DenoiseFrame): boolean {
    const denoiser = this.denoiser;
    if (!denoiser || denoiser.running) return false;
    // The raster blend-in would only smear a handful of samples, so the first pass waits until
    // the traced image stands on its own.
    if (frame.weight < 1) return false;
    // Nothing new was sampled since the last pass, so cleaning again would repeat the same image.
    if (frame.samples <= this.denoisedSamples) return false;
    if (this.finishedAt < 0) return true;
    // The last pass after the sampler settles, even when the interval has not elapsed yet.
    if (!frame.accumulating) return true;
    // Counted from the frame the previous pass finished on, so a slow pass does not spend the
    // interval it just used and start over immediately.
    return this.frame - this.finishedAt >= DENOISE_INTERVAL_FRAMES;
  }

  /** Copies a cleaned image into this engine's own target so it survives a denoiser reset. */
  private publish(source: THREE.Texture, radiance: TargetHandle): void {
    this.output = this.fitOutput(radiance);
    this.programs.blit(this.commands, asTextureHandle(source), asTargetHandle(this.output));
  }

  /** The output target, reallocated when the radiance target changed size. */
  private fitOutput(radiance: TargetHandle): THREE.RenderTarget {
    const current = this.output;
    if (current && current.width === radiance.width && current.height === radiance.height) {
      return current;
    }
    this.clearOutput();
    const output = new THREE.RenderTarget(radiance.width, radiance.height, {
      type: radiance.texture.type,
      depthBuffer: false,
    });
    output.texture.colorSpace = radiance.texture.colorSpace;
    this.output = output;
    return output;
  }

  /** Drops the held image; the next pass has to produce a fresh one. */
  private clearOutput(): void {
    this.output?.dispose();
    this.output = null;
  }

  /** One denoise step over the radiance target. */
  private apply(scene: SceneStore, camera: CameraState, radiance: TargetHandle): THREE.Texture | null {
    const denoiser = this.denoiser;
    if (!denoiser) {
      this.ensure();
      return null;
    }
    denoiser.setScene(scene.traceSceneRoot, this.commands.cameraFor(camera));
    return denoiser.update(radiance.texture) ?? null;
  }

  /** Loads and installs the model once; failures disable denoising instead of breaking the frame. */
  private ensure(): void {
    if (this.disposed || this.loading || this.failedModel === this.model) return;
    const generation = this.generation;
    const model = this.model;
    const loading: Promise<OIDNDenoiser | null> = Promise.all([
      import('oidn-webgpu'),
      import('three-gpu-pathtracer/webgpu'),
    ]).then(([oidn, pathtracer]) => {
      const initUNet = oidn.initUNetFromURL as unknown as InitUNetFromURL;
      const denoiser = new pathtracer.OIDNDenoiser({
        initUNetFromURL: initUNet,
        auxWeightsUrl: bundledAssetUrl(OIDN_WEIGHTS[model]),
        colorWeightsUrl: bundledAssetUrl(OIDN_COLOR_WEIGHTS),
      });
      if (this.disposed || generation !== this.generation) {
        denoiser.dispose();
        return null;
      }
      denoiser.init(this.renderer);
      this.denoiser = denoiser;
      return denoiser;
    }).catch((error: unknown) => {
      if (this.disposed || generation !== this.generation) return null;
      this.failedModel = model;
      console.warn('OIDN denoiser unavailable:', error);
      this.onFailure?.('OIDN 降噪权重加载失败，已改用无降噪渲染；关闭再开启降噪可重试。');
      return null;
    });
    this.loading = loading;
    void loading.finally(() => {
      if (this.loading === loading) this.loading = null;
    });
  }
}
