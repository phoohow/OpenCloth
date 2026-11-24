import type { FrameConditions, PassContext, RenderPass } from '@/render/renderer/frame/pass';

export class OverlayPass implements RenderPass {
  readonly id = 'overlay';
  readonly slot = 'overlay' as const;
  readonly reads = ['color'] as const;
  readonly writes = ['color'] as const;

  enabled(frame: FrameConditions): boolean {
    return frame.overlays.gizmo;
  }

  execute(ctx: PassContext): void {
    ctx.commands.setTarget(ctx.resources.color, false);
    ctx.commands.drawScene(ctx.scene.raster, 'gizmo', ctx.view.camera);
  }
}
