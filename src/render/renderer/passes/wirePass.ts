import type { FrameConditions, PassContext, RenderPass } from '@/render/renderer/frame/pass';

export class WirePass implements RenderPass {
  readonly id = 'wire';
  readonly slot = 'wire' as const;
  readonly reads = ['color'] as const;
  readonly writes = ['color'] as const;

  enabled(frame: FrameConditions): boolean {
    return frame.overlays.wire;
  }

  execute(ctx: PassContext): void {
    ctx.commands.setTarget(ctx.resources.color, false);
    ctx.commands.drawScene(ctx.scene.wire, 'postTone', ctx.view.camera);
  }
}
