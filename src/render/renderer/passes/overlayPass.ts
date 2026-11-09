/** Draws the display-space and gizmo stages over the tone-mapped image. */

import type { FrameConditions, PassContext, RenderPass } from '@/render/renderer/frame/pass';

/** Overlay slot: draws display-space and gizmo entities over the finished image. */
export class OverlayPass implements RenderPass {
  readonly id = 'overlay';
  readonly slot = 'overlay' as const;
  readonly reads = ['color'] as const;
  readonly writes = ['color'] as const;

  enabled(_frame: FrameConditions): boolean {
    return true;
  }

  execute(ctx: PassContext): void {
    if (!ctx.scene.hasStage('postTone') && !ctx.scene.hasStage('gizmo')) return;
    ctx.commands.setTarget(ctx.resources.color, false);
    if (ctx.scene.hasStage('postTone')) {
      ctx.commands.drawScene(ctx.scene.raster, 'postTone', ctx.view.camera);
    }
    if (ctx.scene.hasStage('gizmo')) {
      ctx.commands.drawScene(ctx.scene.raster, 'gizmo', ctx.view.camera);
    }
  }
}
