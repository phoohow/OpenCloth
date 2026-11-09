/** Fixed-order execution of the renderer's passes. */

import { frameProfiler } from '@/base/perf';
import type { FrameConditions, RenderPass, ResourceId } from '@/render/renderer/frame/pass';

const SLOT_ORDER: readonly string[] = [
  'raster', 'trace', 'denoise', 'composite', 'post', 'heatmap', 'wire', 'overlay', 'present',
];

/** Runs every enabled pass in slot order, checking resource reads against what earlier passes wrote. */
export class FrameGraph {
  private readonly passes: RenderPass[];

  constructor(passes: readonly RenderPass[]) {
    this.passes = [...passes].sort(
      (a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot),
    );
  }

  /** Executes the enabled passes and returns the ids that ran. */
  execute(
    conditions: FrameConditions,
    run: (pass: RenderPass) => void,
  ): readonly string[] {
    // The canvas is the external input; radiance is a resident buffer kept across frames.
    const available = new Set<ResourceId>(['surface', 'radiance']);
    const ran: string[] = [];
    for (const pass of this.passes) {
      if (!pass.enabled(conditions)) continue;
      for (const resource of pass.reads) {
        if (!available.has(resource)) {
          throw new Error(`Pass "${pass.id}" reads "${resource}" before any pass writes it`);
        }
      }
      frameProfiler.span(`pass:${pass.id}`, () => run(pass));
      for (const resource of pass.writes) available.add(resource);
      ran.push(pass.id);
    }
    return ran;
  }

  /** Frees resources the passes own. */
  dispose(): void {
    for (const pass of this.passes) pass.dispose?.();
  }
}
