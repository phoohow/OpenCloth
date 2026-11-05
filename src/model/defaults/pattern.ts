import type { Pattern } from '@/model/types';

/** Pattern with no points, edges, panels or seams yet. */
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
