import type { FrameConditions, PassContext, RenderPass } from '@/render/renderer/frame/pass';

export class HeatmapPass implements RenderPass {
  readonly id = 'heatmap';
  readonly slot = 'heatmap' as const;
  readonly reads = ['color'] as const;
  readonly writes = ['color'] as const;

  enabled(frame: FrameConditions): boolean {
    return frame.overlays.postTone;
  }

  execute(ctx: PassContext): void {
    ctx.commands.setTarget(ctx.resources.color, false);
    ctx.commands.drawScene(ctx.scene.raster, 'postTone', ctx.view.camera);
  }
}
