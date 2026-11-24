import type { TraceEngine } from '@/render/backend/trace/traceEngine';
import type { TraceDefer } from '@/render/common';
import type { FrameConditions, PassContext, RenderPass } from '@/render/renderer/frame/pass';

export class TracePass implements RenderPass {
  readonly id = 'trace';
  readonly slot = 'trace' as const;
  readonly reads = [] as const;
  readonly writes = ['radiance'] as const;
  private lastSamples = 0;
  private lastDefer: TraceDefer | null = null;

  constructor(private readonly tracer: TraceEngine) {}

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
    const resumed = !deferred && this.lastDefer !== null;
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
