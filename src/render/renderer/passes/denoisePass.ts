import type { DenoiseEngine } from '@/render/backend/denoise/denoiseEngine';
import type { DenoiseModel } from '@/render/common';
import type { FrameConditions, PassContext, RenderPass } from '@/render/renderer/frame/pass';

export class DenoisePass implements RenderPass {
  readonly id = 'denoise';
  readonly slot = 'denoise' as const;
  readonly reads = ['radiance'] as const;
  readonly writes = ['radiance'] as const;
  private model: DenoiseModel | null = null;

  constructor(private readonly denoise: DenoiseEngine) {}

  enabled(frame: FrameConditions): boolean {
    return frame.view.settings.trace.denoise && frame.view.settings.mode === 'pathtrace';
  }

  execute(ctx: PassContext): void {
    if (!ctx.trace.traced) {
      ctx.trace.denoiseCount = 0;
      return;
    }

    const model = ctx.view.settings.trace.denoiseModel;
    if (model !== this.model) {
      this.model = model;
      this.denoise.configure(model);
    }

    const cleaned = this.denoise.run(ctx.scene, ctx.view.camera, {
      radiance: ctx.resources.radiance,
      samples: ctx.trace.samples,
      weight: ctx.trace.weight,
      accumulating: ctx.trace.accumulating,
      restarted: ctx.trace.restarted,
    });
    ctx.trace.denoiseCount = this.denoise.completedPasses;
    if (cleaned) ctx.trace.radiance = cleaned;
  }
}
