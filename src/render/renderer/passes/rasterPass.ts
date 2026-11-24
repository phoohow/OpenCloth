import type { FrameConditions, PassContext, RenderPass } from '@/render/renderer/frame/pass';

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
