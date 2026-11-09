/** Draws the scene stage of the raster root into the color target, producing its depth. */

import type { FrameConditions, PassContext, RenderPass } from '@/render/renderer/frame/pass';

/** Raster slot: first pass, draws the scene into color and produces depth. */
export class RasterPass implements RenderPass {
  readonly id = 'raster';
  readonly slot = 'raster' as const;
  readonly reads = [] as const;
  readonly writes = ['color'] as const;

  enabled(_frame: FrameConditions): boolean {
    return true;
  }

  execute(ctx: PassContext): void {
    ctx.commands.setTarget(ctx.resources.color, true);
    ctx.commands.drawScene(ctx.scene.raster, 'scene', ctx.view.camera);
  }
}
