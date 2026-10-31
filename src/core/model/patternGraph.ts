import type { Pattern } from './types';

/** One position in an outline: `index` is the slot of the edge in `Panel.outlineEdgeIds`. */
export interface EdgeLocation {
  panelId: string;
  index: number;
  edgeId: string;
}

/** One position where a point is referenced from an edge endpoint. */
export interface PointLocation {
  edgeId: string;
  role: 'start' | 'end';
}

/**
 * Panel outline adjacency for the drafting tools: every edge location of every panel,
 * the panels an edge belongs to, and where each point is used.
 */
export interface PatternGraph {
  /** edgeId → panels and outline slots that reference it. */
  edgeLocations: Map<string, EdgeLocation[]>;
  /** panelId → the panel's outline edges in order, resolved against `pattern.edges`. */
  outline: Map<string, EdgeLocation[]>;
  /** pointId → edge endpoints referencing it. */
  pointRefs: Map<string, PointLocation[]>;
}

/** Indexes the outline references of a pattern. Missing records are skipped, not thrown. */
export function buildPatternGraph(pattern: Pattern): PatternGraph {
  const edgeLocations = new Map<string, EdgeLocation[]>();
  const outline = new Map<string, EdgeLocation[]>();
  const pointRefs = new Map<string, PointLocation[]>();

  for (const panel of Object.values(pattern.panels)) {
    const chain: EdgeLocation[] = [];
    panel.outlineEdgeIds.forEach((edgeId, index) => {
      const location: EdgeLocation = { panelId: panel.id, index, edgeId };
      chain.push(location);
      const list = edgeLocations.get(edgeId);
      if (list) list.push(location);
      else edgeLocations.set(edgeId, [location]);
    });
    outline.set(panel.id, chain);
    for (const loop of panel.holes ?? []) {
      loop.forEach((edgeId, index) => {
        const location: EdgeLocation = { panelId: panel.id, index, edgeId };
        const list = edgeLocations.get(edgeId);
        if (list) list.push(location);
        else edgeLocations.set(edgeId, [location]);
      });
    }
  }

  for (const edge of Object.values(pattern.edges)) {
    addPointRef(pointRefs, edge.startPointId, edge.id, 'start');
    addPointRef(pointRefs, edge.endPointId, edge.id, 'end');
  }

  return { edgeLocations, outline, pointRefs };
}

/** Panels and outline slots referencing an edge. */
export function panelsOfEdge(graph: PatternGraph, edgeId: string): string[] {
  return (graph.edgeLocations.get(edgeId) ?? []).map(l => l.panelId);
}

/** The panel owning an edge, or null when the edge is on no outline. */
export function panelOfEdge(graph: PatternGraph, edgeId: string): string | null {
  return graph.edgeLocations.get(edgeId)?.[0]?.panelId ?? null;
}

function addPointRef(
  refs: Map<string, PointLocation[]>,
  pointId: string,
  edgeId: string,
  role: 'start' | 'end',
): void {
  const list = refs.get(pointId);
  if (list) list.push({ edgeId, role });
  else refs.set(pointId, [{ edgeId, role }]);
}
