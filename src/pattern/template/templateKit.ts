import { genId } from '@/common/id';
import type {
  Panel, PanelDrape, Pattern, PatternEdge, PatternPoint, Seam, SeamEnd, Vec2, EdgeSemantic,
} from '@/model/types';
import { vec2 } from '@/model/types';
import { createEmptyPattern, DEFAULT_MESH_RESOLUTION_CM } from '@/model';
import { setEdgeCurve } from '@/pattern/geom/bezier';

export type { GarmentTemplate, ParamField } from '@/pattern/template/garmentTemplate';

/** Reference to a pattern point already inserted in the pattern. */
export interface PtRef {
  id: string;
  pos: Vec2;
}

/** Panel geometry a template adds to a pattern. */
export interface PanelSpec {
  name: string;
  /** Outline edges in winding order. */
  edges: string[];
  drape?: PanelDrape;
  seamAllowanceCm?: number;
  meshResolutionCm?: number;
}

/**
 * Incremental pattern authoring for templates: points are written in a local frame and
 * shifted by the current placement, so panels never overlap in the 2D view.
 */
export class PatternBuilder {
  readonly pattern: Pattern;
  private readonly fabricId: string;
  private origin: Vec2 = vec2(0, 0);

  constructor(fabricId: string, pattern: Pattern = createEmptyPattern()) {
    this.fabricId = fabricId;
    this.pattern = pattern;
  }

  /** Sets the offset applied to every coordinate authored after this call. */
  placeAt(x: number, y: number): void {
    this.origin = vec2(x, y);
  }

  /** Adds a point at local coordinates plus the current placement. */
  point(x: number, y: number): PtRef {
    const pos = vec2(x + this.origin.x, y + this.origin.y);
    const id = genId('pt');
    const point: PatternPoint = { id, pos };
    this.pattern.points[id] = point;
    return { id, pos };
  }

  /** Adds a straight outline edge between two points. */
  line(a: PtRef, b: PtRef, semantic?: EdgeSemantic): string {
    const id = genId('edge');
    const edge: PatternEdge = { id, type: 'line', startPointId: a.id, endPointId: b.id, semantic };
    this.pattern.edges[id] = edge;
    return id;
  }

  /** Adds a cubic Bezier outline edge; handles use local coordinates plus the current placement. */
  bezier(a: PtRef, b: PtRef, c0: Vec2, c1: Vec2, semantic?: EdgeSemantic): string {
    const id = genId('edge');
    const edge: PatternEdge = { id, type: 'bezier', startPointId: a.id, endPointId: b.id, semantic };
    this.pattern.edges[id] = edge;
    setEdgeCurve(this.pattern, edge,
      vec2(c0.x + this.origin.x, c0.y + this.origin.y),
      vec2(c1.x + this.origin.x, c1.y + this.origin.y),
    );
    return id;
  }

  /** Adds a panel and its outline edges to the pattern. */
  panel(spec: PanelSpec): Panel {
    const panel: Panel = {
      id: genId('panel'),
      name: spec.name,
      outlineEdgeIds: spec.edges,
      dartIds: [],
      internalLineIds: [],
      seamAllowanceCm: spec.seamAllowanceCm ?? 1,
      fabricId: this.fabricId,
      meshResolutionCm: spec.meshResolutionCm ?? DEFAULT_MESH_RESOLUTION_CM,
      drape: spec.drape,
      visible: true,
      locked: false,
    };
    this.pattern.panels[panel.id] = panel;
    return panel;
  }

  /** Joins two outline edges; paired by arc-length fraction while dressing. */
  seam(edgeAId: string, edgeBId: string, opts: { flipB?: boolean; type?: Seam['type']; strength?: number } = {}): void {
    const id = genId('seam');
    const a: SeamEnd = { edgeId: edgeAId, t0: 0, t1: 1 };
    const b: SeamEnd = { edgeId: edgeBId, t0: 0, t1: 1 };
    const seam: Seam = {
      id,
      type: opts.type ?? 'normal',
      a,
      b,
      flip: opts.flipB ?? false,
      strength: opts.strength ?? 0.8,
      threadColor: '#ff4444',
      stitchVisible: true,
    };
    this.pattern.seams[id] = seam;
  }
}
