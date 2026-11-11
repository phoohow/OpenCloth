/** Draws the scene stage of a preview snapshot into the color target, producing its depth. */

import type { PreviewFrame, PreviewPass } from '@/render/renderer/frame/pass';

/** Scene slot: first pass of a preview, draws the snapshot into color. */
export class PreviewScenePass implements PreviewPass {
  readonly id = 'scene';
  readonly slot = 'scene' as const;
  readonly reads = [] as const;
  readonly writes = ['color'] as const;

  execute(frame: PreviewFrame): void {
    frame.commands.setTarget(frame.resources.color, true);
    frame.commands.drawScene(frame.scene.raster, 'scene', frame.camera);
  }
}
