import type { ProgramLibrary } from '@/render/backend/programs';
import type { FrameConditions, PassContext, RenderPass } from '@/render/renderer/frame/pass';

export class PresentPass implements RenderPass {
  readonly id = 'present';
  readonly slot = 'present' as const;
  readonly reads = ['color'] as const;
  readonly writes = ['surface'] as const;

  constructor(private readonly programs: ProgramLibrary) {}

  enabled(_frame: FrameConditions): boolean {
    return true;
  }

  execute(ctx: PassContext): void {
    this.programs.present(ctx.commands, ctx.resources.texture(ctx.resources.color));
    ctx.commands.restore();
  }
}
