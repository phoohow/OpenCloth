import type { Aspect } from './changeSet';

/** Aspects a diff pass reports, plus the objects each aspect is about. */
export interface DiffTarget {
  aspects: Set<Aspect>;
  panelIds: Set<string>;
}

/** Full accumulator: the scene pass adds per-light detail on top of the shared shape. */
export interface DiffAccumulator extends DiffTarget {
  lightIds: Set<string>;
  lightStructure: boolean;
}
