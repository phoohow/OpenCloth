import type { Command, ProjectContext } from './command';
import type {
  Dart, InternalLine, Panel, Pattern, PatternEdge, PatternPoint, Seam, Vec2,
} from '../model/types';
import { genId } from '../model/defaults';

/** Splits a line edge into two edges with a new corner point at the clicked position. */
export class AddPointOnEdgeCommand implements Command {
  readonly label = '线上加点';
  private newPointId = '';
  private newEdgeIds: [string, string] = ['', ''];
  private savedEdge: PatternEdge | null = null;
  /** Panels whose outline was rewritten, with a copy for undo. */
  private touchedPanels: Array<{ panelId: string; before: string[] }> = [];
  private seamFixups: Array<{ seamId: string; field: 'edgeAId' | 'edgeBId'; oldEdgeId: string }> = [];

  /** @param at projected position on the edge, in cm */
  constructor(private edgeId: string, private at: Vec2) { }

  execute(ctx: ProjectContext): void {
    const pattern = ctx.project.pattern;
    const edge = pattern.edges[this.edgeId];
    if (!edge) throw new Error('边不存在，无法插入点');
    if (edge.type === 'bezier') throw new Error('暂不支持在贝塞尔曲线上插入点');
    const start = pattern.points[edge.startPointId];
    const end = pattern.points[edge.endPointId];
    if (!start || !end) throw new Error('边端点缺失，无法插入点');

    // Snap the clicked position onto the edge by projecting it.
    const a = start.pos, b = end.pos;
    const dx = b.x - a.x, dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq === 0 ? 0.5 : Math.max(0, Math.min(1, ((this.at.x - a.x) * dx + (this.at.y - a.y) * dy) / lenSq));
    const at: Vec2 = { x: a.x + dx * t, y: a.y + dy * t };

    const pointId = genId('pt');
    const id1 = genId('edge'), id2 = genId('edge');
    this.newPointId = pointId;
    this.newEdgeIds = [id1, id2];
    this.savedEdge = { ...edge };

    pattern.points[pointId] = { id: pointId, pos: at };
    pattern.edges[id1] = { id: id1, type: 'line', startPointId: edge.startPointId, endPointId: pointId, semantic: edge.semantic };
    pattern.edges[id2] = { id: id2, type: 'line', startPointId: pointId, endPointId: edge.endPointId, semantic: edge.semantic };
    delete pattern.edges[this.edgeId];

    this.touchedPanels = [];
    for (const panel of Object.values(pattern.panels)) {
      const idx = panel.outlineEdgeIds.indexOf(this.edgeId);
      if (idx < 0) continue;
      this.touchedPanels.push({ panelId: panel.id, before: [...panel.outlineEdgeIds] });
      const ids = [...panel.outlineEdgeIds];
      ids.splice(idx, 1, id1, id2);
      panel.outlineEdgeIds = ids;
    }

    // Reattach seams from the removed edge to its first segment.
    this.seamFixups = [];
    for (const seam of Object.values(pattern.seams)) {
      for (const field of ['edgeAId', 'edgeBId'] as const) {
        if (seam[field] !== this.edgeId) continue;
        this.seamFixups.push({ seamId: seam.id, field, oldEdgeId: this.edgeId });
        seam[field] = id1;
      }
    }

  }

  undo(ctx: ProjectContext): void {
    const pattern = ctx.project.pattern;
    if (!this.savedEdge) return;
    for (const fix of this.seamFixups) {
      const seam = pattern.seams[fix.seamId];
      if (seam) seam[fix.field] = fix.oldEdgeId;
    }
    for (const { panelId, before } of this.touchedPanels) {
      const panel = pattern.panels[panelId];
      if (panel) panel.outlineEdgeIds = before;
    }
    delete pattern.edges[this.newEdgeIds[0]];
    delete pattern.edges[this.newEdgeIds[1]];
    delete pattern.points[this.newPointId];
    pattern.edges[this.savedEdge.id] = this.savedEdge;
  }
}

/** Deletes selected panels with their edges, points, darts and internal lines. */
export class DeleteSelectionCommand implements Command {
  readonly label = '删除版型片';
  private saved: {
    panels: Panel[]; edges: PatternEdge[]; points: PatternPoint[];
    darts: Dart[]; lines: InternalLine[]; seams: Seam[];
  } | null = null;

  /** @param panelIds selected panel ids */
  constructor(private panelIds: string[]) { }

  execute(ctx: ProjectContext): void {
    const pattern = ctx.project.pattern;
    const panels = this.panelIds
      .map(id => pattern.panels[id])
      .filter((p): p is Panel => !!p);
    if (panels.length === 0) throw new Error('没有可删除的版型片');

    const deleting = new Set(panels.map(p => p.id));
    const edgeIds = new Set<string>();
    for (const p of panels) for (const eid of p.outlineEdgeIds) edgeIds.add(eid);
    const pointIds = new Set<string>();
    for (const eid of edgeIds) {
      const e = pattern.edges[eid];
      if (e) { pointIds.add(e.startPointId); pointIds.add(e.endPointId); }
    }

    // Reject when remaining panels or darts reference the same edges or points.
    for (const panel of Object.values(pattern.panels)) {
      if (deleting.has(panel.id)) continue;
      for (const eid of panel.outlineEdgeIds) {
        if (edgeIds.has(eid)) throw new Error('所选版型片与其他版型片共用边，无法删除');
        const e = pattern.edges[eid];
        if (e && (pointIds.has(e.startPointId) || pointIds.has(e.endPointId))) {
          throw new Error('所选版型片与其他版型片共用点，无法删除');
        }
      }
    }
    for (const dart of Object.values(pattern.darts)) {
      if (deleting.has(this.dartPanelId(pattern, dart.id))) continue;
      if (pointIds.has(dart.tipId) || edgeIds.has(dart.edge1Id) || edgeIds.has(dart.edge2Id)) {
        throw new Error('其他省道引用了所选几何，无法删除');
      }
    }

    const dartIds = new Set<string>();
    const lineIds = new Set<string>();
    for (const p of panels) {
      for (const d of p.dartIds) dartIds.add(d);
      for (const l of p.internalLineIds) lineIds.add(l);
    }

    this.saved = {
      panels,
      edges: [...edgeIds].map(id => pattern.edges[id]).filter((e): e is PatternEdge => !!e),
      points: [...pointIds].map(id => pattern.points[id]).filter((p): p is PatternPoint => !!p),
      darts: [...dartIds].map(id => pattern.darts[id]).filter((d): d is Dart => !!d),
      lines: [...lineIds].map(id => pattern.internalLines[id]).filter((l): l is InternalLine => !!l),
      seams: Object.values(pattern.seams).filter(s => edgeIds.has(s.edgeAId) || edgeIds.has(s.edgeBId)),
    };

    for (const id of deleting) delete pattern.panels[id];
    for (const e of this.saved.edges) delete pattern.edges[e.id];
    for (const p of this.saved.points) delete pattern.points[p.id];
    for (const d of this.saved.darts) delete pattern.darts[d.id];
    for (const l of this.saved.lines) delete pattern.internalLines[l.id];
    for (const s of this.saved.seams) delete pattern.seams[s.id];

  }

  undo(ctx: ProjectContext): void {
    const pattern = ctx.project.pattern;
    const saved = this.saved;
    if (!saved) return;
    for (const p of saved.panels) pattern.panels[p.id] = p;
    for (const e of saved.edges) pattern.edges[e.id] = e;
    for (const pt of saved.points) pattern.points[pt.id] = pt;
    for (const d of saved.darts) pattern.darts[d.id] = d;
    for (const l of saved.lines) pattern.internalLines[l.id] = l;
    for (const s of saved.seams) pattern.seams[s.id] = s;
    this.saved = null;
  }

  private dartPanelId(pattern: Pattern, dartId: string): string {
    for (const panel of Object.values(pattern.panels)) {
      if (panel.dartIds.includes(dartId)) return panel.id;
    }
    return '';
  }
}
