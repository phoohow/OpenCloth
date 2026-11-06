/** Stage 2: optional path-traced radiance, left in the radiance target for the post chain. */

import type { FrameContext, FramePass, PassId } from '@/render/frame/pass';
import type { TraceBackend } from '@/render/trace/backend';

/**
 * The only place a frame asks for traced samples. It draws radiance and reports what it got;
 * denoising and compositing are post effects, not part of this stage.
 */
export class TracePass implements FramePass {
  readonly id: PassId = 'trace';

  constructor(private readonly trace: TraceBackend) { }

  enabled(ctx: FrameContext): boolean {
    return ctx.spec.traces && this.trace.active !== null;
  }

  run(ctx: FrameContext): void {
    const tracer = this.trace.active;
    if (!tracer) return;
    const frame = tracer.render(ctx.sceneMgr, ctx.camera.camera, ctx.targets.radiance);
    ctx.trace.samples = frame.samples;
    // A pass that restarted has nothing in common with the samples the denoiser cleaned before.
    ctx.trace.restarted = frame.samples <= 1;
    ctx.trace.accumulating = frame.accumulating;
    if (!frame.drawn) {
      ctx.trace.defer = frame.defer;
      return;
    }
    ctx.trace.traced = true;
    ctx.trace.weight = frame.weight;
    ctx.trace.radiance = ctx.targets.radiance.texture;
  }
}
