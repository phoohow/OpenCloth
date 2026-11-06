/** Stage 1: underlay and subject, drawn into the frame image with depth. */

import { LAYERS, TOP_LAYERS, type LayerId } from '@/render/scene/layers';
import type { FrameContext, FramePass, PassId } from '@/render/frame/pass';

/**
 * Draws the lit image. The mode decides which layers take part and whether the subject surface is
 * filled at all; a diagnostic fill swaps materials for the duration of the draw.
 */
export class ScenePass implements FramePass {
  readonly id: PassId = 'scene';

  enabled(): boolean {
    return true;
  }

  run(ctx: FrameContext): void {
    const { device, sceneMgr, camera, modes, targets, spec } = ctx;
    for (const id of Object.keys(LAYERS) as LayerId[]) {
      sceneMgr.setLayerVisible(id, LAYERS[id].raster && spec.layers.includes(id) && !TOP_LAYERS.includes(id));
    }
    const restore = modes.applySurfaceOverride();
    try {
      device.renderer.setRenderTarget(targets.image);
      device.renderer.render(sceneMgr.scene, camera.camera);
    } finally {
      restore();
    }
  }
}
