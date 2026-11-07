/** Pass 3: OIDN denoising over the traced radiance, before it is composited. */

import * as THREE from 'three/webgpu';
import { texture, uv } from 'three/tsl';
import type { OIDNDenoiser } from 'three-gpu-pathtracer/webgpu';
import { bundledAssetUrl } from '@/common/platform/assetUrls';
import type { DenoiseModel } from '@/model/types';
import { drawFullScreen } from '@/render/frame/quad';
import type { FrameContext, FramePass, PassId } from '@/render/frame/pass';

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

/**
 * Frames between two denoise passes. A pass is tiled over several frames, so it runs on a cadence
 * rather than every frame; 32 frames is roughly half a second of sampling.
 */
const DENOISE_INTERVAL_FRAMES = 32;

/**
 * Cleans the sampled radiance between tracing and compositing.
 *
 * The filter is not something to run continuously: at low sample counts it invents structure that
 * later samples contradict. So it waits for the raster-to-traced fade-in to finish, cleans once,
 * and then refreshes every {@link DENOISE_INTERVAL_FRAMES} frames while samples keep arriving.
 *
 * The cleaned image is copied into a target of this pass's own. The denoiser owns its output
 * texture and drops it on every restart, so without this copy the frames between two passes would
 * fall back to raw noise.
 */
export class DenoisePass implements FramePass {
  readonly id: PassId = 'denoise';
  private denoiser: OIDNDenoiser | null = null;
  private loading: Promise<OIDNDenoiser | null> | null = null;
  private failedModel: DenoiseModel | null = null;
  private model: DenoiseModel = 'base';
  /** Frames drawn since the current sample pass started. */
  private frame = 0;
  /** Frame the last denoise pass started on; -1 while this sample pass has had none. */
  private denoisedAt = -1;
  /** Samples the last denoise pass was given, so an unchanged image is never cleaned twice. */
  private denoisedSamples = 0;
  /** Holds the last cleaned image, independent of the denoiser's own texture lifetime. */
  private output: THREE.RenderTarget | null = null;
  private blit: THREE.MeshBasicNodeMaterial | null = null;
  private blitSource: THREE.Texture | null = null;
  /** Whether dispose() ran; a late weight load must not install a denoiser. */
  private disposed = false;
  /** Increments whenever the selected model or lifetime changes; stale loads are dropped. */
  private generation = 0;

  constructor(private readonly onFailure?: (message: string) => void) { }

  /** Selects the model; a different model drops the weights and reloads on the next pass. */
  setModel(model: DenoiseModel): void {
    if (this.model === model) return;
    this.model = model;
    this.failedModel = null;
    this.generation += 1;
    this.loading = null;
    this.denoiser?.dispose();
    this.denoiser = null;
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
    this.denoisedAt = -1;
    this.denoisedSamples = 0;
    this.clearOutput();
  }

  enabled(ctx: FrameContext): boolean {
    if (!ctx.spec.denoises || this.failedModel === this.model) return false;
    // A restart also has to reach this pass on frames that drew nothing, or the cadence would keep
    // counting from the view the camera has already left.
    return ctx.trace.restarted || ctx.trace.radiance !== null;
  }

  run(ctx: FrameContext): void {
    if (ctx.trace.restarted) {
      this.reset();
      return;
    }
    if (ctx.trace.radiance === null) return;
    this.frame += 1;

    if (this.due(ctx)) {
      this.denoiser?.reset();
      this.denoisedAt = this.frame;
      this.denoisedSamples = ctx.trace.samples;
    }
    // The guide buffers are rasterized from the scene, so they must see the same objects the
    // tracer walked: the overlays and gizmos are raster-only and would otherwise steer the filter.
    const cleaned = ctx.sceneMgr.withoutUntracedLayers(() => this.apply(
      ctx.renderer, ctx.sceneMgr.scene, ctx.camera.camera, ctx.targets.radiance,
    ));
    // Only a finished pass is a whole image. The denoiser hands back a buffer after every tile, and
    // the tiles it has not reached yet are still empty — copying one of those leaves black blocks
    // that never get replaced, because the copy happens once per pass.
    if (cleaned && this.denoiser?.complete) this.publish(ctx.renderer, cleaned, ctx.targets.radiance);
    // Between two passes, and until the first one finishes, the last cleaned image stands in. It is
    // the image the user was looking at, which beats dropping back to noise.
    if (this.output) ctx.trace.radiance = this.output.texture;
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
  private due(ctx: FrameContext): boolean {
    const denoiser = this.denoiser;
    if (!denoiser || denoiser.running) return false;
    // The raster base is still fading out; cleaning here means cleaning the noisiest frame there is.
    // A pass that finished below the fade-in threshold is exempt — its samples will not improve.
    if (ctx.trace.weight < 1 && ctx.trace.accumulating) return false;
    if (this.denoisedAt < 0) return true;
    // Nothing new accumulated since the last pass; re-running would produce the same image.
    if (ctx.trace.samples <= this.denoisedSamples) return false;
    // The samples have stopped growing: clean the final image now instead of waiting out the
    // interval, or the last thing on screen would be a pass from far fewer samples.
    if (!ctx.trace.accumulating) return true;
    return this.frame - this.denoisedAt >= DENOISE_INTERVAL_FRAMES;
  }

  /**
   * Copies a cleaned image into this pass's own target, so it survives the denoiser resetting.
   * A new material each time the source changes: three caches the pipeline against the material.
   */
  private publish(renderer: THREE.WebGPURenderer, source: THREE.Texture, size: THREE.RenderTarget): void {
    if (source === this.blitSource) return;
    this.output = this.fitOutput(size);
    this.blit?.dispose();
    const blit = new THREE.MeshBasicNodeMaterial({ depthTest: false, depthWrite: false, toneMapped: false });
    // The denoiser writes a plain image; the quad's UV starts at the bottom, so sampling flips.
    blit.colorNode = texture(source, uv().flipY());
    this.blit = blit;
    this.blitSource = source;
    drawFullScreen(renderer, blit, this.output);
  }

  /** The output target, reallocated when the radiance target changed size. */
  private fitOutput(radiance: THREE.RenderTarget): THREE.RenderTarget {
    const current = this.output;
    if (current && current.width === radiance.width && current.height === radiance.height) {
      return current;
    }
    this.clearOutput();
    this.output = new THREE.RenderTarget(radiance.width, radiance.height, {
      type: radiance.texture.type,
      depthBuffer: false,
    });
    this.output.texture.colorSpace = radiance.texture.colorSpace;
    return this.output;
  }

  /** Drops the held image; the next pass has to produce a fresh one. */
  private clearOutput(): void {
    this.output?.dispose();
    this.output = null;
    this.blit?.dispose();
    this.blit = null;
    this.blitSource = null;
  }

  /**
   * One denoise step over the radiance target.
   * @returns the cleaned texture, or null while the model loads or a pass has not tiled yet.
   */
  private apply(
    renderer: THREE.WebGPURenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    radiance: THREE.RenderTarget,
  ): THREE.Texture | null {
    const denoiser = this.denoiser;
    if (!denoiser) {
      this.ensure(renderer);
      return null;
    }
    // Auxiliary buffers are rendered from the scene, so the guide matches the traced frame.
    denoiser.setScene(scene, camera);
    // The denoiser takes the radiance texture: it reads its size for the auxiliary buffers and
    // writes the result into a texture of its own, leaving the render target untouched.
    return denoiser.update(radiance.texture) ?? null;
  }

  /** Loads and installs the model once; failures disable denoising instead of breaking the frame. */
  private ensure(renderer: THREE.WebGPURenderer): void {
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
      // Drop a denoiser whose model changed or whose pass was disposed while the weights loaded.
      if (this.disposed || generation !== this.generation) {
        denoiser.dispose();
        return null;
      }
      denoiser.init(renderer);
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
