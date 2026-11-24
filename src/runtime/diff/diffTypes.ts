import type { Aspect } from '@/runtime/common';

export interface DiffTarget {
  aspects: Set<Aspect>;
  panelIds: Set<string>;
}

export interface DiffAccumulator extends DiffTarget {
  lightIds: Set<string>;
  lightStructure: boolean;
}
