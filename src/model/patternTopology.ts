import type { Pattern } from '@/model/types';

/** One position where a panel loop references an edge. */
export interface EdgeLocation {
  panelId: string;
  /** Slot of the edge inside its loop. */
  index: number;
  edgeId: string;
  /** Hole the location belongs to; null for the outer outline. */
  hole: number | null;
}

/** One endpoint reference from an edge to a point. */
export interface PointRef {
  edgeId: string;
  role: 'start' | 'end';
}

/**
 * Adjacency index over a pattern: which panel loops reference each edge and which edges
 * reference each point. Build a new one whenever the pattern records change.
 */
export class PatternTopology {
  private readonly outlineLoops = new Map<string, EdgeLocation[]>();
  private readonly holeLoops = new Map<string, EdgeLocation[][]>();
  private readonly edgeLocations = new Map<string, EdgeLocation[]>();
  private readonly pointRefs = new Map<string, PointRef[]>();

  constructor(pattern: Pattern) {
    for (const panel of Object.values(pattern.panels)) {
      const outline: EdgeLocation[] = [];
      panel.outlineEdgeIds.forEach((edgeId, index) => {
        const location: EdgeLocation = { panelId: panel.id, index, edgeId, hole: null };
        outline.push(location);
        addTo(this.edgeLocations, edgeId, location);
      });
      this.outlineLoops.set(panel.id, outline);

      const holes = (panel.holes ?? []).map((loop, hole) => loop.map((edgeId, index) => {
        const location: EdgeLocation = { panelId: panel.id, index, edgeId, hole };
        addTo(this.edgeLocations, edgeId, location);
        return location;
      }));
      if (holes.length > 0) this.holeLoops.set(panel.id, holes);
    }

    for (const edge of Object.values(pattern.edges)) {
      addTo(this.pointRefs, edge.startPointId, { edgeId: edge.id, role: 'start' });
      addTo(this.pointRefs, edge.endPointId, { edgeId: edge.id, role: 'end' });
    }
  }

  /** Outer outline of a panel, in winding order. */
  outlineOf(panelId: string): readonly EdgeLocation[] {
    return this.outlineLoops.get(panelId) ?? [];
  }

  /** Hole loops of a panel, each in winding order. */
  holesOf(panelId: string): readonly (readonly EdgeLocation[])[] {
    return this.holeLoops.get(panelId) ?? [];
  }

  /** Every loop position referencing an edge, outer outlines and holes alike. */
  locationsOf(edgeId: string): readonly EdgeLocation[] {
    return this.edgeLocations.get(edgeId) ?? [];
  }

  /** Whether an edge belongs to any panel loop. */
  isOnLoop(edgeId: string): boolean {
    return this.edgeLocations.has(edgeId);
  }

  /** Panels whose outline or holes reference the edge, without duplicates. */
  panelsOfEdge(edgeId: string): string[] {
    const out: string[] = [];
    for (const location of this.locationsOf(edgeId)) {
      if (!out.includes(location.panelId)) out.push(location.panelId);
    }
    return out;
  }

  /** First panel referencing the edge, or null when it is on no loop. */
  panelOfEdge(edgeId: string): string | null {
    return this.edgeLocations.get(edgeId)?.[0]?.panelId ?? null;
  }

  /** Edges that start or end at a point. */
  edgesOf(pointId: string): readonly PointRef[] {
    return this.pointRefs.get(pointId) ?? [];
  }
}

function addTo<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
