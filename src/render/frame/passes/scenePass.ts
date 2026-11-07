/** Pass 1: underlay and subject, drawn into the frame color buffer with depth. */

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
    const { renderer, sceneMgr, camera, viewMode, targets, spec } = ctx;
    for (const id of Object.keys(LAYERS) as LayerId[]) {
      sceneMgr.setLayerVisible(id, LAYERS[id].raster && spec.layers.includes(id) && !TOP_LAYERS.includes(id));
    }
    const restore = viewMode.applyFillOverride();
    try {
      renderer.setRenderTarget(targets.color);
      renderer.render(sceneMgr.scene, camera.camera);
    } finally {
      restore();
    }
  }
}
