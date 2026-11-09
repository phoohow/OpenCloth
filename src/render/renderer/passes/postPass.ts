/** Applies exposure and the tone curve back into the color target, keeping its depth. */

import type { ProgramLibrary } from '@/render/backend/programs';
import type { FrameConditions, PassContext, RenderPass } from '@/render/renderer/frame/pass';

/** Post slot: applies exposure and the tone curve in place. */
export class PostPass implements RenderPass {
  readonly id = 'post';
  readonly slot = 'post' as const;
  readonly reads = ['composite'] as const;
  readonly writes = ['color'] as const;

  constructor(private readonly programs: ProgramLibrary) { }

  enabled(_frame: FrameConditions): boolean {
    return true;
  }

  execute(ctx: PassContext): void {
    this.programs.toneMap(
      ctx.commands,
      ctx.resources.texture(ctx.resources.composite),
      ctx.resources.color,
      ctx.view.settings.toneMapping,
      ctx.view.settings.exposure,
    );
  }
}
