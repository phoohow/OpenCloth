/** Catalogue previews: the fixed slots of one offscreen still frame. */

import { PassGraph } from '@/render/renderer/frame/graph';
import type { PreviewFrame, PreviewPass, PreviewSlot } from '@/render/renderer/frame/pass';

const PREVIEW_SLOTS: readonly PreviewSlot[] = ['scene', 'tone'];

/** The preview's graph: the fixed slots of one still frame. */
export class PreviewGraph {
  private readonly graph: PassGraph<PreviewSlot, PreviewPass>;

  constructor(passes: readonly PreviewPass[]) {
    this.graph = new PassGraph(passes, PREVIEW_SLOTS);
  }

  /** Executes the preview passes and returns the ids that ran. */
  execute(frame: PreviewFrame): readonly string[] {
    return this.graph.execute(pass => pass.execute(frame));
  }

  /** Frees resources the passes own. */
  dispose(): void {
    this.graph.dispose();
  }
}
