import type {
  Annotation, Dart, InternalLine, Measurement, Notch, Panel, Pattern, PatternEdge, PatternPoint, Print,
  Seam, Topstitch, Trim,
} from '@/model/types';
import { GARMENT_LAYER_COLLISION } from '@/model/defaults';
import { PatternTopology, type EdgeLocation } from '@/model/patternTopology';

/** One edge of a panel loop, resolved against the pattern. */
export class EdgeView {
  constructor(readonly document: PatternDocument, readonly record: PatternEdge) { }

  get id(): string { return this.record.id; }

  /** Whether the edge belongs to any panel loop. */
  isOnLoop(): boolean { return this.document.topology.isOnLoop(this.id); }

  startPoint(): PatternPoint | null { return this.document.point(this.record.startPointId); }
  endPoint(): PatternPoint | null { return this.document.point(this.record.endPointId); }
}

/** One cut piece: its loops, its marks and the body layer it sits on. */
export class PanelView {
  constructor(readonly document: PatternDocument, readonly record: Panel) { }

  get id(): string { return this.record.id; }
  get name(): string { return this.record.name; }

  /** Outline edges in winding order; missing edges are skipped. */
  outline(): EdgeView[] { return this.resolve(this.document.topology.outlineOf(this.id)); }

  /** Hole loops in winding order. */
  holeLoops(): EdgeView[][] {
    return this.document.topology.holesOf(this.id).map(loop => this.resolve(loop));
  }

  /** Whether the outline closes back onto its first edge. */
  isOutlineClosed(): boolean {
    const edges = this.outline();
    if (edges.length < 3) return false;
    return edges.every((edge, i) => edge.record.endPointId === edges[(i + 1) % edges.length]!.record.startPointId);
  }

  darts(): Dart[] { return this.record.dartIds.map(id => this.document.dartRecord(id)).filter(isPresent); }

  internalLines(): InternalLine[] {
    return this.record.internalLineIds.map(id => this.document.internalLineRecord(id)).filter(isPresent);
  }

  prints(): Print[] { return marksOf(this.id, this.document.printRecords()); }
  topstitches(): Topstitch[] { return marksOf(this.id, this.document.topstitchRecords()); }
  trims(): Trim[] { return marksOf(this.id, this.document.trimRecords()); }
  annotations(): Annotation[] { return marksOf(this.id, this.document.annotationRecords()); }
  measurements(): Measurement[] { return marksOf(this.id, this.document.measurementRecords()); }

  /** Construction layer, absent when the piece has no construction layer. */
  get layer(): Panel['layer'] { return this.record.layer; }

  /** Collision layer: a manual value wins, otherwise the construction layer decides. */
  collisionLayer(): number {
    const manual = this.record.collisionLayer;
    if (typeof manual === 'number' && Number.isFinite(manual)) return Math.min(9, Math.max(0, Math.round(manual)));
    return this.record.layer ? GARMENT_LAYER_COLLISION[this.record.layer] : 0;
  }

  get seamAllowanceCm(): number { return this.record.seamAllowanceCm; }
  get fabricId(): string { return this.record.fabricId; }
  get visible(): boolean { return this.record.visible !== false; }

  private resolve(locations: readonly EdgeLocation[]): EdgeView[] {
    return locations.map(l => this.document.edge(l.edgeId)).filter(isPresent);
  }
}

/** Semantic facade over one pattern record: typed views plus topology queries. */
export class PatternDocument {
  readonly topology: PatternTopology;
  private readonly panelsById = new Map<string, PanelView>();
  private readonly seamsById = new Map<string, Seam>();
  private readonly lineOwner = new Map<string, string>();
  private readonly dartOwner = new Map<string, string>();

  constructor(private readonly record: Pattern) {
    this.topology = new PatternTopology(record);
    for (const panel of Object.values(record.panels)) {
      this.panelsById.set(panel.id, new PanelView(this, panel));
      for (const lineId of panel.internalLineIds) this.lineOwner.set(lineId, panel.id);
      for (const dartId of panel.dartIds) this.dartOwner.set(dartId, panel.id);
    }
    for (const seam of Object.values(record.seams ?? {})) this.seamsById.set(seam.id, seam);
  }

  /** The record this document was built from. */
  get pattern(): Pattern { return this.record; }

  panels(): readonly PanelView[] { return [...this.panelsById.values()]; }
  panel(id: string): PanelView | null { return this.panelsById.get(id) ?? null; }

  /** Resolves an edge against this document's topology. */
  edge(id: string): EdgeView | null {
    const edge = this.record.edges[id];
    return edge ? new EdgeView(this, edge) : null;
  }

  point(id: string): PatternPoint | null { return this.record.points[id] ?? null; }
  seam(id: string): Seam | null { return this.seamsById.get(id) ?? null; }
  seams(): readonly Seam[] { return [...this.seamsById.values()]; }

  /** Panels whose loops reference the edge. */
  panelsOfEdge(edgeId: string): string[] { return this.topology.panelsOfEdge(edgeId); }

  /** Panels owning an edge that ends at the point. */
  panelsOfPoint(pointId: string): string[] {
    const out = new Set<string>();
    for (const ref of this.topology.edgesOf(pointId)) {
      for (const panelId of this.panelsOfEdge(ref.edgeId)) out.add(panelId);
    }
    return [...out];
  }

  /** Panels owning either side of a seam. */
  panelsOfSeam(seamId: string): string[] {
    const seam = this.seamsById.get(seamId);
    if (!seam) return [];
    const out = new Set<string>();
    for (const end of [seam.a, seam.b]) {
      if (end?.edgeId) for (const panelId of this.panelsOfEdge(end.edgeId)) out.add(panelId);
    }
    return [...out];
  }

  panelsOfInternalLine(lineId: string): string[] {
    const owner = this.lineOwner.get(lineId);
    return owner && this.panelsById.has(owner) ? [owner] : [];
  }

  panelsOfDart(dartId: string): string[] {
    const owner = this.dartOwner.get(dartId);
    return owner && this.panelsById.has(owner) ? [owner] : [];
  }

  /** Panels wearing a material record. */
  panelsUsingFabric(fabricId: string): string[] {
    return this.panels().filter(panel => panel.fabricId === fabricId).map(panel => panel.id);
  }

  /** Panel a production mark belongs to; null when the mark or its owner is gone. */
  panelOfMarking(kind: 'print' | 'topstitch' | 'trim' | 'annotation' | 'measurement', id: string): string | null {
    const owner = this.markingOwner(kind, id);
    return owner && this.panelsById.has(owner) ? owner : null;
  }

  /** Notches placed on an edge, in insertion order. */
  notchesOfEdge(edgeId: string): Notch[] {
    return this.notchRecords().filter(notch => notch.edgeId === edgeId);
  }

  dartRecord(id: string): Dart | null { return this.record.darts[id] ?? null; }
  internalLineRecord(id: string): InternalLine | null { return this.record.internalLines[id] ?? null; }
  printRecords(): Print[] { return Object.values(this.record.prints ?? {}); }
  topstitchRecords(): Topstitch[] { return Object.values(this.record.topstitches ?? {}); }
  trimRecords(): Trim[] { return Object.values(this.record.trims ?? {}); }
  annotationRecords(): Annotation[] { return Object.values(this.record.annotations ?? {}); }
  measurementRecords(): Measurement[] { return Object.values(this.record.measurements ?? {}); }
  notchRecords(): Notch[] { return Object.values(this.record.notches ?? {}); }

  private markingOwner(
    kind: 'print' | 'topstitch' | 'trim' | 'annotation' | 'measurement',
    id: string,
  ): string | null {
    const table = kind === 'print' ? this.record.prints
      : kind === 'topstitch' ? this.record.topstitches
        : kind === 'trim' ? this.record.trims
          : kind === 'annotation' ? this.record.annotations
            : this.record.measurements;
    return table?.[id]?.panelId ?? null;
  }
}

const documents = new WeakMap<Pattern, PatternDocument>();

/** Reuses one document per pattern record; a new record gets a new index. */
export function patternDocument(record: Pattern): PatternDocument {
  let document = documents.get(record);
  if (!document) {
    document = new PatternDocument(record);
    documents.set(record, document);
  }
  return document;
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}

/** Marks of one table owned by a panel. */
function marksOf<T extends { panelId: string }>(panelId: string, marks: T[]): T[] {
  return marks.filter(mark => mark.panelId === panelId);
}
