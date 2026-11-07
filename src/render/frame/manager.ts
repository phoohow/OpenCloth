/** The frame: the seven passes every viewport draws with, called in a fixed order. */

import type { SceneMgr } from '@/render/scene/manager';
import type { SceneCamera } from '@/render/scene/camera';
import type { ViewMode } from '@/render/modes/viewMode';
import type { TraceBackend } from '@/render/trace/backend';
import type { TraceDefer } from '@/render/trace/gate';
import type { DenoiseModel } from '@/model/types';
import * as THREE from 'three/webgpu';
import type { FrameContext, FramePass, PassId, TraceOutput } from '@/render/frame/pass';
import { idleTrace, resetTrace } from '@/render/frame/pass';
import { FrameTargets, type FrameSize } from '@/render/frame/targets';
import { PostChain } from '@/render/frame/post/chain';
import { ScenePass } from '@/render/frame/passes/scenePass';
import { TracePass } from '@/render/frame/passes/tracePass';
import { DenoisePass } from '@/render/frame/passes/denoisePass';
import { CompositePass } from '@/render/frame/passes/compositePass';
import { PostPass } from '@/render/frame/passes/postPass';
import { OverlayPass } from '@/render/frame/passes/overlayPass';
import { PresentPass } from '@/render/frame/passes/presentPass';

/** What the last drawn frame did, for the viewport readout. */
export interface FrameStats {
  /** Gate that kept the frame on the raster base. */
  defer: TraceDefer | null;
  /** Weight of the traced image over the raster base. */
  weight: number;
  /** Passes that actually ran this frame, in order. */
  passes: readonly PassId[];
}

/** Objects the frame draws with. */
export interface FrameDeps {
  /** The three.js renderer the Renderer owns and this frame draws with. */
  readonly renderer: THREE.WebGPURenderer;
  /** The scene manager, not the three.js scene; that one is `sceneMgr.scene`. */
  readonly sceneMgr: SceneMgr;
  readonly camera: SceneCamera;
  readonly viewMode: ViewMode;
  readonly trace: TraceBackend;
  readonly onDenoiserFailure?: (message: string) => void;
}

/**
 * Runs one frame by calling its passes in a fixed order:
 *
 *   scene → trace → denoise → composite → post → overlay → present
 *
 * Each pass is a field of this class and is called on its own line in {@link FrameMgr.draw}, so a
 * breakpoint on one line stops exactly at that pass. The mode never changes the order; it only
 * decides which passes take part. The compositor always resolves an image, so everything after it
 * is independent of whether tracing ran.
 */
export class FrameMgr {
  private readonly targets = new FrameTargets();
  private readonly traceOutput: TraceOutput = idleTrace();
  private readonly postChain = new PostChain();
  private readonly scenePass: FramePass = new ScenePass();
  private readonly tracePass: FramePass;
  private readonly denoisePass: DenoisePass;
  private readonly compositePass: FramePass = new CompositePass();
  private readonly postPass: FramePass;
  private readonly overlayPass: FramePass = new OverlayPass();
  private readonly presentPass: FramePass = new PresentPass();
  /** Reused drawing and CSS sizes, so measuring a frame allocates nothing. */
  private readonly drawingSize = new THREE.Vector2();
  private readonly cssSize = new THREE.Vector2();
  /** What the last drawn frame did, read by the viewport readout. */
  lastFrame: FrameStats | null = null;

  constructor(private readonly deps: FrameDeps) {
    this.tracePass = new TracePass(deps.trace);
    this.denoisePass = new DenoisePass(deps.onDenoiserFailure);
    this.postPass = new PostPass(this.postChain);
  }

  /** Model the denoise pass loads on first use. */
  setDenoiseModel(model: DenoiseModel): void {
    this.denoisePass.setModel(model);
  }

  /** Retries a denoise model whose weight load failed. */
  retryDenoise(): void {
    this.denoisePass.retry();
  }

  /** Draws one frame and reports what it did. */
  draw(): FrameStats {
    const { renderer, sceneMgr, camera, viewMode, trace } = this.deps;
    sceneMgr.updateMatrixWorld();
    camera.camera.updateMatrixWorld();
    viewMode.sync();

    const size = this.measure(trace.active?.renderScale ?? 1);
    // A resized buffer invalidates whatever the denoiser accumulated.
    if (this.targets.ensure(size)) this.denoisePass.reset();

    resetTrace(this.traceOutput);
    const ctx: FrameContext = {
      renderer,
      sceneMgr,
      camera,
      viewMode,
      targets: this.targets,
      spec: viewMode.current,
      trace: this.traceOutput,
      composite: null,
    };
    const passes: PassId[] = [];
    this.run(this.scenePass, ctx, passes);
    this.run(this.tracePass, ctx, passes);
    this.run(this.denoisePass, ctx, passes);
    this.run(this.compositePass, ctx, passes);
    this.run(this.postPass, ctx, passes);
    this.run(this.overlayPass, ctx, passes);
    this.run(this.presentPass, ctx, passes);

    sceneMgr.resetLayerVisibility();
    const stats: FrameStats = {
      defer: this.traceOutput.defer,
      weight: this.traceOutput.weight,
      passes,
    };
    this.lastFrame = stats;
    return stats;
  }

  /** Sizes of the buffers this frame needs, from the drawing surface and the tracer's scale. */
  private measure(renderScale: number): FrameSize {
    this.deps.renderer.getDrawingBufferSize(this.drawingSize);
    this.deps.renderer.getSize(this.cssSize);
    return {
      width: Math.max(1, Math.floor(this.drawingSize.x)),
      height: Math.max(1, Math.floor(this.drawingSize.y)),
      traceWidth: Math.max(1, Math.floor(this.cssSize.x * renderScale)),
      traceHeight: Math.max(1, Math.floor(this.cssSize.y * renderScale)),
    };
  }

  /** Runs one pass when it takes part in this frame and records it in the pass list. */
  private run(pass: FramePass, ctx: FrameContext, passes: PassId[]): void {
    if (!pass.enabled(ctx)) return;
    pass.run(ctx);
    passes.push(pass.id);
  }

  /** Frees every target, the post chain and the passes that own GPU resources. */
  dispose(): void {
    this.targets.dispose();
    this.postChain.dispose();
    this.scenePass.dispose?.();
    this.tracePass.dispose?.();
    this.denoisePass.dispose?.();
    this.compositePass.dispose?.();
    this.postPass.dispose?.();
    this.overlayPass.dispose?.();
    this.presentPass.dispose?.();
  }
}
