/** Fixed-order execution of passes, shared by the viewport frame and the preview still. */

import { frameProfiler } from '@/base/perf';
import type {
  FrameConditions, GraphStep, PassSlot, RenderPass,
} from '@/render/renderer/frame/pass';

const SLOT_ORDER: readonly PassSlot[] = [
  'raster', 'trace', 'denoise', 'composite', 'post', 'heatmap', 'wire', 'overlay', 'present',
];

/** Runs steps in slot order, checking every read against what earlier steps wrote. */
export class PassGraph<Slot extends string, Step extends GraphStep<Slot>> {
  private readonly steps: Step[];
  /** Buffers every frame starts with, such as the canvas and the accumulating radiance. */
  private readonly resident: readonly string[];

  constructor(steps: readonly Step[], slots: readonly Slot[], resident: readonly string[] = []) {
    this.steps = [...steps].sort((a, b) => slots.indexOf(a.slot) - slots.indexOf(b.slot));
    this.resident = resident;
  }

  /** Executes the enabled steps in slot order and returns the ids that ran. */
  execute(run: (step: Step) => void, enabled: (step: Step) => boolean = () => true): readonly string[] {
    const available = new Set<string>(this.resident);
    const ran: string[] = [];
    for (const step of this.steps) {
      if (!enabled(step)) continue;
      for (const resource of step.reads) {
        if (!available.has(resource)) {
          throw new Error(`Pass "${step.id}" reads "${resource}" before any pass writes it`);
        }
      }
      frameProfiler.span(`pass:${step.id}`, () => run(step));
      for (const resource of step.writes) available.add(resource);
      ran.push(step.id);
    }
    return ran;
  }

  /** Frees resources the steps own. */
  dispose(): void {
    for (const step of this.steps) step.dispose?.();
  }
}

/** The viewport's graph: the fixed slots of one rendered frame. */
export class FrameGraph {
  private readonly graph: PassGraph<PassSlot, RenderPass>;

  constructor(passes: readonly RenderPass[]) {
    this.graph = new PassGraph(passes, SLOT_ORDER, ['surface', 'radiance']);
  }

  /** Executes the enabled passes and returns the ids that ran. */
  execute(conditions: FrameConditions, run: (pass: RenderPass) => void): readonly string[] {
    return this.graph.execute(run, pass => pass.enabled(conditions));
  }

  /** Frees resources the passes own. */
  dispose(): void {
    this.graph.dispose();
  }
}
