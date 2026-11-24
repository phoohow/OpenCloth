import type { Pattern } from '@/model/types';

export interface EdgeLocation {
  panelId: string;
  index: number;
  edgeId: string;
  hole: number | null;
}

export interface PointRef {
  edgeId: string;
  role: 'start' | 'end';
}

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

  outlineOf(panelId: string): readonly EdgeLocation[] {
    return this.outlineLoops.get(panelId) ?? [];
  }

  holesOf(panelId: string): readonly (readonly EdgeLocation[])[] {
    return this.holeLoops.get(panelId) ?? [];
  }

  locationsOf(edgeId: string): readonly EdgeLocation[] {
    return this.edgeLocations.get(edgeId) ?? [];
  }

  isOnLoop(edgeId: string): boolean {
    return this.edgeLocations.has(edgeId);
  }

  panelsOfEdge(edgeId: string): string[] {
    const out: string[] = [];
    for (const location of this.locationsOf(edgeId)) {
      if (!out.includes(location.panelId)) out.push(location.panelId);
    }

    return out;
  }

  panelOfEdge(edgeId: string): string | null {
    return this.edgeLocations.get(edgeId)?.[0]?.panelId ?? null;
  }

  edgesOf(pointId: string): readonly PointRef[] {
    return this.pointRefs.get(pointId) ?? [];
  }
}

function addTo<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
