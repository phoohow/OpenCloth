/** Cleans the traced radiance on the denoiser's cadence. */

import type { DenoiseModel } from '@/render/common';
import type { DenoiseEngine } from '@/render/backend/denoise/denoiseEngine';
import type { FrameConditions, PassContext, RenderPass } from '@/render/renderer/frame/pass';

/** Denoise slot: hands the traced radiance to the denoiser on its cadence. */
export class DenoisePass implements RenderPass {
  readonly id = 'denoise';
  readonly slot = 'denoise' as const;
  readonly reads = ['radiance'] as const;
  readonly writes = ['radiance'] as const;
  private model: DenoiseModel | null = null;

  constructor(private readonly denoise: DenoiseEngine) { }

  enabled(frame: FrameConditions): boolean {
    return frame.view.settings.trace.denoise && frame.view.settings.mode === 'pathtrace';
  }

  execute(ctx: PassContext): void {
    if (!ctx.trace.traced) return;
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
    if (cleaned) ctx.trace.radiance = cleaned;
  }
}
