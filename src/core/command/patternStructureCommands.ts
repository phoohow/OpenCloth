import type { Command, ProjectContext } from './command';
import type { ArcGeom, InternalLine, Panel, Pattern, PatternEdge, SeamEnd, Vec2 } from '../model/types';
import { parseElementNodeId, type PatternElementKind } from '../model/elementRef';
import { genId } from '../model/defaults';
import polygonClipping from 'polygon-clipping';
import { edgeLength, pointAtT } from '../../pattern/geom/edgeSample';
import { computePolylineNormals, hasSelfIntersection } from '../../pattern/geom/offset';
import { computeBBox } from '../../pattern/geom/vec2';
import { samplePanelOutline } from '../../pattern/panel/panelBuilder';
import { SnapshotCommand } from './patternSnapshot';
import { addClosedLineOutline, makePanel, newEdge, newPoint } from './patternCreateCommands';
import { refitArcs } from './patternMoveGeometry';
import { prunePattern } from './patternPrune';
import { buildMirrorEdges, type MirrorAxis } from './patternSymmetry';

export { prunePattern };
export type { MirrorAxis };

// The library's ESM build exposes one default object; named imports break the production bundle.
const { union, difference } = polygonClipping;

type Pair = [number, number];

const toRing = (pts: Vec2[]): Pair[] => pts.map(p => [p.x, p.y]);
const ringToVec = (ring: Pair[]): Vec2[] => ring.map(([x, y]) => ({ x, y }));
const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
const lerpV = (a: Vec2, b: Vec2, k: number): Vec2 => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
const norm = (v: Vec2): Vec2 => { const l = Math.hypot(v.x, v.y) || 1; return { x: v.x / l, y: v.y / l }; };

/** Ray-casting point-in-polygon test. */
export function insidePolygon(poly: Vec2[], p: Vec2): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Centroid of a panel's sampled outline, used to orient dart tips inward. */
function panelCentroid(pattern: Pattern, panel: Panel): Vec2 {
  const pts = samplePanelOutline(pattern, panel);
  if (pts.length === 0) return { x: 0, y: 0 };
  const sum = pts.reduce((s, p) => ({ x: s.x + p.x, y: s.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / pts.length, y: sum.y / pts.length };
}

/** Inserts a polygon ring as fresh points and line edges; returns its edge ids. */
function insertRing(pattern: Pattern, ring: Vec2[]): string[] {
  return addClosedLineOutline(pattern, ring);
}

/** Adds internal fold/decor/split line and links it to a panel. */
export class AddInternalLineCommand extends SnapshotCommand {
  readonly label = '添加内部线';
  constructor(private panelId: string, private points: Vec2[], private kind: InternalLine['kind'] = 'decor') { super(); }

  protected apply(pattern: Pattern, _ctx: ProjectContext): void {
    const panel = pattern.panels[this.panelId];
    if (!panel) throw new Error('版片不存在');
    if (this.points.length < 2) throw new Error('内部线至少需要 2 个点');
    const outline = samplePanelOutline(pattern, panel);
    for (const p of this.points) {
      if (!insidePolygon(outline, p)) throw new Error('内部线必须在版片轮廓内');
    }
    const id = genId('line');
    const line: InternalLine = { id, kind: this.kind, points: this.points.map(p => ({ x: p.x, y: p.y })) };
    pattern.internalLines[id] = line;
    panel.internalLineIds.push(id);
  }
}

/** Splits a panel into two along a boundary-to-boundary cut polyline. */
export class OutlineSplitCommand extends SnapshotCommand {
  readonly label = '轮廓分割';
  constructor(private panelId: string, private cutPoints: Vec2[]) { super(); }

  protected apply(pattern: Pattern, _ctx: ProjectContext): void {
    const panel = pattern.panels[this.panelId];
    if (!panel) throw new Error('版片不存在');
    if (this.cutPoints.length < 2) throw new Error('分割线至少需要 2 个点');

    const outline = samplePanelOutline(pattern, panel);
    const bbox = computeBBox(outline);
    const reach = Math.hypot(bbox.max.x - bbox.min.x, bbox.max.y - bbox.min.y) + 1;
    const dir0 = norm(sub(this.cutPoints[0], this.cutPoints[1]));
    const dir1 = norm(sub(this.cutPoints.at(-1)!, this.cutPoints.at(-2)!));
    const extended = [
      add(this.cutPoints[0], mul(dir0, reach)),
      ...this.cutPoints,
      add(this.cutPoints.at(-1)!, mul(dir1, reach)),
    ];
    const band = cutBand(extended, 0.02);
    const comps = difference([[toRing(outline)]], [[toRing(band)]]);
    const rings = comps.map(poly => poly.map(ringToVec));
    if (rings.length !== 2) throw new Error('分割线未将版片切开，请让分割线两端落在轮廓上');

    const [keep, other] = rings;
    panel.outlineEdgeIds = insertRing(pattern, keep[0]);
    panel.holes = (keep.slice(1) ?? []).map(r => insertRing(pattern, r));
    const copy: Panel = structuredClone(panel);
    const newId = genId('panel');
    copy.id = newId;
    copy.name = `${panel.name} 分割`;
    copy.outlineEdgeIds = insertRing(pattern, other[0]);
    copy.holes = (other.slice(1) ?? []).map(r => insertRing(pattern, r));
    copy.dartIds = [];
    copy.internalLineIds = [];
    pattern.panels[newId] = copy;
    prunePattern(pattern);
  }
}

/** Thin closed strip around a polyline, used to cut a panel with polygon-clipping. */
function cutBand(points: Vec2[], w: number): Vec2[] {
  const normals = computePolylineNormals(points);
  const fwd = points.map((p, i) => add(p, mul(normals[i], w)));
  const back = points.map((p, i) => add(p, mul(normals[i], -w))).reverse();
  return [...fwd, ...back];
}

/** Merges two overlapping panels into one via boolean union. */
export class MergePanelsCommand extends SnapshotCommand {
  readonly label = '合并版片';
  constructor(private panelIds: [string, string]) { super(); }

  protected apply(pattern: Pattern, _ctx: ProjectContext): void {
    const [aId, bId] = this.panelIds;
    const a = pattern.panels[aId];
    const b = pattern.panels[bId];
    if (!a || !b) throw new Error('待合并的版片不存在');
    const pa = samplePanelOutline(pattern, a);
    const pb = samplePanelOutline(pattern, b);
    const u = union([[toRing(pa)]], [[toRing(pb)]]);
    if (u.length !== 1) throw new Error('两个版片不相交，无法合并');
    const rings = u[0].map(ringToVec);
    a.outlineEdgeIds = insertRing(pattern, rings[0]);
    a.holes = (rings.slice(1) ?? []).map(r => insertRing(pattern, r));
    delete pattern.panels[bId];
    prunePattern(pattern);
  }
}

/** Cuts a closed loop out of a panel. */
export class OutlineHoleCommand extends SnapshotCommand {
  readonly label = '添加内孔';
  constructor(private panelId: string, private loopPoints: Vec2[]) { super(); }

  protected apply(pattern: Pattern, _ctx: ProjectContext): void {
    const panel = pattern.panels[this.panelId];
    if (!panel) throw new Error('版片不存在');
    if (this.loopPoints.length < 3) throw new Error('内孔至少需要 3 个点');
    if (hasSelfIntersection(this.loopPoints)) throw new Error('内孔轮廓不能自相交');
    const outline = samplePanelOutline(pattern, panel);
    for (const p of this.loopPoints) {
      if (!insidePolygon(outline, p)) throw new Error('内孔必须完全位于版片轮廓内');
    }
    const loop = insertRing(pattern, this.loopPoints);
    (panel.holes ??= []).push(loop);
  }
}

/** Removes a hole loop and its now-unused geometry. */
export class RemoveHoleCommand extends SnapshotCommand {
  readonly label = '删除内孔';
  constructor(private panelId: string, private holeLoop: string[]) { super(); }

  protected apply(pattern: Pattern, _ctx: ProjectContext): void {
    const panel = pattern.panels[this.panelId];
    if (!panel?.holes) throw new Error('版片没有内孔');
    const key = this.holeLoop.join('|');
    const idx = panel.holes.findIndex(loop => loop.join('|') === key);
    if (idx < 0) throw new Error('内孔不存在');
    panel.holes.splice(idx, 1);
    if (panel.holes.length === 0) delete panel.holes;
    prunePattern(pattern);
  }
}

/** Inserts a tip vertex on a panel outline and reroutes the outline through it. */
export class CreateDartCommand extends SnapshotCommand {
  readonly label = '创建省道';
  constructor(
    private panelId: string, private edge1Id: string, private t1: number,
    private edge2Id: string, private t2: number,
    private intakeCm: number, private tipPos?: Vec2,
  ) { super(); }

  protected apply(pattern: Pattern, _ctx: ProjectContext): void {
    const panel = pattern.panels[this.panelId];
    if (!panel) throw new Error('版片不存在');
    const e1 = pattern.edges[this.edge1Id];
    const e2 = pattern.edges[this.edge2Id];
    if (!e1 || !e2) throw new Error('省边不存在');
    if (e1.type !== 'line' || e2.type !== 'line') throw new Error('省道暂仅支持直线省边');
    if (e1.endPointId !== e2.startPointId) throw new Error('省道需在轮廓上相邻的两条边之间创建');
    if (!(this.intakeCm > 0)) throw new Error('省量需为正数');

    // Split each leg edge so a new vertex sits exactly on the dart base points.
    const baseA = pointAtT(pattern, this.edge1Id, this.t1)!;
    const baseB = pointAtT(pattern, this.edge2Id, this.t2)!;
    const [, edge1b] = this.splitLineAt(pattern, panel, this.edge1Id, baseA);
    const [, edge2b] = this.splitLineAt(pattern, panel, this.edge2Id, baseB);
    const corner = pattern.points[e1.endPointId]!.pos;
    const tip = this.tipPos ?? lerpV(corner, panelCentroid(pattern, panel), 0.45);

    // The two edges bracketing the corner (baseA->corner, corner->baseB) collapse into the tip.
    const tipId = newPoint(pattern, tip);
    const baseAId = edgeStartId(pattern, edge1b);
    const baseBId = edgeStartId(pattern, edge2b);
    const leg1 = newEdge(pattern, 'line', baseAId, tipId);
    const leg2 = newEdge(pattern, 'line', tipId, baseBId);

    const wedge = panel.outlineEdgeIds.indexOf(edge1b);
    panel.outlineEdgeIds.splice(wedge, 2, leg1, leg2);

    const dartId = genId('dart');
    pattern.darts[dartId] = { id: dartId, tipId, edge1Id: leg1, edge2Id: leg2, intakeCm: this.intakeCm };
    panel.dartIds.push(dartId);
    prunePattern(pattern);
  }

  /** Splits a line edge at a point, replacing it in the panel outline; returns the two piece ids. */
  private splitLineAt(pattern: Pattern, panel: Panel, edgeId: string, at: Vec2): [string, string] {
    const edge = pattern.edges[edgeId];
    const midId = newPoint(pattern, at);
    const id1 = newEdge(pattern, 'line', edge.startPointId, midId);
    const id2 = newEdge(pattern, 'line', midId, edge.endPointId);
    const idx = panel.outlineEdgeIds.indexOf(edgeId);
    panel.outlineEdgeIds.splice(idx, 1, id1, id2);
    delete pattern.edges[edgeId];
    return [id1, id2];
  }
}

function edgeStartId(pattern: Pattern, id: string): string { return pattern.edges[id].startPointId; }

/** Moves a dart tip point to a new position. */
export class MoveDartTipCommand extends SnapshotCommand {
  readonly label = '移动省尖';
  constructor(private dartId: string, private newPos: Vec2) { super(); }

  protected apply(pattern: Pattern, _ctx: ProjectContext): void {
    const dart = pattern.darts[this.dartId];
    if (!dart) throw new Error('省道不存在');
    const tip = pattern.points[dart.tipId];
    if (!tip) throw new Error('省尖点不存在');
    tip.pos = { x: this.newPos.x, y: this.newPos.y };
  }
}

/**
 * Re-anchors a dart's first leg onto another outline edge at arc fraction `t`.
 * Simplification: the tip stays fixed and only the base vertex moves; the outline is not
 * reshaped around the tip, so area conservation is approximate.
 */
export class TransferDartCommand extends SnapshotCommand {
  readonly label = '转移省道';
  constructor(private dartId: string, private targetEdgeId: string, private t: number) { super(); }

  protected apply(pattern: Pattern, _ctx: ProjectContext): void {
    const dart = pattern.darts[this.dartId];
    if (!dart) throw new Error('省道不存在');
    const target = pattern.edges[this.targetEdgeId];
    if (!target) throw new Error('目标边不存在');
    const leg1 = pattern.edges[dart.edge1Id];
    if (!leg1) throw new Error('省边不存在');
    const at = pointAtT(pattern, this.targetEdgeId, this.t);
    if (!at) throw new Error('无法在目标边上定位省道');
    pattern.points[leg1.startPointId].pos = { x: at.x, y: at.y };
    refitArcs(pattern, new Set([leg1.startPointId]));
  }
}

/** Creates a mirrored copy of a panel, linked for symmetric editing. */
export class MirrorPanelCommand extends SnapshotCommand {
  readonly label = '镜像版片';
  readonly skipMirrorSync = true;
  /** Panel id created by execute, for selection after mirror. */
  mirroredPanelId = '';
  constructor(private sourcePanelId: string, private axis: MirrorAxis) { super(); }

  protected apply(pattern: Pattern, ctx: ProjectContext): void {
    const source = pattern.panels[this.sourcePanelId];
    if (!source) throw new Error('源版片不存在');
    const { edgeIds } = buildMirrorEdges(pattern, source, this.axis);
    const panel = makePanel(pattern, ctx, { name: `${source.name} 镜像`, seamAllowanceCm: source.seamAllowanceCm }, edgeIds);
    panel.fabricId = source.fabricId;
    panel.symmetry = { axisEdgeId: this.axis, linkedPanelId: source.id };
    source.symmetry = { axisEdgeId: this.axis, linkedPanelId: panel.id };
    this.mirroredPanelId = panel.id;
  }
}

/** Rebuilds a panel's mirror so it matches the source's current geometry. */
export class SyncMirrorCommand extends SnapshotCommand {
  readonly label = '同步镜像';
  readonly skipMirrorSync = true;
  constructor(private sourcePanelId: string) { super(); }

  protected apply(pattern: Pattern, _ctx: ProjectContext): void {
    const source = pattern.panels[this.sourcePanelId];
    if (!source) throw new Error('源版片不存在');
    const mirror = Object.values(pattern.panels).find(p => p.symmetry?.linkedPanelId === source.id && p.id !== source.id);
    if (!mirror) throw new Error('未找到关联镜像版片');
    const { edgeIds } = buildMirrorEdges(pattern, source, mirror.symmetry!.axisEdgeId);
    mirror.outlineEdgeIds = edgeIds;
    prunePattern(pattern);
  }
}

/** Removes selected non-panel elements: markings, lines, seams, darts, edges and vertices. */
export class DeleteElementsCommand extends SnapshotCommand {
  readonly label = '删除元素';
  /** @param rows selection rows; plain panel ids are ignored */
  constructor(private rows: string[]) { super(); }

  protected apply(pattern: Pattern, _ctx: ProjectContext): void {
    let removed = 0;
    for (const row of this.rows) {
      const el = parseElementNodeId(row);
      if (!el || el.kind === 'panel') continue;
      if (removeElement(pattern, el.kind, el.id)) removed++;
    }
    if (removed === 0) throw new Error('没有可删除的元素');
    prunePattern(pattern);
  }
}

/** Deletes one element and its owner reference; false when the element does not exist. */
function removeElement(pattern: Pattern, kind: PatternElementKind, id: string): boolean {
  switch (kind) {
    case 'notch':
      if (!pattern.notches?.[id]) return false;
      delete pattern.notches[id];
      return true;
    case 'annotation':
      if (!pattern.annotations?.[id]) return false;
      delete pattern.annotations[id];
      return true;
    case 'measurement':
      if (!pattern.measurements?.[id]) return false;
      delete pattern.measurements[id];
      return true;
    case 'print':
      if (!pattern.prints?.[id]) return false;
      delete pattern.prints[id];
      return true;
    case 'topstitch':
      if (!pattern.topstitches?.[id]) return false;
      delete pattern.topstitches[id];
      return true;
    case 'trim':
      if (!pattern.trims?.[id]) return false;
      delete pattern.trims[id];
      return true;
    case 'seam':
      if (!pattern.seams[id]) return false;
      delete pattern.seams[id];
      return true;
    case 'internal': {
      const line = pattern.internalLines[id];
      if (!line) return false;
      delete pattern.internalLines[id];
      for (const panel of Object.values(pattern.panels)) {
        const i = panel.internalLineIds.indexOf(id);
        if (i >= 0) panel.internalLineIds.splice(i, 1);
      }
      return true;
    }
    case 'dart':
      if (!pattern.darts[id]) return false;
      delete pattern.darts[id];
      for (const panel of Object.values(pattern.panels)) {
        const i = panel.dartIds.indexOf(id);
        if (i >= 0) panel.dartIds.splice(i, 1);
      }
      return true;
    case 'edge':
      return removeEdge(pattern, id);
    case 'point':
      return removePoint(pattern, id);
    default:
      return false;
  }
}

/**
 * Takes an edge out of the outline or hole loop that holds it. A hole loses the whole loop;
 * an outline edge is refused because removing it would break the panel's closure.
 */
function removeEdge(pattern: Pattern, edgeId: string): boolean {
  if (!pattern.edges[edgeId]) return false;
  for (const panel of Object.values(pattern.panels)) {
    if (panel.outlineEdgeIds.includes(edgeId)) throw new Error('轮廓边不能单独删除，请删除所属版片或先断开轮廓');
    const loopIndex = (panel.holes ?? []).findIndex(loop => loop.includes(edgeId));
    if (loopIndex >= 0) {
      panel.holes!.splice(loopIndex, 1);
      if (panel.holes!.length === 0) delete panel.holes;
      return true;
    }
  }
  delete pattern.edges[edgeId];
  return true;
}

/**
 * Deletes a contour vertex, joining the two points either side of it with one edge, and
 * rescaling the seam intervals that referenced the removed edges.
 */
function removePoint(pattern: Pattern, pointId: string): boolean {
  const point = pattern.points[pointId];
  if (!point) return false;
  const owners = Object.values(pattern.panels).filter(panel =>
    panel.outlineEdgeIds.some(id => touches(pattern, id, pointId)) || (panel.holes ?? []).some(loop => loop.some(id => touches(pattern, id, pointId))));
  if (owners.length === 0) throw new Error('该点不在任何版片轮廓上，无法删除');
  if (owners.length > 1) throw new Error('点被多张版片共用，无法删除');
  const panel = owners[0]!;

  const chain = findMergeChain(pattern, panel, pointId);
  if (!chain) throw new Error('该点相邻的两条边无法合并，或删除后轮廓不足 3 条边');
  const [beforeId, afterId] = chain;
  const before = pattern.edges[beforeId]!;
  const after = pattern.edges[afterId]!;
  const lenBefore = edgeLength(pattern, beforeId);
  const lenAfter = edgeLength(pattern, afterId);
  const merged = mergedEdge(pattern, before, after);
  const share = lenBefore / (lenBefore + lenAfter);

  remapSeams(pattern, [beforeId, afterId], merged, share);
  for (const p of Object.values(pattern.panels)) {
    p.outlineEdgeIds = spliceEdgePair(p.outlineEdgeIds, beforeId, afterId, merged);
    if (p.holes?.length) p.holes = p.holes.map(loop => spliceEdgePair(loop, beforeId, afterId, merged));
  }
  delete pattern.edges[beforeId];
  delete pattern.edges[afterId];
  delete pattern.points[pointId];
  return true;
}

/**
 * The two edges meeting at a vertex, in outline order, when the loop keeps at least 3 edges.
 * Both are lines, or both halves of one curve, which is what a split leaves behind.
 */
function findMergeChain(pattern: Pattern, panel: Panel, pointId: string): [string, string] | null {
  for (const chain of [panel.outlineEdgeIds, ...(panel.holes ?? [])]) {
    const index = chain.findIndex(id => pattern.edges[id]?.endPointId === pointId);
    if (index < 0) continue;
    const beforeId = chain[index]!;
    const afterId = chain[(index + 1) % chain.length]!;
    const before = pattern.edges[beforeId];
    const after = pattern.edges[afterId];
    if (!before || !after) continue;
    if (before.endPointId !== pointId || after.startPointId !== pointId) continue;
    if (before.type !== after.type) continue;
    if (chain.length <= 3) return null;
    return [beforeId, afterId];
  }
  return null;
}

/**
 * Id of the edge that joins the two points left after a vertex is deleted. Two halves of one
 * curve keep that curve: a bezier reuses the outer handles, an arc the outer angles, so the
 * shape returns to what it was before the split.
 */
function mergedEdge(pattern: Pattern, before: PatternEdge, after: PatternEdge): string {
  const arc = before.type === 'arc' && after.type === 'arc' && before.arc && after.arc && sameArc(before.arc, after.arc)
    ? { ...before.arc, endAngle: after.arc.endAngle }
    : undefined;
  const type: PatternEdge['type'] = arc ? 'arc' : before.type === 'bezier' && after.type === 'bezier' ? 'bezier' : 'line';
  return newEdge(pattern, type, before.startPointId, after.endPointId, arc);
}

/** Whether two arcs sit on the same circle, so their angles can be recombined. */
function sameArc(a: ArcGeom, b: ArcGeom): boolean {
  return Math.hypot(a.center.x - b.center.x, a.center.y - b.center.y) < 1e-6
    && Math.abs(a.radius - b.radius) < 1e-6
    && a.ccw === b.ccw;
}

/** Rewrites seam ends that pointed at the removed edges onto the merged edge's sub-interval. */
function remapSeams(pattern: Pattern, removedIds: string[], mergedId: string, firstShare: number): void {
  for (const seam of Object.values(pattern.seams)) {
    for (const side of [seam.a, seam.b] as SeamEnd[]) {
      const i = removedIds.indexOf(side.edgeId);
      if (i < 0) continue;
      const from = i === 0 ? 0 : firstShare;
      const to = i === 0 ? firstShare : 1;
      const scale = (t: number): number => from + t * (to - from);
      side.edgeId = mergedId;
      side.t0 = scale(side.t0);
      side.t1 = scale(side.t1);
      if (side.anchorT !== undefined) side.anchorT = scale(side.anchorT);
    }
    if (seam.a.edgeId === seam.b.edgeId && seam.a.t0 === seam.b.t0 && seam.a.t1 === seam.b.t1) {
      delete pattern.seams[seam.id];
    }
  }
}

/** Replaces a consecutive edge pair inside an ordered edge list with their merged edge. */
function spliceEdgePair(chain: string[], beforeId: string, afterId: string, mergedId: string): string[] {
  const index = chain.indexOf(beforeId);
  if (index < 0 || chain[(index + 1) % chain.length] !== afterId) return chain;
  const out = chain.slice();
  if (index === out.length - 1) return [mergedId, ...out.slice(0, out.length - 1)];
  return [...out.slice(0, index), mergedId, ...out.slice(index + 2)];
}

/** Edge has the point as one of its ends. */
function touches(pattern: Pattern, edgeId: string, pointId: string): boolean {
  const edge = pattern.edges[edgeId];
  return !!edge && (edge.startPointId === pointId || edge.endPointId === pointId);
}

export type { Command };

/**
 * Scales one panel's geometry about its bounding-box centre to the target width and height.
 * Outline and hole points, curve handles, arc centres, internal lines, dart tips and the
 * panel's annotations all ride along; arc edges only allow a uniform scale.
 */
export class ScalePanelCommand extends SnapshotCommand {
  readonly label = '修改版片尺寸';

  constructor(private panelId: string, private widthCm: number, private heightCm: number) { super(); }

  protected apply(pattern: Pattern, _ctx: ProjectContext): void {
    const panel = pattern.panels[this.panelId];
    if (!panel) throw new Error('版片不存在');
    if (!(this.widthCm > 0) || !(this.heightCm > 0)) throw new Error('宽高需为正数');
    if (panel.locked) throw new Error('版片已锁定');

    const box = computeBBox(samplePanelOutline(pattern, panel));
    const netWidth = box.max.x - box.min.x;
    const netHeight = box.max.y - box.min.y;
    if (!(netWidth > 0) || !(netHeight > 0)) throw new Error('版片包围盒无效');

    const sx = this.widthCm / netWidth;
    const sy = this.heightCm / netHeight;
    const owned = new Set([...panel.outlineEdgeIds, ...(panel.holes ?? []).flat()]);
    if (Math.abs(sx - sy) > 1e-6 && [...owned].some(id => pattern.edges[id]?.type === 'arc')) {
      throw new Error('圆弧边只能等比缩放');
    }
    const centre = { x: (box.min.x + box.max.x) / 2, y: (box.min.y + box.max.y) / 2 };
    const scale = (p: Vec2): Vec2 => ({ x: centre.x + (p.x - centre.x) * sx, y: centre.y + (p.y - centre.y) * sy });

    const pointIds = new Set<string>();
    for (const edgeId of owned) {
      const edge = pattern.edges[edgeId];
      if (!edge) continue;
      pointIds.add(edge.startPointId);
      pointIds.add(edge.endPointId);
    }
    for (const dartId of panel.dartIds) {
      const dart = pattern.darts[dartId];
      if (dart) pointIds.add(dart.tipId);
    }
    const sharedWithOtherPanel = Object.values(pattern.edges).some(edge =>
      !owned.has(edge.id) && (pointIds.has(edge.startPointId) || pointIds.has(edge.endPointId)));
    if (sharedWithOtherPanel) throw new Error('该片与其它版片共用顶点，请先断开或单独缩放');

    for (const pointId of pointIds) {
      const point = pattern.points[pointId];
      if (!point) continue;
      point.pos = scale(point.pos);
      if (point.handleIn) point.handleIn = scale(point.handleIn);
      if (point.handleOut) point.handleOut = scale(point.handleOut);
      if (point.grading) {
        const scaled: Record<string, Vec2> = {};
        for (const [sizeId, delta] of Object.entries(point.grading)) scaled[sizeId] = { x: delta.x * sx, y: delta.y * sy };
        point.grading = scaled;
      }
    }
    for (const edgeId of owned) {
      const edge = pattern.edges[edgeId];
      if (edge?.arc) edge.arc = { ...edge.arc, center: scale(edge.arc.center), radius: edge.arc.radius * sx };
    }
    for (const lineId of panel.internalLineIds) {
      const line = pattern.internalLines[lineId];
      if (line) line.points = line.points.map(scale);
    }
    for (const note of Object.values(pattern.annotations ?? {})) {
      if (note.panelId === panel.id) note.pos = scale(note.pos);
    }
  }
}
