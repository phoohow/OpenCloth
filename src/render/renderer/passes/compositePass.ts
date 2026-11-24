import type { ProgramLibrary } from '@/render/backend/programs';
import type { FrameConditions, PassContext, RenderPass } from '@/render/renderer/frame/pass';

export class CompositePass implements RenderPass {
  readonly id = 'composite';
  readonly slot = 'composite' as const;
  readonly reads = ['color', 'radiance'] as const;
  readonly writes = ['composite'] as const;

  constructor(private readonly programs: ProgramLibrary) {}

  enabled(_frame: FrameConditions): boolean {
    return true;
  }

  execute(ctx: PassContext): void {
    const radiance = ctx.trace.traced ? ctx.trace.radiance : null;
    this.programs.composite(
      ctx.commands,
      ctx.resources.texture(ctx.resources.color),
      radiance,
      ctx.trace.weight,
      ctx.resources.composite,
    );
  }
}
