/** Draws one progressive path-tracing step into the radiance target. */

import type { TraceDefer } from '@/render/common';
import type { TraceEngine } from '@/render/backend/trace/traceEngine';
import type { FrameConditions, PassContext, RenderPass } from '@/render/renderer/frame/pass';

/** Trace slot: advances the progressive path tracer one step. */
export class TracePass implements RenderPass {
  readonly id = 'trace';
  readonly slot = 'trace' as const;
  readonly reads = [] as const;
  readonly writes = ['radiance'] as const;
  private lastSamples = 0;
  private lastDefer: TraceDefer | null = null;

  constructor(private readonly tracer: TraceEngine) { }

  enabled(frame: FrameConditions): boolean {
    return frame.traceState === 'ready' && frame.view.settings.wire !== 'only';
  }

  execute(ctx: PassContext): void {
    const result = this.tracer.trace(
      ctx.view.camera,
      ctx.versions,
      ctx.resources.radiance,
    );
    const deferred = result.defer !== null;
    // A frame that leaves the raster base throws its samples away, so the first traced frame
    // afterwards is a restart even though the sample counter starts from zero in both.
    const resumed = !deferred && this.lastDefer !== null;
    // The readback lags and can land out of order, so only a clear drop counts as a restart.
    const dropped = this.lastSamples > 0 && result.samples * 2 < this.lastSamples;
    ctx.trace.defer = result.defer;
    ctx.trace.samples = result.samples;
    ctx.trace.weight = result.weight;
    ctx.trace.accumulating = result.accumulating;
    ctx.trace.traced = result.drawn;
    ctx.trace.restarted = deferred || resumed || dropped;
    this.lastDefer = result.defer;
    this.lastSamples = result.samples;
    if (result.drawn) ctx.trace.radiance = ctx.resources.texture(ctx.resources.radiance);
  }
}
