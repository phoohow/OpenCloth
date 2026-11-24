import type { Pattern } from '@/model/types';

export function createEmptyPattern(): Pattern {
  return {
    points: {},
    edges: {},
    darts: {},
    internalLines: {},
    panels: {},
    seams: {},
    notches: {},
    annotations: {},
    measurements: {},
    prints: {},
    topstitches: {},
    trims: {},
  };
}
