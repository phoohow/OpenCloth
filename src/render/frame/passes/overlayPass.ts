/** Pass 6: overlay and gizmo, drawn over the display image. */

import { LAYERS, SCENE_LAYERS, TOP_LAYERS } from '@/render/scene/layers';
import type { FrameContext, FramePass, PassId } from '@/render/frame/pass';

/**
 * Draws the display-space layers. They land on the tone-mapped image, so heatmaps, seams and
 * gizmos keep the colours they were authored with. The frame color buffer still carries the depth
 * the scene pass wrote, so they occlude correctly.
 *
 * The backdrop is detached for this draw: painting it again would cover everything already on the
 * target and leave only these layers visible.
 */
export class OverlayPass implements FramePass {
  readonly id: PassId = 'overlay';

  enabled(ctx: FrameContext): boolean {
    return TOP_LAYERS.some(id => LAYERS[id].raster && ctx.spec.layers.includes(id));
  }

  run(ctx: FrameContext): void {
    const { renderer, sceneMgr, camera, targets, spec } = ctx;
    for (const id of TOP_LAYERS) sceneMgr.setLayerVisible(id, LAYERS[id].raster && spec.layers.includes(id));
    // Earlier passes left the lit layers on; drawing them again would blend them over themselves.
    for (const id of SCENE_LAYERS) sceneMgr.setLayerVisible(id, false);
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    try {
      sceneMgr.withoutBackground(() => {
        renderer.setRenderTarget(targets.color);
        renderer.render(sceneMgr.scene, camera.camera);
      });
    } finally {
      renderer.autoClear = autoClear;
    }
  }
}
