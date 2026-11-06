/** The frame: the seven stages every viewport draws with, called in a fixed order. */

import type { ViewportDevice } from '@/render/device/viewport';
import type { SceneMgr } from '@/render/scene/manager';
import type { SceneCamera } from '@/render/scene/camera';
import type { ModeRegistry } from '@/render/modes/registry';
import type { TraceBackend } from '@/render/trace/backend';
import type { TraceDefer } from '@/render/trace/gate';
import type { LayerId } from '@/render/scene/layers';
import type { FrameContext, FramePass, PassId, TraceOutput } from '@/render/frame/pass';
import { idleTrace, resetTrace } from '@/render/frame/pass';
import { FrameTargets, measureFrame } from '@/render/frame/targets';
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
  /** Scene layers drawn as the lit image. */
  layers: readonly LayerId[];
  /** Whether traced samples reached the screen. */
  traced: boolean;
  /** Gate that kept the frame on the raster base. */
  defer: TraceDefer | null;
  /** Samples per pixel behind the traced image. */
  samples: number;
  /** Weight of the traced image over the raster base. */
  weight: number;
  /** Stages that actually ran this frame, in order. */
  steps: readonly PassId[];
}

/** Objects the frame draws with. */
export interface FrameDeps {
  readonly device: ViewportDevice;
  /** The scene manager, not the three.js scene; that one is `sceneMgr.scene`. */
  readonly sceneMgr: SceneMgr;
  readonly camera: SceneCamera;
  readonly modes: ModeRegistry;
  readonly trace: TraceBackend;
  readonly onDenoiserFailure?: (message: string) => void;
}

/**
 * Runs one frame by calling its stages in a fixed order:
 *
 *   scene → trace → denoise → composite → post → overlay → present
 *
 * Each stage is a field of this class and is called on its own line in {@link FrameMgr.draw}, so a
 * breakpoint on one line stops exactly at that stage. The mode never changes the order; it only
 * decides which stages take part. The compositor always resolves an image, so everything after it
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
  /** What the last drawn frame did, read by the viewport readout. */
  lastFrame: FrameStats | null = null;

  constructor(private readonly deps: FrameDeps) {
    this.tracePass = new TracePass(deps.trace);
    this.denoisePass = new DenoisePass(deps.onDenoiserFailure);
    this.postPass = new PostPass(this.postChain);
  }

  /** Model the denoise stage loads on first use. */
  setDenoiseModel(model: 'small' | 'base'): void {
    this.denoisePass.setModel(model);
  }

  /** Drops the accumulated denoise result; called when the sample pass restarts. */
  resetDenoise(): void {
    this.denoisePass.reset();
  }

  /** Draws one frame and reports what it did. */
  draw(): FrameStats {
    const { device, sceneMgr, camera, modes, trace } = this.deps;
    sceneMgr.updateMatrixWorld();
    camera.camera.updateMatrixWorld();
    modes.sync();

    const size = measureFrame(device, trace.active?.renderScale ?? 1);
    // A resized buffer invalidates whatever the denoiser accumulated.
    if (this.targets.ensure(size)) this.denoisePass.reset();

    resetTrace(this.traceOutput);
    const ctx: FrameContext = {
      device,
      sceneMgr,
      camera,
      modes,
      targets: this.targets,
      size,
      spec: modes.current,
      trace: this.traceOutput,
      resolved: null,
    };
    const steps: PassId[] = [];
    this.run(this.scenePass, ctx, steps);
    this.run(this.tracePass, ctx, steps);
    this.run(this.denoisePass, ctx, steps);
    this.run(this.compositePass, ctx, steps);
    this.run(this.postPass, ctx, steps);
    this.run(this.overlayPass, ctx, steps);
    this.run(this.presentPass, ctx, steps);

    sceneMgr.resetLayerVisibility();
    const stats: FrameStats = {
      layers: ctx.spec.layers,
      traced: this.traceOutput.traced,
      defer: this.traceOutput.defer,
      samples: this.traceOutput.samples,
      weight: this.traceOutput.weight,
      steps,
    };
    this.lastFrame = stats;
    return stats;
  }

  /** Runs one stage when it takes part in this frame and records it in the step list. */
  private run(pass: FramePass, ctx: FrameContext, steps: PassId[]): void {
    if (!pass.enabled(ctx)) return;
    pass.run(ctx);
    steps.push(pass.id);
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
