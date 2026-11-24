import type { PreviewFrame, PreviewPass } from '@/render/renderer/frame/pass';

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
