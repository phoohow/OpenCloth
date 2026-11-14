/** Draws the wire overlay over the finished frame. */

import type { FrameConditions, PassContext, RenderPass } from '@/render/renderer/frame/pass';

/** Wire slot: puts the wire guide on the composed image, so both pipelines show it alike. */
export class WirePass implements RenderPass {
  readonly id = 'wire';
  readonly slot = 'wire' as const;
  readonly reads = ['color'] as const;
  readonly writes = ['color'] as const;

  enabled(frame: FrameConditions): boolean {
    return frame.overlays.wire;
  }

  execute(ctx: PassContext): void {
    // The colour target still holds the scene depth, so the wire keeps the occlusion it had while
    // it was drawn with the surfaces; clearing would drop that depth as well as the image.
    ctx.commands.setTarget(ctx.resources.color, false);
    ctx.commands.drawScene(ctx.scene.wire, 'postTone', ctx.view.camera);
  }
}
