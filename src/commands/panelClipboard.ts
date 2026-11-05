import { genId } from '@/common/id';
import type { Command, ProjectContext } from '@/commands/command';
import type {
  Annotation, Dart, InternalLine, Measurement, Notch, Panel, Pattern, PatternEdge, PatternPoint, Seam, Vec2,
} from '@/model/types';


/** Deep copy of the panels owned by the selection and everything they reference. */
export interface PanelClipboard {
  panels: Panel[];
  edges: PatternEdge[];
  points: PatternPoint[];
  darts: Dart[];
  internalLines: InternalLine[];
  seams: Seam[];
  notches: Notch[];
  annotations: Annotation[];
  measurements: Measurement[];
}

/** Gap kept between the copied outline and the pasted one, in cm. */
const PASTE_GAP_CM = 3;

/**
 * Copies the given panels with their outline edges, points, darts and internal lines.
 * Seams survive only when both of their edges were copied.
 */
export function capturePanels(pattern: Pattern, panelIds: readonly string[]): PanelClipboard | null {
  const panels = panelIds.map(id => pattern.panels[id]).filter((p): p is Panel => !!p);
  if (panels.length === 0) return null;

  const edgeIds = new Set<string>();
  const pointIds = new Set<string>();
  const dartIds = new Set<string>();
  const lineIds = new Set<string>();
  const panelIdSet = new Set(panels.map(p => p.id));

  for (const panel of panels) {
    for (const edgeId of [...panel.outlineEdgeIds, ...(panel.holes ?? []).flat()]) {
      edgeIds.add(edgeId);
      const edge = pattern.edges[edgeId];
      if (edge) { pointIds.add(edge.startPointId); pointIds.add(edge.endPointId); }
    }
    for (const dartId of panel.dartIds) {
      const dart = pattern.darts[dartId];
      if (!dart) continue;
      dartIds.add(dartId);
      pointIds.add(dart.tipId);
      edgeIds.add(dart.edge1Id);
      edgeIds.add(dart.edge2Id);
    }
    for (const lineId of panel.internalLineIds) lineIds.add(lineId);
  }
  for (const edgeId of edgeIds) {
    const edge = pattern.edges[edgeId];
    if (edge) { pointIds.add(edge.startPointId); pointIds.add(edge.endPointId); }
  }

  const edges = [...edgeIds].flatMap(id => { const e = pattern.edges[id]; return e ? [e] : []; });
  const points = [...pointIds].flatMap(id => { const p = pattern.points[id]; return p ? [p] : []; });
  const seams = Object.values(pattern.seams).filter(s => edgeIds.has(s.a?.edgeId ?? '') && edgeIds.has(s.b?.edgeId ?? ''));
  const notches = Object.values(pattern.notches ?? {}).filter(n => edgeIds.has(n.edgeId));
  const annotations = Object.values(pattern.annotations ?? {}).filter(a => panelIdSet.has(a.panelId));
  const measurements = Object.values(pattern.measurements ?? {}).filter(m => panelIdSet.has(m.panelId));

  return structuredClone({
    panels,
    edges,
    points,
    darts: [...dartIds].flatMap(id => { const d = pattern.darts[id]; return d ? [d] : []; }),
    internalLines: [...lineIds].flatMap(id => { const l = pattern.internalLines[id]; return l ? [l] : []; }),
    seams,
    notches,
    annotations,
    measurements,
  });
}

/** Horizontal offset that lands the copy to the right of the original outline. */
export function pasteOffset(clip: PanelClipboard): Vec2 {
  const maxX = clip.points.reduce((max, p) => Math.max(max, p.pos.x), -Infinity);
  const minX = clip.points.reduce((min, p) => Math.min(min, p.pos.x), Infinity);
  if (!Number.isFinite(maxX) || !Number.isFinite(minX)) return { x: PASTE_GAP_CM, y: 0 };
  return { x: maxX - minX + PASTE_GAP_CM, y: 0 };
}

/** Inserts a fresh copy of the clipboard; undo removes exactly the ids it created. */
export class PastePanelsCommand implements Command {
  readonly label = '粘贴版片';
  /** Panel ids created by the last execute, for selection after paste. */
  pastedPanelIds: string[] = [];
  private created = { points: [] as string[], edges: [] as string[], darts: [] as string[], lines: [] as string[], seams: [] as string[] };

  constructor(private clip: PanelClipboard) { }

  execute(ctx: ProjectContext): void {
    const pattern = ctx.project.pattern;
    const delta = pasteOffset(this.clip);
    const pointIds = new Map<string, string>();
    const edgeIds = new Map<string, string>();
    const dartIds = new Map<string, string>();
    const lineIds = new Map<string, string>();
    const panelIds = new Map<string, string>();
    this.created = { points: [], edges: [], darts: [], lines: [], seams: [] };

    for (const point of this.clip.points) {
      const id = genId('pt');
      pointIds.set(point.id, id);
      this.created.points.push(id);
      pattern.points[id] = {
        id,
        pos: { x: point.pos.x + delta.x, y: point.pos.y + delta.y },
        ...(point.construction !== undefined ? { construction: point.construction } : {}),
        ...(point.kind !== undefined ? { kind: point.kind } : {}),
        ...(point.handleIn ? { handleIn: { ...point.handleIn, x: point.handleIn.x + delta.x, y: point.handleIn.y + delta.y } } : {}),
        ...(point.handleOut ? { handleOut: { ...point.handleOut, x: point.handleOut.x + delta.x, y: point.handleOut.y + delta.y } } : {}),
      };
    }

    for (const edge of this.clip.edges) {
      const id = genId('edge');
      edgeIds.set(edge.id, id);
      this.created.edges.push(id);
      pattern.edges[id] = {
        ...edge,
        id,
        startPointId: pointIds.get(edge.startPointId) ?? edge.startPointId,
        endPointId: pointIds.get(edge.endPointId) ?? edge.endPointId,
        ...(edge.arc ? { arc: { ...edge.arc, center: { x: edge.arc.center.x + delta.x, y: edge.arc.center.y + delta.y } } } : {}),
      };
    }

    for (const dart of this.clip.darts) {
      const id = genId('dart');
      dartIds.set(dart.id, id);
      this.created.darts.push(id);
      pattern.darts[id] = {
        ...dart,
        id,
        tipId: pointIds.get(dart.tipId) ?? dart.tipId,
        edge1Id: edgeIds.get(dart.edge1Id) ?? dart.edge1Id,
        edge2Id: edgeIds.get(dart.edge2Id) ?? dart.edge2Id,
      };
    }

    for (const line of this.clip.internalLines) {
      const id = genId('line');
      lineIds.set(line.id, id);
      this.created.lines.push(id);
      pattern.internalLines[id] = {
        ...line,
        id,
        points: line.points.map(p => ({ x: p.x + delta.x, y: p.y + delta.y })),
      };
    }

    this.pastedPanelIds = [];
    for (const panel of this.clip.panels) {
      const id = genId('panel');
      panelIds.set(panel.id, id);
      this.pastedPanelIds.push(id);
      pattern.panels[id] = {
        ...panel,
        id,
        name: nextCopyName(pattern, panel.name),
        outlineEdgeIds: panel.outlineEdgeIds.map(eid => edgeIds.get(eid) ?? eid),
        ...(panel.holes ? { holes: panel.holes.map(loop => loop.map(eid => edgeIds.get(eid) ?? eid)) } : {}),
        dartIds: panel.dartIds.map(did => dartIds.get(did) ?? did),
        internalLineIds: panel.internalLineIds.map(lid => lineIds.get(lid) ?? lid),
        visible: true,
        locked: false,
      };
    }

    for (const seam of this.clip.seams) {
      const id = genId('seam');
      this.created.seams.push(id);
      pattern.seams[id] = {
        ...seam,
        id,
        a: { ...seam.a, edgeId: edgeIds.get(seam.a.edgeId) ?? seam.a.edgeId },
        b: { ...seam.b, edgeId: edgeIds.get(seam.b.edgeId) ?? seam.b.edgeId },
      };
    }

    pattern.notches ??= {};
    pattern.annotations ??= {};
    pattern.measurements ??= {};
    for (const notch of this.clip.notches ?? []) {
      const id = genId('notch');
      pattern.notches[id] = { ...notch, id, edgeId: edgeIds.get(notch.edgeId) ?? notch.edgeId };
    }
    for (const annotation of this.clip.annotations ?? []) {
      const id = genId('note');
      pattern.annotations[id] = {
        ...annotation, id,
        panelId: panelIds.get(annotation.panelId) ?? annotation.panelId,
        pos: { x: annotation.pos.x + delta.x, y: annotation.pos.y + delta.y },
      };
    }
    for (const measurement of this.clip.measurements ?? []) {
      const id = genId('meas');
      pattern.measurements[id] = {
        ...measurement, id,
        panelId: panelIds.get(measurement.panelId) ?? measurement.panelId,
        refs: {
          ...(measurement.refs.pointAId ? { pointAId: pointIds.get(measurement.refs.pointAId) } : {}),
          ...(measurement.refs.pointBId ? { pointBId: pointIds.get(measurement.refs.pointBId) } : {}),
          ...(measurement.refs.edgeId ? { edgeId: edgeIds.get(measurement.refs.edgeId) } : {}),
        },
      };
    }

  }

  undo(ctx: ProjectContext): void {
    const pattern = ctx.project.pattern;
    for (const id of this.pastedPanelIds) delete pattern.panels[id];
    const pastedPanels = new Set(this.pastedPanelIds);
    for (const [id, record] of Object.entries(pattern.annotations ?? {})) {
      if (pastedPanels.has(record.panelId)) delete pattern.annotations[id];
    }
    for (const [id, record] of Object.entries(pattern.measurements ?? {})) {
      if (pastedPanels.has(record.panelId)) delete pattern.measurements[id];
    }
    for (const id of Object.keys(pattern.notches ?? {})) {
      const notch = pattern.notches[id];
      if (notch && this.created.edges.includes(notch.edgeId)) delete pattern.notches[id];
    }
    for (const id of this.created.seams) delete pattern.seams[id];
    for (const id of this.created.darts) delete pattern.darts[id];
    for (const id of this.created.lines) delete pattern.internalLines[id];
    for (const id of this.created.edges) delete pattern.edges[id];
    for (const id of this.created.points) delete pattern.points[id];
    this.pastedPanelIds = [];
  }
}

/** Copy name that does not clash with a panel already in the pattern. */
function nextCopyName(pattern: Pattern, sourceName: string): string {
  const taken = new Set(Object.values(pattern.panels).map(p => p.name));
  const base = `${sourceName} 副本`;
  if (!taken.has(base)) return base;
  let index = 2;
  while (taken.has(`${base} ${index}`)) index += 1;
  return `${base} ${index}`;
}
