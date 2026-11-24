import type { PreviewFrame, PreviewPass, PreviewSlot } from '@/render/renderer/frame/pass';

import { PassGraph } from '@/render/renderer/frame/graph';

const PREVIEW_SLOTS: readonly PreviewSlot[] = ['scene', 'tone'];

export class PreviewGraph {
  private readonly graph: PassGraph<PreviewSlot, PreviewPass>;

  constructor(passes: readonly PreviewPass[]) {
    this.graph = new PassGraph(passes, PREVIEW_SLOTS);
  }

  execute(frame: PreviewFrame): readonly string[] {
    return this.graph.execute(pass => pass.execute(frame));
  }

  dispose(): void {
    this.graph.dispose();
  }
}
