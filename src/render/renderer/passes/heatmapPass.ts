/** Draws the analysis heatmap over the tone-mapped image. */

import type { FrameConditions, PassContext, RenderPass } from '@/render/renderer/frame/pass';

/** Heatmap slot: draws the postTone entities, whose colours must not be tone mapped. */
export class HeatmapPass implements RenderPass {
  readonly id = 'heatmap';
  readonly slot = 'heatmap' as const;
  readonly reads = ['color'] as const;
  readonly writes = ['color'] as const;

  enabled(_frame: FrameConditions): boolean {
    return true;
  }

  execute(ctx: PassContext): void {
    if (!ctx.scene.hasStage('postTone')) return;
    // The colour target still holds the scene depth, so the heatmap keeps the occlusion of the
    // surfaces it describes while skipping the tone curve.
    ctx.commands.setTarget(ctx.resources.color, false);
    ctx.commands.drawScene(ctx.scene.raster, 'postTone', ctx.view.camera);
  }
}
