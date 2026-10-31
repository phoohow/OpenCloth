import type { Command, ProjectContext } from './command';
import type {
  Annotation, Dart, InternalLine, Measurement, Notch, Panel, Pattern, PatternEdge, PatternPoint, Seam, Vec2,
} from '../model/types';
import { genId } from '../model/defaults';
import { SnapshotCommand } from './patternSnapshot';
import { prunePattern } from './patternStructureCommands';
import { filletCorner } from '../../pattern/geom/fillet';
import { edgeCurve, splitBezier } from '../../pattern/geom/bezier';
import { edgeLength, pointAtT } from '../../pattern/geom/edgeSample';

/** Outline edges a fillet replaced, with the lengths needed to rescale seam intervals. */
export interface FilletChange {
  /** Corner point the fillet was built on. */
  cornerPointId: string;
  /** The two edges it removed, in outline order. */
  removed: Array<{ edgeId: string; lengthCm: number; side: 'in' | 'out' }>;
  /** The three edges that replace them: trimmed inbound, arc, trimmed outbound. */
  added: Array<{ edgeId: string; lengthCm: number }>;
}

/** Edge ids referenced by either side of a seam. */
function seamEdgeIds(seam: Seam): string[] {
  return [seam.a?.edgeId ?? '', seam.b?.edgeId ?? ''];
}

/** Point placement on an edge at arc-length fraction t. */
export function edgePointAtT(pattern: Pattern, edgeId: string, t: number): Vec2 | null {
  return pointAtT(pattern, edgeId, t);
}

/**
 * Splits an edge into two edges with a new point at the given position,
 * preserving line, bezier and arc shape. Seam and outline references move to the pieces.
 */
export class AddPointOnEdgeCommand implements Command {
  readonly label = '线上加点';
  private newPointId = '';
  private newEdgeIds: [string, string] = ['', ''];
  private savedEdge: PatternEdge | null = null;
  /** Panels whose outline was rewritten, with a copy for undo. */
  private touchedPanels: Array<{ panelId: string; before: string[] }> = [];
  private seamFixups: Array<{ seamId: string; side: 'a' | 'b'; old: { edgeId: string; t0: number; t1: number } }> = [];

  /** @param at projected position on the edge, in cm */
  constructor(private edgeId: string, private at: Vec2) { }

  execute(ctx: ProjectContext): void {
    const pattern = ctx.project.pattern;
    const edge = pattern.edges[this.edgeId];
    if (!edge) throw new Error('边不存在，无法插入点');
    const start = pattern.points[edge.startPointId];
    const end = pattern.points[edge.endPointId];
    if (!start || !end) throw new Error('边端点缺失，无法插入点');

    const pointId = genId('pt');
    const id1 = genId('edge'), id2 = genId('edge');
    this.newPointId = pointId;
    this.newEdgeIds = [id1, id2];
    this.savedEdge = structuredClone(edge);

    const at = this.clampToEdge(pattern, edge);
    pattern.points[pointId] = { id: pointId, pos: at, kind: 'corner' };
    const mkEdge = (s: string, e: string): PatternEdge => ({
      id: genId('edge'), type: 'line', startPointId: s, endPointId: e, semantic: edge.semantic,
    });

    if (edge.type === 'bezier') {
      const curve = edgeCurve(pattern, edge);
      if (!curve) {
        pattern.edges[id1] = mkEdge(edge.startPointId, pointId);
        pattern.edges[id2] = mkEdge(pointId, edge.endPointId);
      } else {
        const t = curveParameterForPoint(pattern, edge, at);
        const [left, right] = splitBezier(curve, t);
        const e1 = mkEdge(edge.startPointId, pointId);
        const e2 = mkEdge(pointId, edge.endPointId);
        e1.type = 'bezier'; e2.type = 'bezier';
        pattern.edges[id1] = e1;
        pattern.edges[id2] = e2;
        start.kind = 'smooth'; start.handleOut = { ...left.c0 };
        const mid = pattern.points[pointId]!;
        mid.kind = 'smooth';
        mid.handleIn = { ...left.c1 }; mid.handleOut = { ...right.c0 };
        end.kind = 'smooth'; end.handleIn = { ...right.c1 };
      }
    } else if (edge.type === 'arc' && edge.arc) {
      const arc = edge.arc;
      const splitAngle = arc.startAngle + arcSweep(arc) * arcFractionAt(arc, at);
      const a1 = { ...arc, endAngle: splitAngle };
      const a2 = { ...arc, startAngle: splitAngle };
      const e1 = mkEdge(edge.startPointId, pointId); e1.type = 'arc'; e1.arc = a1;
      const e2 = mkEdge(pointId, edge.endPointId); e2.type = 'arc'; e2.arc = a2;
      pattern.edges[id1] = e1;
      pattern.edges[id2] = e2;
    } else {
      pattern.edges[id1] = mkEdge(edge.startPointId, pointId);
      pattern.edges[id2] = mkEdge(pointId, edge.endPointId);
    }
    delete pattern.edges[this.edgeId];

    this.touchedPanels = [];
    for (const panel of Object.values(pattern.panels)) {
      const idx = panel.outlineEdgeIds.indexOf(this.edgeId);
      if (idx < 0) continue;
      this.touchedPanels.push({ panelId: panel.id, before: [...panel.outlineEdgeIds] });
      const ids = [...panel.outlineEdgeIds];
      ids.splice(idx, 1, id1, id2);
      panel.outlineEdgeIds = ids;
      if (panel.holes?.length) {
        panel.holes = panel.holes.map(loop => {
          const j = loop.indexOf(this.edgeId);
          return j < 0 ? loop : [...loop.slice(0, j), id1, id2, ...loop.slice(j + 1)];
        });
      }
    }

    // Seams on the removed edge split their interval across the two new edges.
    this.seamFixups = [];
    for (const seam of Object.values(pattern.seams)) {
      for (const side of ['a', 'b'] as const) {
        const end = seam[side];
        if (end.edgeId !== this.edgeId) continue;
        this.seamFixups.push({ seamId: seam.id, side, old: { edgeId: end.edgeId, t0: end.t0, t1: end.t1 } });
        seam[side] = end.t0 < splitFraction(pattern, id1, id2, at)
          ? { ...end, edgeId: id1 }
          : { ...end, edgeId: id2 };
      }
    }
  }

  undo(ctx: ProjectContext): void {
    const pattern = ctx.project.pattern;
    if (!this.savedEdge) return;
    for (const fix of this.seamFixups) {
      const seam = pattern.seams[fix.seamId];
      if (seam) seam[fix.side] = fix.old;
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

  /** Projects `at` onto the edge and keeps it inside the edge bounds. */
  private clampToEdge(pattern: Pattern, edge: PatternEdge): Vec2 {
    if (edge.type === 'line') {
      const a = pattern.points[edge.startPointId]!.pos;
      const b = pattern.points[edge.endPointId]!.pos;
      const dx = b.x - a.x, dy = b.y - a.y;
      const lenSq = dx * dx + dy * dy;
      const t = lenSq === 0 ? 0.5 : Math.max(0, Math.min(1, ((this.at.x - a.x) * dx + (this.at.y - a.y) * dy) / lenSq));
      return { x: a.x + dx * t, y: a.y + dy * t };
    }
    return { ...this.at };
  }
}

/** Split fraction along the parent edge where the new point sits (approximate, chord based). */
function splitFraction(pattern: Pattern, id1: string, id2: string, at: Vec2): number {
  const e1 = pattern.edges[id1];
  const e2 = pattern.edges[id2];
  if (!e1 || !e2) return 0.5;
  const a = pattern.points[e1.startPointId]?.pos;
  const b = pattern.points[e2.endPointId]?.pos;
  if (!a || !b) return 0.5;
  const total = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const before = Math.hypot(at.x - a.x, at.y - a.y);
  return Math.max(0, Math.min(1, before / total));
}

/** Curve parameter whose point is nearest to `p`. */
function curveParameterForPoint(pattern: Pattern, edge: PatternEdge, p: Vec2): number {
  const curve = edgeCurve(pattern, edge);
  if (!curve) return 0.5;
  let bestT = 0.5;
  let bestD = Infinity;
  for (let i = 0; i <= 48; i++) {
    const t = i / 48;
    const q = evalBezierAt(curve, t);
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < bestD) { bestD = d; bestT = t; }
  }
  return bestT;
}

function evalBezierAt(b: { p0: Vec2; c0: Vec2; c1: Vec2; p1: Vec2 }, t: number): Vec2 {
  const mt = 1 - t;
  const a = mt * mt * mt, bc = 3 * mt * mt * t, c = 3 * mt * t * t, d = t * t * t;
  return {
    x: a * b.p0.x + bc * b.c0.x + c * b.c1.x + d * b.p1.x,
    y: a * b.p0.y + bc * b.c0.y + c * b.c1.y + d * b.p1.y,
  };
}

/** Signed sweep of an arc in radians. */
function arcSweep(arc: { startAngle: number; endAngle: number; ccw: boolean }): number {
  let d = (arc.endAngle - arc.startAngle) % (Math.PI * 2);
  if (d < 0) d += Math.PI * 2;
  return arc.ccw ? d : d - Math.PI * 2;
}

/** Arc-length fraction along an arc whose point is nearest to `p`. */
function arcFractionAt(arc: { center: Vec2; radius: number; startAngle: number; endAngle: number; ccw: boolean }, p: Vec2): number {
  const angle = Math.atan2(p.y - arc.center.y, p.x - arc.center.x);
  let delta = (angle - arc.startAngle) % (Math.PI * 2);
  if (delta < 0) delta += Math.PI * 2;
  if (!arc.ccw && delta > Math.PI) delta -= Math.PI * 2;
  if (arc.ccw && delta > Math.PI) delta -= Math.PI * 2;
  const sweep = arcSweep(arc);
  return sweep === 0 ? 0.5 : Math.max(0, Math.min(1, delta / sweep));
}

/** Deletes selected panels with their edges, points, darts and internal lines. */
export class DeleteSelectionCommand implements Command {
  readonly label = '删除版型片';
  private saved: {
    panels: Panel[]; edges: PatternEdge[]; points: PatternPoint[];
    darts: Dart[]; lines: InternalLine[]; seams: Seam[];
    notches: Notch[];
    annotations: Annotation[];
    measurements: Measurement[];
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
    for (const p of panels) {
      for (const eid of p.outlineEdgeIds) edgeIds.add(eid);
      for (const loop of p.holes ?? []) for (const eid of loop) edgeIds.add(eid);
    }
    const pointIds = new Set<string>();
    for (const eid of edgeIds) {
      const e = pattern.edges[eid];
      if (e) { pointIds.add(e.startPointId); pointIds.add(e.endPointId); }
    }

    // Reject when remaining panels or darts reference the same edges or points.
    for (const panel of Object.values(pattern.panels)) {
      if (deleting.has(panel.id)) continue;
      for (const eid of [...panel.outlineEdgeIds, ...(panel.holes ?? []).flat()]) {
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
      seams: Object.values(pattern.seams).filter(s => seamEdgeIds(s).some(id => edgeIds.has(id))),
      notches: Object.values(pattern.notches ?? {}).filter(n => edgeIds.has(n.edgeId)),
      annotations: Object.values(pattern.annotations ?? {}).filter(a => deleting.has(a.panelId)),
      measurements: Object.values(pattern.measurements ?? {}).filter(m => deleting.has(m.panelId)),
    };

    for (const id of deleting) delete pattern.panels[id];
    for (const e of this.saved.edges) delete pattern.edges[e.id];
    for (const p of this.saved.points) delete pattern.points[p.id];
    for (const d of this.saved.darts) delete pattern.darts[d.id];
    for (const l of this.saved.lines) delete pattern.internalLines[l.id];
    for (const s of this.saved.seams) delete pattern.seams[s.id];
    for (const n of this.saved.notches) delete pattern.notches![n.id];
    for (const a of this.saved.annotations) delete pattern.annotations![a.id];
    for (const m of this.saved.measurements) delete pattern.measurements![m.id];
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
    pattern.notches ??= {};
    pattern.annotations ??= {};
    pattern.measurements ??= {};
    for (const n of saved.notches) pattern.notches[n.id] = n;
    for (const a of saved.annotations) pattern.annotations[a.id] = a;
    for (const m of saved.measurements) pattern.measurements[m.id] = m;
    this.saved = null;
  }

  private dartPanelId(pattern: Pattern, dartId: string): string {
    for (const panel of Object.values(pattern.panels)) {
      if (panel.dartIds.includes(dartId)) return panel.id;
    }
    return '';
  }
}

/** Replaces one curve handle of a point; a smooth point mirrors its opposite handle. */
export class SetPointHandleCommand implements Command {
  readonly label = '调整曲线手柄';
  private prev: PatternPoint | null = null;

  /** @param which handle to write: 'in' is the reach of the edge ending here */
  constructor(private pointId: string, private which: 'in' | 'out', private to: Vec2) { }

  execute(ctx: ProjectContext): void {
    const pattern = ctx.project.pattern;
    const point = pattern.points[this.pointId];
    if (!point) throw new Error('点不存在，无法调整手柄');
    this.prev = structuredClone(point);
    point.kind = point.kind ?? 'smooth';
    const value = { ...this.to };
    if (this.which === 'in') point.handleIn = value;
    else point.handleOut = value;
    if (point.kind === 'smooth') {
      const mirrored = { x: 2 * point.pos.x - this.to.x, y: 2 * point.pos.y - this.to.y };
      if (this.which === 'in') point.handleOut = mirrored;
      else point.handleIn = mirrored;
    }
  }

  undo(ctx: ProjectContext): void {
    if (!this.prev) return;
    ctx.project.pattern.points[this.pointId] = this.prev;
    this.prev = null;
  }
}

/** Sets a point's corner/smooth kind without moving it. */
export class SetPointKindCommand implements Command {
  readonly label = '修改点类型';
  private prevKind: PatternPoint['kind'] | undefined;

  constructor(private pointId: string, private kind: 'corner' | 'smooth') { }

  execute(ctx: ProjectContext): void {
    const point = ctx.project.pattern.points[this.pointId];
    if (!point) throw new Error('点不存在');
    this.prevKind = point.kind;
    point.kind = this.kind;
  }

  undo(ctx: ProjectContext): void {
    const point = ctx.project.pattern.points[this.pointId];
    if (point) point.kind = this.prevKind;
  }
}

/** Rounds selected outline corners into tangent arcs and rewires the panel outlines. */
export class FilletCornersCommand extends SnapshotCommand {
  readonly label = '生成圆角';

  /** @param pointIds corner points, each shared by exactly two outline edges */
  constructor(private pointIds: string[], private radiusCm: number) { super(); }

  protected apply(pattern: Pattern, ctx: ProjectContext): void {
    applyFillets(pattern, this.pointIds, this.radiusCm);
    void ctx;
  }
}

/**
 * Fillets each corner and splices the replacement edges back into every outline and hole
 * loop that used them. Throws when a corner has no pair of outline edges or the radius
 * does not fit. Seam intervals move onto the trimmed edges they still cover.
 */
export function applyFillets(pattern: Pattern, pointIds: string[], radiusCm: number): FilletChange[] {
  const changes: FilletChange[] = [];
  const removed = new Map<string, string[]>();
  for (const pointId of pointIds) {
    const incident = outlineEdgesAt(pattern, pointId);
    if (incident.length !== 2) throw new Error('圆角需要相邻的两条轮廓边');
    const inEdge = incident.find(e => e.endPointId === pointId);
    const outEdge = incident.find(e => e.startPointId === pointId);
    if (!inEdge || !outEdge) throw new Error('圆角需要一进一出的两条轮廓边');

    const before = [inEdge.id, outEdge.id];
    const beforeLengths = [edgeLength(pattern, inEdge.id), edgeLength(pattern, outEdge.id)];
    const result = filletCorner(pattern, pointId, radiusCm, (startPointId, endPointId) => ({
      id: genId('edge'), type: 'line', startPointId, endPointId,
    }));
    if (!result) throw new Error('圆角半径过大，超出相邻边长');

    const [keptIn, arc, keptOut] = result.edges;
    changes.push({
      cornerPointId: pointId,
      removed: [
        { edgeId: inEdge.id, lengthCm: beforeLengths[0], side: 'in' },
        { edgeId: outEdge.id, lengthCm: beforeLengths[1], side: 'out' },
      ],
      added: [
        { edgeId: keptIn!.id, lengthCm: edgeLength(pattern, keptIn!.id) },
        { edgeId: arc!.id, lengthCm: edgeLength(pattern, arc!.id) },
        { edgeId: keptOut!.id, lengthCm: edgeLength(pattern, keptOut!.id) },
      ],
    });
    removed.set(before.join('>'), [keptIn!.id, arc!.id, keptOut!.id]);
  }
  for (const panel of Object.values(pattern.panels)) {
    panel.outlineEdgeIds = spliceChain(panel.outlineEdgeIds, removed);
    if (panel.holes?.length) panel.holes = panel.holes.map(loop => spliceChain(loop, removed));
  }
  remapSeamsAfterFillet(pattern, changes);
  prunePattern(pattern);
  return changes;
}

/** Moves seam intervals that sat on a filleted edge onto the trimmed edge that remains. */
function remapSeamsAfterFillet(pattern: Pattern, changes: FilletChange[]): void {
  const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
  const dead: string[] = [];
  for (const seam of Object.values(pattern.seams)) {
    for (const end of [seam.a, seam.b]) {
      const hit = changes.flatMap(c => c.removed.map(r => ({ change: c, edge: r })))
        .find(entry => entry.edge.edgeId === end.edgeId);
      if (!hit) continue;
      const inbound = hit.edge.side === 'in';
      const kept = inbound ? hit.change.added[0] : hit.change.added[2];
      const share = hit.edge.lengthCm > 0 ? kept.lengthCm / hit.edge.lengthCm : 0;
      const cut = 1 - share;
      const scale = share > 1e-6 ? share : 1;
      const map = (t: number): number => clamp01(inbound ? t / scale : (t - cut) / scale);
      end.edgeId = kept.edgeId;
      end.t0 = map(end.t0);
      end.t1 = map(end.t1);
      if (end.anchorT !== undefined) end.anchorT = map(end.anchorT);
      if (end.t1 - end.t0 < 0.01) {
        if (end.t0 + 0.01 <= 1) end.t1 = end.t0 + 0.01;
        else end.t0 = end.t1 = 1;
      }
    }
    if (seam.a.t1 - seam.a.t0 < 0.01 || seam.b.t1 - seam.b.t0 < 0.01) dead.push(seam.id);
  }
  for (const id of dead) delete pattern.seams[id];
}

/** Outline or hole edges of the pattern that touch a point. */
function outlineEdgesAt(pattern: Pattern, pointId: string): PatternEdge[] {
  const ids = new Set(Object.values(pattern.panels).flatMap(p => [...p.outlineEdgeIds, ...(p.holes ?? []).flat()]));
  return [...ids].map(id => pattern.edges[id]).filter((e): e is PatternEdge =>
    !!e && (e.startPointId === pointId || e.endPointId === pointId));
}

/**
 * Replaces every occurrence of a removed edge chain with its filleted replacement.
 * Outlines are cycles, so a chain spanning the last and first entry is rotated into place.
 */
function spliceChain(ids: string[], removed: Map<string, string[]>): string[] {
  let out = ids;
  for (const [key, replacement] of removed) {
    const from = key.split('>');
    const doubled = [...out, ...out];
    const idx = out.findIndex((_, i) => from.every((id, k) => doubled[i + k] === id));
    if (idx < 0) continue;
    const rotated = [...out.slice(idx), ...out.slice(0, idx)];
    out = [...replacement, ...rotated.slice(from.length)];
  }
  return out;
}
