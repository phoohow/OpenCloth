import type { ProjectContext } from './command';
import type { InternalLine, Panel, Pattern, PatternEdge, PatternPoint, Vec2 } from '../model/types';
import { buildPatternGraph, type PatternGraph } from '../model/patternGraph';
import { genId } from '../model/defaults';
import { SnapshotCommand } from './patternSnapshot';
import { addClosedLineOutline, makePanel, newEdge, newPoint, placeRight } from './patternCreateCommands';
import { insidePolygon, prunePattern } from './patternStructureCommands';
import { edgeLength, pointAtT, sampleEdge } from '../../pattern/geom/edgeSample';
import { sampleOutline, samplePanelOutline } from '../../pattern/panel/panelBuilder';
import { add, computeBBox, distance, dot, ensureCCW, normalize, scale, sub } from '../../pattern/geom/vec2';
import { adaptiveSampleBezier, edgeCurve, evalBezier, type CubicBezier2 } from '../../pattern/geom/bezier';
import { arcFromThreePoints, arcSpan, evalArc } from '../../pattern/geom/arc';
import { hasSelfIntersection, offsetPolyline } from '../../pattern/geom/offset';
import {
  bezierFromFit, deviationFromArc, distanceToPolyline, fitBezierHandles, maxDistanceToPolyline,
} from '../../pattern/geom/polyCurve';
import { jointCornerIds, seamJoint, type SeamJointEnd } from '../../pattern/seam/joinBlend';
import { applyFillets } from './patternEditCommands';
import { refitArcs } from './patternMoveGeometry';

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const rad = (deg: number): number => (deg * Math.PI) / 180;
const scaleAbout = (center: Vec2, p: Vec2, factor: number): Vec2 => add(center, scale(sub(p, center), factor));
const rotateAbout = (center: Vec2, p: Vec2, angle: number): Vec2 => {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const dx = p.x - center.x, dy = p.y - center.y;
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos };
};

/** Every panel outline and hole loop edge id list, live so in-place edits reach the panel. */
function edgeArrays(pattern: Pattern): string[][] {
  const arrays: string[][] = [];
  for (const panel of Object.values(pattern.panels)) {
    arrays.push(panel.outlineEdgeIds);
    for (const loop of panel.holes ?? []) arrays.push(loop);
  }
  return arrays;
}

/** Replaces every contiguous occurrence of `from` with `to` in an edge id list. */
function spliceSequence(ids: string[], from: string[], to: string[]): string[] {
  let out = ids;
  for (let guard = 0; guard < 16; guard++) {
    const index = out.findIndex((_, i) => from.every((id, k) => out[i + k] === id));
    if (index < 0) return out;
    out = [...out.slice(0, index), ...to, ...out.slice(index + from.length)];
  }
  return out;
}

/** True when `chain` runs contiguously through an edge id list, wrapping at its ends. */
function arrayContainsChain(ids: string[], chain: string[]): boolean {
  const n = ids.length, m = chain.length;
  if (m === 0 || n < m) return false;
  for (let start = 0; start < n; start++) {
    if (chain.every((id, k) => ids[(start + k) % n] === id)) return true;
  }
  return false;
}

/** Panels whose outline or holes reference any of `edgeIds`. */
function panelsOwningAny(pattern: Pattern, edgeIds: Iterable<string>): Panel[] {
  const wanted = new Set(edgeIds);
  return Object.values(pattern.panels).filter(panel =>
    [...panel.outlineEdgeIds, ...(panel.holes ?? []).flat()].some(id => wanted.has(id)));
}

/** Outline or hole edges of some panel that end or start at a point. */
function incidentOutlineEdges(pattern: Pattern, graph: PatternGraph, pointId: string): Set<string> {
  const ids = new Set<string>();
  for (const [edgeId, locations] of graph.edgeLocations) {
    if (locations.length === 0) continue;
    const edge = pattern.edges[edgeId];
    if (edge && (edge.startPointId === pointId || edge.endPointId === pointId)) ids.add(edgeId);
  }
  return ids;
}

/** Edge ids of a point that sit on a panel outline or hole. */
function outlineEdgesOfPoint(pattern: Pattern, graph: PatternGraph, pointId: string): string[] {
  return (graph.pointRefs.get(pointId) ?? [])
    .map(ref => ref.edgeId)
    .filter(id => pattern.edges[id] !== undefined && (graph.edgeLocations.get(id)?.length ?? 0) > 0);
}

/**
 * Maximal closed chains of an outline edge list, or null when a chain stays open or an edge
 * dangles. Splitting a vertex shared by several loops is what makes each loop its own panel.
 */
function closedChains(pattern: Pattern, ids: string[]): string[][] | null {
  const used = ids.map(() => false);
  const chains: string[][] = [];
  for (let start = 0; start < ids.length; start++) {
    if (used[start]) continue;
    const first = pattern.edges[ids[start]];
    if (!first) return null;
    const chain: string[] = [];
    let current = start;
    for (;;) {
      if (used[current]) return null;
      used[current] = true;
      const edge = pattern.edges[ids[current]];
      if (!edge) return null;
      chain.push(edge.id);
      if (edge.endPointId === first.startPointId) break;
      const following = current + 1;
      let next = following < ids.length && !used[following]
        && pattern.edges[ids[following]]?.startPointId === edge.endPointId ? following : -1;
      if (next < 0) next = ids.findIndex((id, i) => !used[i] && pattern.edges[id]?.startPointId === edge.endPointId);
      if (next < 0) return null;
      current = next;
    }
    chains.push(chain);
  }
  return chains.length > 0 ? chains : null;
}

/** A fresh panel over `outlineEdgeIds` inheriting the source panel's material settings. */
function newPanelFromChain(
  pattern: Pattern, ctx: ProjectContext, source: Panel, outlineEdgeIds: string[], nameSuffix: string,
): Panel {
  const panel = makePanel(pattern, ctx, {
    name: `${source.name}${nameSuffix}`, seamAllowanceCm: source.seamAllowanceCm,
  }, outlineEdgeIds);
  panel.fabricId = source.fabricId;
  panel.meshResolutionCm = source.meshResolutionCm;
  panel.grainAngleDeg = source.grainAngleDeg;
  panel.grainOffset = source.grainOffset ? { ...source.grainOffset } : undefined;
  panel.grainLengthCm = source.grainLengthCm;
  panel.groupId = source.groupId;
  return panel;
}

/** Rebuilds a panel outline from its closed chains; each extra chain becomes a new panel. */
function assignClosedChains(pattern: Pattern, ctx: ProjectContext, panel: Panel, nameSuffix: string): void {
  const chains = closedChains(pattern, panel.outlineEdgeIds);
  if (!chains) throw new Error(`轮廓断开后无法闭合成片：${panel.name}`);
  panel.outlineEdgeIds = chains[0];
  for (const chain of chains.slice(1)) newPanelFromChain(pattern, ctx, panel, chain, nameSuffix);
}

/** Cumulative arc-length fractions at each chain boundary, running 0 to 1 across the chain. */
function chainFractions(pattern: Pattern, chain: string[]): number[] {
  const total = chain.reduce((sum, id) => sum + edgeLength(pattern, id), 0) || 1;
  const out = [0];
  for (const id of chain) out.push(out[out.length - 1] + edgeLength(pattern, id) / total);
  out[out.length - 1] = 1;
  return out;
}

/** Seam interval bounds kept strictly ordered and inside one edge. */
function shrinkInterval(lo: number, hi: number): [number, number] {
  const high = Math.min(1, Math.max(hi, lo + 1e-4));
  const low = Math.max(0, Math.min(lo, high - 1e-4));
  return [low, high];
}

/** Moves seam intervals and notch positions of a replaced chain onto its successor. */
function remapChainReferences(pattern: Pattern, fromChain: string[], from: number[], toChain: string[]): void {
  if (toChain.length === 0) return;
  const to = chainFractions(pattern, toChain);
  const slotOf = (u: number): { index: number; t: number } => {
    for (let j = 0; j < toChain.length; j++) {
      if (u <= to[j + 1] + 1e-9) return { index: j, t: clamp01((u - to[j]) / ((to[j + 1] - to[j]) || 1)) };
    }
    return { index: toChain.length - 1, t: 1 };
  };
  const hostOf = (u0: number, u1: number): { index: number; t0: number; t1: number } => {
    const start = slotOf(u0);
    const stop = slotOf(u1);
    if (start.index === stop.index) return { index: start.index, t0: start.t, t1: stop.t };
    const middle = slotOf((u0 + u1) / 2);
    const width = (u1 - u0) / ((to[middle.index + 1] - to[middle.index]) || 1);
    return { index: middle.index, t0: middle.t - width / 2, t1: middle.t + width / 2 };
  };
  const slots = new Map(fromChain.map((id, i) => [id, i] as const));
  for (const seam of Object.values(pattern.seams)) {
    for (const side of ['a', 'b'] as const) {
      const end = seam[side];
      const i = slots.get(end.edgeId);
      if (i === undefined) continue;
      const span = from[i + 1] - from[i];
      const host = hostOf(from[i] + end.t0 * span, from[i] + end.t1 * span);
      const [t0, t1] = shrinkInterval(host.t0, host.t1);
      const moved: typeof end = { ...end, edgeId: toChain[host.index], t0, t1 };
      if (end.anchorT !== undefined) {
        const anchor = slotOf(from[i] + end.anchorT * span);
        moved.anchorT = clamp01(anchor.index === host.index ? anchor.t : anchor.index < host.index ? t0 : t1);
      }
      seam[side] = moved;
    }
  }
  for (const notch of Object.values(pattern.notches ?? {})) {
    const i = slots.get(notch.edgeId);
    if (i === undefined) continue;
    const slot = slotOf(from[i] + notch.t * (from[i + 1] - from[i]));
    notch.edgeId = toChain[slot.index];
    notch.t = clamp01(slot.t);
  }
}

/** Clears handles no remaining bezier edge of the pattern uses. */
function dropUnusedHandles(pattern: Pattern, pointIds: Iterable<string>): void {
  for (const pointId of pointIds) {
    const point = pattern.points[pointId];
    if (!point) continue;
    const used = Object.values(pattern.edges).some(edge =>
      edge.type === 'bezier' && (edge.startPointId === pointId || edge.endPointId === pointId));
    if (used) continue;
    delete point.handleIn;
    delete point.handleOut;
  }
}

/** Throws when a panel owning any of `edgeIds` has a self-crossing sampled outline. */
function assertOwningPanelsSimple(pattern: Pattern, edgeIds: Iterable<string>, message: string): void {
  const wanted = new Set(edgeIds);
  for (const panel of Object.values(pattern.panels)) {
    if (!panel.outlineEdgeIds.some(id => wanted.has(id))) continue;
    if (hasSelfIntersection(sampleOutline(pattern, panel.outlineEdgeIds))) throw new Error(message);
  }
}

/** True when a point lies inside the ring or on it within tolerance. */
function insideOrOnRing(ring: Vec2[], p: Vec2): boolean {
  return insidePolygon(ring, p) || distanceToPolyline(p, [...ring, ring[0]]) <= 1e-6;
}

/** Unit perpendicular of `direction` whose probe point lies inside `outline`. */
function inwardDirection(outline: Vec2[], base: Vec2, direction: Vec2): Vec2 {
  const candidates = [normalize({ x: -direction.y, y: direction.x }), normalize({ x: direction.y, y: -direction.x })];
  for (const candidate of candidates) {
    if (insidePolygon(outline, add(base, scale(candidate, 0.05)))) return candidate;
  }
  throw new Error('无法确定版片的内侧方向');
}

/** How far `normal` from `base` stays inside `outline`, in cm. */
function inwardDepth(outline: Vec2[], base: Vec2, normal: Vec2, reach: number): number {
  const steps = 200;
  for (let i = 1; i <= steps; i++) {
    const depth = (reach * i) / steps;
    if (!insidePolygon(outline, add(base, scale(normal, depth)))) return (reach * (i - 1)) / steps;
  }
  return reach;
}

/** Splits a straight outline edge at a position, rewiring outlines, holes, seams and notches. */
function splitLineEdge(pattern: Pattern, edgeId: string, at: Vec2): [string, string] {
  const edge = pattern.edges[edgeId];
  const start = pattern.points[edge?.startPointId ?? '']?.pos;
  const end = pattern.points[edge?.endPointId ?? '']?.pos;
  if (!edge || !start || !end) throw new Error('边无法拆分');
  const total = distance(start, end);
  if (total < 1e-6) throw new Error('边长度为零，无法拆分');
  const fraction = clamp01(distance(start, at) / total);
  const midId = newPoint(pattern, at, 'corner');
  const ids: [string, string] = [genId('edge'), genId('edge')];
  const piece = (id: string, startPointId: string, endPointId: string): void => {
    pattern.edges[id] = {
      id, type: 'line', startPointId, endPointId,
      semantic: edge.semantic, seamAllowanceCm: edge.seamAllowanceCm, cornerStyle: edge.cornerStyle,
    };
  };
  piece(ids[0], edge.startPointId, midId);
  piece(ids[1], midId, edge.endPointId);
  delete pattern.edges[edgeId];
  for (const array of edgeArrays(pattern)) {
    const index = array.indexOf(edgeId);
    if (index >= 0) array.splice(index, 1, ids[0], ids[1]);
  }
  for (const seam of Object.values(pattern.seams)) {
    for (const side of ['a', 'b'] as const) {
      const end = seam[side];
      if (end.edgeId === edgeId) seam[side] = { ...end, edgeId: end.t0 < fraction ? ids[0] : ids[1] };
    }
  }
  for (const notch of Object.values(pattern.notches ?? {})) {
    if (notch.edgeId === edgeId) notch.edgeId = notch.t < fraction ? ids[0] : ids[1];
  }
  return ids;
}

// ============ FR-2.5 break and connect ============

/**
 * Duplicates a shared outline vertex so the named edges stop sharing it: contours that only
 * touched at the point split into separate panels.
 */
export class BreakPointCommand extends SnapshotCommand {
  readonly label = '断开顶点';

  /** @param edgeIds outline edges to move onto the duplicated vertex; omit to break automatically */
  constructor(private pointId: string, private edgeIds?: string[]) { super(); }

  protected apply(pattern: Pattern, ctx: ProjectContext): void {
    const point = pattern.points[this.pointId];
    if (!point) throw new Error('顶点不存在，无法断开');
    const graph = buildPatternGraph(pattern);
    const incident = incidentOutlineEdges(pattern, graph, this.pointId);
    if (incident.size < 2) throw new Error('该顶点相连的轮廓边不足，无法断开');

    const leaving = this.edgeIds?.length ? this.namedLeaving(incident) : this.autoLeaving(pattern, graph, incident);
    if (leaving.size === 0 || leaving.size >= incident.size) throw new Error('断开需保留经过该顶点的部分轮廓边');

    const duplicateId = genId('pt');
    pattern.points[duplicateId] = { ...structuredClone(point), id: duplicateId };
    const touched = panelsOwningAny(pattern, leaving);
    for (const edgeId of leaving) {
      const edge = pattern.edges[edgeId];
      if (edge.startPointId === this.pointId) edge.startPointId = duplicateId;
      if (edge.endPointId === this.pointId) edge.endPointId = duplicateId;
    }
    for (const panel of touched) {
      assignClosedChains(pattern, ctx, panel, '断开');
      if (this.touches(panel.outlineEdgeIds, this.pointId, pattern) && this.touches(panel.outlineEdgeIds, duplicateId, pattern)) {
        throw new Error('所选边断开后未分离出独立轮廓');
      }
    }
  }

  private touches(ids: string[], pointId: string, pattern: Pattern): boolean {
    return ids.some(id => {
      const edge = pattern.edges[id];
      return !!edge && (edge.startPointId === pointId || edge.endPointId === pointId);
    });
  }

  private namedLeaving(incident: Set<string>): Set<string> {
    const leaving = new Set<string>();
    for (const id of this.edgeIds ?? []) {
      if (!incident.has(id)) throw new Error(`边 ${id} 未经过该顶点，无法断开`);
      leaving.add(id);
    }
    return leaving;
  }

  /** Moves every contour after the first one through the vertex: other panels or extra loops. */
  private autoLeaving(pattern: Pattern, graph: PatternGraph, incident: Set<string>): Set<string> {
    const panels = new Set<string>();
    for (const edgeId of incident) for (const location of graph.edgeLocations.get(edgeId) ?? []) panels.add(location.panelId);
    if (panels.size >= 2) {
      const keeper = [...panels][0];
      return new Set([...incident].filter(id => !(graph.edgeLocations.get(id) ?? []).some(l => l.panelId === keeper)));
    }
    const panel = pattern.panels[[...panels][0]];
    const chains = closedChains(pattern, panel.outlineEdgeIds);
    if (!chains || chains.length < 2) throw new Error('该顶点只连着一条轮廓，无法断开');
    return new Set(chains.slice(1).flat().filter(id => incident.has(id)));
  }
}

/**
 * Welds two outline vertices into one so the contours that ended at them share a vertex, and
 * closes a contour whose two free ends meet there into a panel.
 */
export class ConnectPointsCommand extends SnapshotCommand {
  readonly label = '连接端点';

  constructor(private pointIdA: string, private pointIdB: string) { super(); }

  protected apply(pattern: Pattern, ctx: ProjectContext): void {
    const a = pattern.points[this.pointIdA];
    const b = pattern.points[this.pointIdB];
    if (!a || !b) throw new Error('端点不存在，无法连接');
    if (this.pointIdA === this.pointIdB) throw new Error('两个端点是同一个点');

    const graph = buildPatternGraph(pattern);
    const edgesA = outlineEdgesOfPoint(pattern, graph, this.pointIdA);
    const edgesB = outlineEdgesOfPoint(pattern, graph, this.pointIdB);
    if (edgesA.length === 0 || edgesB.length === 0) throw new Error('端点不在任何轮廓上，无法连接');
    if (edgesA.length > 2 || edgesB.length > 2) throw new Error('端点连着多条轮廓链，不是开放端点，无法连接');
    for (const edge of Object.values(pattern.edges)) {
      const ids = [edge.startPointId, edge.endPointId];
      if (ids.includes(this.pointIdA) && ids.includes(this.pointIdB)) throw new Error('两个端点之间已有边相连，无法连接');
    }

    const touched = panelsOwningAny(pattern, edgesB);
    for (const edge of Object.values(pattern.edges)) {
      if (edge.startPointId === this.pointIdB) edge.startPointId = this.pointIdA;
      if (edge.endPointId === this.pointIdB) edge.endPointId = this.pointIdA;
    }
    for (const dart of Object.values(pattern.darts)) if (dart.tipId === this.pointIdB) dart.tipId = this.pointIdA;
    refitArcs(pattern, new Set([this.pointIdA]));
    if (a.kind === undefined) a.kind = b.kind;
    if (a.handleIn === undefined) a.handleIn = b.handleIn;
    if (a.handleOut === undefined) a.handleOut = b.handleOut;
    delete pattern.points[this.pointIdB];

    for (const panel of touched) {
      if (hasSelfIntersection(sampleOutline(pattern, panel.outlineEdgeIds))) throw new Error('连接后轮廓自相交');
      assignClosedChains(pattern, ctx, panel, '闭合');
    }
    prunePattern(pattern);
  }
}

// ============ FR-2.7 edge length and angle ============

/**
 * Sets an edge's length by scaling it about its start point: the end vertex slides along the
 * edge direction while curves and arcs keep their shape at the same factor, and the arcs meeting
 * at the end vertex follow it.
 */
export class SetEdgeLengthCommand extends SnapshotCommand {
  readonly label = '修改边长';

  constructor(private edgeId: string, private lengthCm: number) { super(); }

  protected apply(pattern: Pattern, _ctx: ProjectContext): void {
    const edge = pattern.edges[this.edgeId];
    if (!edge) throw new Error('边不存在，无法改边长');
    if (!(this.lengthCm > 0)) throw new Error('边长需为正数');
    const start = pattern.points[edge.startPointId];
    const end = pattern.points[edge.endPointId];
    if (!start || !end) throw new Error('边端点缺失，无法改边长');
    const current = edgeLength(pattern, this.edgeId);
    if (current < 1e-6) throw new Error('边长度为零，无法确定方向');

    const factor = this.lengthCm / current;
    end.pos = scaleAbout(start.pos, end.pos, factor);
    if (edge.type === 'arc' && edge.arc) {
      edge.arc = { ...edge.arc, center: scaleAbout(start.pos, edge.arc.center, factor), radius: edge.arc.radius * factor };
    } else if (edge.type === 'bezier') {
      if (start.handleOut) start.handleOut = scaleAbout(start.pos, start.handleOut, factor);
      if (end.handleIn) end.handleIn = scaleAbout(start.pos, end.handleIn, factor);
    }
    refitArcs(pattern, new Set([end.id]));
    assertOwningPanelsSimple(pattern, [this.edgeId], '改边长后轮廓自相交');
  }
}

/**
 * Rotates an edge about the vertex it shares with another edge until their angle matches,
 * carrying the far vertex, the arcs meeting there and the edge's own tangents along.
 */
export class SetEdgeAngleCommand extends SnapshotCommand {
  readonly label = '修改边夹角';

  constructor(private edgeId: string, private otherEdgeId: string, private angleDeg: number) { super(); }

  protected apply(pattern: Pattern, _ctx: ProjectContext): void {
    const edge = pattern.edges[this.edgeId];
    const other = pattern.edges[this.otherEdgeId];
    if (!edge || !other) throw new Error('边不存在，无法改角度');
    if (edge.id === other.id) throw new Error('夹角需要两条不同的边');
    if (!(this.angleDeg > 0 && this.angleDeg < 360)) throw new Error('夹角需大于 0 且小于 360 度');

    const sharedId = sharedVertexOf(edge, other);
    const farId = edge.startPointId === sharedId ? edge.endPointId : edge.startPointId;
    const otherFarId = other.startPointId === sharedId ? other.endPointId : other.startPointId;
    const anchor = pattern.points[sharedId];
    const far = pattern.points[farId];
    const otherFar = pattern.points[otherFarId];
    if (!anchor || !far || !otherFar) throw new Error('边端点缺失，无法改角度');
    const radius = distance(anchor.pos, far.pos);
    if (radius < 1e-6) throw new Error('边长度为零，无法确定方向');
    if (distance(anchor.pos, otherFar.pos) < 1e-6) throw new Error('相邻边长度为零，无法确定方向');

    const reference = normalize(sub(otherFar.pos, anchor.pos));
    const currentVector = sub(far.pos, anchor.pos);
    const current = Math.atan2(
      reference.x * currentVector.y - reference.y * currentVector.x,
      dot(reference, currentVector),
    );
    const delta = (current >= 0 ? rad(this.angleDeg) : -rad(this.angleDeg)) - current;
    far.pos = rotateAbout(anchor.pos, far.pos, delta);
    refitArcs(pattern, new Set([farId]), { midpoint: arc => rotateAbout(anchor.pos, evalArc(arc, 0.5), delta) });
    this.rotateTangents(pattern, edge, anchor, far, farId, sharedId, delta);
    assertOwningPanelsSimple(pattern, [this.edgeId], '改角度后轮廓自相交');
  }

  /** Turns the edge's own endpoint handles with it when no other bezier shares the slot. */
  private rotateTangents(
    pattern: Pattern, edge: PatternEdge, anchor: PatternPoint, far: PatternPoint,
    farId: string, sharedId: string, delta: number,
  ): void {
    if (edge.type !== 'bezier') return;
    const atAnchor: 'handleIn' | 'handleOut' = edge.endPointId === sharedId ? 'handleIn' : 'handleOut';
    const atFar: 'handleIn' | 'handleOut' = edge.endPointId === farId ? 'handleIn' : 'handleOut';
    if (anchor[atAnchor] && handleExclusive(pattern, sharedId, atAnchor, edge.id)) {
      anchor[atAnchor] = rotateAbout(anchor.pos, anchor[atAnchor]!, delta);
    }
    if (far[atFar] && handleExclusive(pattern, farId, atFar, edge.id)) {
      far[atFar] = rotateAbout(far.pos, far[atFar]!, delta);
    }
  }
}

/** New radius or new center angle for an arc; exactly one of the two is supplied. */
export interface ArcParamPatch {
  radiusCm?: number;
  sweepDeg?: number;
}

/**
 * Changes an arc's radius or center angle while keeping both endpoints fixed. The center is
 * rebuilt on the perpendicular bisector on the side that preserves the arc's direction, and a
 * radius shorter than half the chord is clamped to the smallest legal value.
 */
export class SetArcParamsCommand extends SnapshotCommand {
  readonly label = '修改圆弧参数';

  constructor(private edgeId: string, private params: ArcParamPatch) { super(); }

  protected apply(pattern: Pattern, _ctx: ProjectContext): void {
    const edge = pattern.edges[this.edgeId];
    if (!edge) throw new Error('边不存在，无法修改圆弧');
    if (edge.type !== 'arc' || !edge.arc) throw new Error('该边不是圆弧，无法修改弧参数');
    const start = pattern.points[edge.startPointId];
    const end = pattern.points[edge.endPointId];
    if (!start || !end) throw new Error('边端点缺失，无法修改圆弧');

    const dx = end.pos.x - start.pos.x;
    const dy = end.pos.y - start.pos.y;
    const chord = Math.hypot(dx, dy);
    if (chord < 1e-6) throw new Error('圆弧两端点重合，无法修改弧参数');
    if ((this.params.radiusCm === undefined) === (this.params.sweepDeg === undefined)) {
      throw new Error('需要且只能指定半径或圆心角');
    }

    const old = edge.arc;
    const oldSpan = arcSpan(old);
    const oldAbs = Math.abs(oldSpan);
    const mid = { x: (start.pos.x + end.pos.x) / 2, y: (start.pos.y + end.pos.y) / 2 };
    // Left normal of the directed chord.
    const normal = { x: -dy / chord, y: dx / chord };
    const centerSide = Math.sign(dx * (old.center.y - start.pos.y) - dy * (old.center.x - start.pos.x));
    const minorSide = old.ccw ? 1 : -1;
    const branchSide = oldAbs > Math.PI + 1e-9 ? -minorSide : minorSide;

    let radius: number;
    let hSign: number;
    if (this.params.sweepDeg !== undefined) {
      const deg = this.params.sweepDeg;
      if (!Number.isFinite(deg) || deg <= 0 || deg >= 360) throw new Error('圆心角需大于 0° 且小于 360°');
      radius = chord / (2 * Math.sin(rad(deg) / 2));
      const source = deg < 180 ? minorSide : deg > 180 ? -minorSide : 0;
      hSign = source || branchSide;
    } else {
      const requested = this.params.radiusCm!;
      if (!Number.isFinite(requested) || requested <= 0) throw new Error('圆弧半径需为正数');
      radius = Math.max(requested, chord / 2);
      hSign = Math.abs(oldAbs - Math.PI) < 1e-6 ? branchSide : centerSide || branchSide;
    }

    const h = Math.sqrt(Math.max(0, radius * radius - (chord * chord) / 4));
    if (!Number.isFinite(h)) throw new Error('圆弧半径过大');
    const center = {
      x: mid.x + hSign * h * normal.x,
      y: mid.y + hSign * h * normal.y,
    };
    edge.arc = {
      center,
      radius,
      startAngle: Math.atan2(start.pos.y - center.y, start.pos.x - center.x),
      endAngle: Math.atan2(end.pos.y - center.y, end.pos.x - center.x),
      ccw: old.ccw,
    };
  }
}

/** The vertex two edges share, preferring the end of the rotating edge as the join point. */
function sharedVertexOf(edge: PatternEdge, other: PatternEdge): string {
  const pairs: [string, string][] = [
    [edge.endPointId, other.startPointId],
    [edge.endPointId, other.endPointId],
    [edge.startPointId, other.startPointId],
    [edge.startPointId, other.endPointId],
  ];
  for (const [a, b] of pairs) if (a === b) return a;
  throw new Error('两条边没有公共顶点，无法改角度');
}

/** True when only `edgeId` of the pattern reads that handle slot. */
function handleExclusive(pattern: Pattern, pointId: string, which: 'handleIn' | 'handleOut', edgeId: string): boolean {
  return Object.values(pattern.edges).every(edge => {
    if (edge.type !== 'bezier' || edge.id === edgeId) return true;
    return which === 'handleIn' ? edge.endPointId !== pointId : edge.startPointId !== pointId;
  });
}

// ============ FR-2.8 merge collinear edges ============

/** Collinearity tolerance for `MergeCollinearEdgesCommand`, in cm. */
const COLLINEAR_TOLERANCE_CM = 1e-6;

/**
 * Replaces a chain of adjacent, collinear, same-allowance straight edges with one edge,
 * mapping the seam intervals and notches of the chain proportionally onto it.
 */
export class MergeCollinearEdgesCommand extends SnapshotCommand {
  readonly label = '合并共线边';

  /** Id of the surviving merged edge, readable after execute. */
  mergedEdgeId = '';

  /** @param edgeIds adjacent straight edges in traversal order; the reverse order also works */
  constructor(private edgeIds: string[]) { super(); }

  protected apply(pattern: Pattern, _ctx: ProjectContext): void {
    if (this.edgeIds.length < 2) throw new Error('合并至少需要两条相邻边');
    for (const id of this.edgeIds) if (!pattern.edges[id]) throw new Error(`边 ${id} 不存在，无法合并`);

    const chain = this.traversalOrder(pattern);
    const first = pattern.edges[chain[0]];
    for (const id of chain) {
      const edge = pattern.edges[id];
      if (edge.type !== 'line') throw new Error('仅支持合并直线边');
      if (edge.semantic !== first.semantic) throw new Error('相邻边的语义不同，无法合并');
      if ((edge.seamAllowanceCm ?? null) !== (first.seamAllowanceCm ?? null)) throw new Error('相邻边的缝份不同，无法合并');
      if ((edge.cornerStyle ?? null) !== (first.cornerStyle ?? null)) throw new Error('相邻边的角型不同，无法合并');
    }

    const start = pattern.points[first.startPointId]?.pos;
    const lastEdge = pattern.edges[chain[chain.length - 1]];
    const end = pattern.points[lastEdge.endPointId]?.pos;
    if (!start || !end) throw new Error('边端点缺失，无法合并');
    const straight = sub(end, start);
    const span = Math.hypot(straight.x, straight.y);
    if (span < COLLINEAR_TOLERANCE_CM) throw new Error('合并后的边长度为零，无法合并');
    const normal = { x: straight.y / span, y: -straight.x / span };
    for (const pointId of interiorPointIds(pattern, chain)) {
      const pos = pattern.points[pointId]?.pos;
      if (!pos) throw new Error('边端点缺失，无法合并');
      if (Math.abs(dot(sub(pos, start), normal)) > COLLINEAR_TOLERANCE_CM) throw new Error('所选边不在同一直线上，无法合并');
      if (this.hasForeignEdge(pattern, pointId, chain)) throw new Error('共线边的中间顶点被其他边引用，无法合并');
    }

    const from = chainFractions(pattern, chain);
    const replaced = chain.slice(1);
    for (const id of replaced) {
      dropUnusedHandles(pattern, [pattern.edges[id].startPointId, pattern.edges[id].endPointId]);
      delete pattern.edges[id];
    }
    first.endPointId = lastEdge.endPointId;
    for (const array of edgeArrays(pattern)) {
      if (!array.some(id => chain.includes(id))) continue;
      const spliced = spliceSequence(array, chain, [first.id]);
      if (spliced.some(id => replaced.includes(id))) throw new Error('所选边在轮廓中不连续，无法合并');
      array.splice(0, array.length, ...spliced);
    }
    remapChainReferences(pattern, chain, from, [first.id]);
    this.mergedEdgeId = first.id;
    assertOwningPanelsSimple(pattern, [first.id], '合并后轮廓自相交');
    prunePattern(pattern);
  }

  /** Chain order that follows the edges' own start-to-end direction. */
  private traversalOrder(pattern: Pattern): string[] {
    const adjacent = (ids: string[]) => ids.every((id, i) =>
      i === 0 || pattern.edges[ids[i - 1]].endPointId === pattern.edges[id].startPointId);
    if (adjacent(this.edgeIds)) return [...this.edgeIds];
    const reversed = [...this.edgeIds].reverse();
    if (adjacent(reversed)) return reversed;
    throw new Error('所选边不相邻，无法合并');
  }

  private hasForeignEdge(pattern: Pattern, pointId: string, chain: string[]): boolean {
    return Object.values(pattern.edges).some(edge =>
      !chain.includes(edge.id) && (edge.startPointId === pointId || edge.endPointId === pointId));
  }
}

/** Vertex ids a chain passes through, excluding both ends. */
function interiorPointIds(pattern: Pattern, chain: string[]): string[] {
  const out: string[] = [];
  for (let i = 1; i < chain.length; i++) {
    const id = pattern.edges[chain[i]].startPointId;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

// ============ FR-3.6 curve point reduction ============

/** Options for `SimplifyCurveCommand`. */
export interface SimplifyCurveOptions {
  /** Largest allowed deviation from the original shape in cm; defaults to 0.05. */
  maxDeviationCm?: number;
  /** Largest number of anchor points allowed in the result. */
  maxControls?: number;
}

/** One fitted cubic of a simplified chain, with the dense samples behind it. */
interface CurveSpan {
  /** Dense samples the span follows, including both ends. */
  samples: Vec2[];
  /** Index of each sample in the dense chain samples. */
  sampleIndices: number[];
  /** Travel directions the fit holds at the span ends. */
  tangentStart: Vec2;
  tangentEnd: Vec2;
  /** Fitted cubic stored on the anchor points. */
  curve: CubicBezier2;
}

/**
 * Rebuilds a chain of edges as fewer cubic segments whose handles sit on the anchor points,
 * or turns a single curve edge into an arc or a straight line when it fits the tolerance.
 */
export class SimplifyCurveCommand extends SnapshotCommand {
  readonly label = '简化曲线';

  constructor(private edgeIds: string[], private opts: SimplifyCurveOptions = {}) { super(); }

  protected apply(pattern: Pattern, _ctx: ProjectContext): void {
    if (this.edgeIds.length === 0) throw new Error('至少需要一条待简化的边');
    for (const id of this.edgeIds) if (!pattern.edges[id]) throw new Error(`边 ${id} 不存在，无法简化`);
    const tolerance = this.opts.maxDeviationCm ?? 0.05;
    if (!(tolerance > 0)) throw new Error('拟合误差需为正数');

    const chain = this.contiguousChain(pattern);
    if (chain.length === 1) {
      this.simplifySingleEdge(pattern, chain[0], tolerance);
      return;
    }
    const closed = pattern.edges[chain[0]].startPointId === pattern.edges[chain[chain.length - 1]].endPointId;
    const dense = denseSamples(pattern, chain, tolerance, closed);

    // Start from the coarsest anchor set and add the worst-fitting sample until the fit holds.
    let anchors = closed ? [0] : [0, dense.length - 1];
    let spans = fitSpans(dense, anchors, closed);
    let worst = worstSpanDeviation(spans);
    while (worst.deviation > tolerance) {
      if (spans.length >= chain.length) throw new Error('在给公差内无法减少曲线控制点');
      if (anchors.includes(worst.sampleIndex) || anchors.length > dense.length) throw new Error('在给公差内无法简化曲线');
      anchors = [...anchors, worst.sampleIndex].sort((a, b) => a - b);
      spans = fitSpans(dense, anchors, closed);
      worst = worstSpanDeviation(spans);
    }
    if (this.opts.maxControls !== undefined && anchors.length > this.opts.maxControls) {
      throw new Error('在给公差内无法达到目标点数');
    }
    if (spans.length >= chain.length) throw new Error('在给公差内无法减少曲线控制点');
    this.rebuild(pattern, chain, dense, anchors, spans, closed);
  }

  /** The chain must run contiguously through one panel outline or hole loop. */
  private contiguousChain(pattern: Pattern): string[] {
    if (!edgeArrays(pattern).some(ids => arrayContainsChain(ids, this.edgeIds))) {
      throw new Error('所选边需在同一个轮廓内连续');
    }
    return [...this.edgeIds];
  }

  /** Replaces a single curve edge with an arc or a straight line when the tolerance allows. */
  private simplifySingleEdge(pattern: Pattern, edgeId: string, tolerance: number): void {
    const edge = pattern.edges[edgeId];
    const start = pattern.points[edge.startPointId]?.pos;
    const end = pattern.points[edge.endPointId]?.pos;
    if (!start || !end) throw new Error('边端点缺失，无法简化');
    if (edge.type === 'line') throw new Error('直线边无需简化');
    const curve = edge.type === 'bezier' ? edgeCurve(pattern, edge) : null;
    const samples = curve ? adaptiveSampleBezier(curve, Math.min(0.005, tolerance / 10)) : sampleEdge(pattern, edgeId);
    // Two samples only means the adaptive sampler already found the chord close enough.
    const chordDeviation = samples.length >= 3 ? maxDistanceToPolyline(samples, [start, end]) : 0;
    if (chordDeviation <= tolerance) {
      edge.type = 'line';
      delete edge.arc;
      dropUnusedHandles(pattern, [edge.startPointId, edge.endPointId]);
      return;
    }
    if (!curve) throw new Error('在给公差内无法简化曲线');
    const middle = {
      x: (curve.p0.x + 3 * curve.c0.x + 3 * curve.c1.x + curve.p1.x) / 8,
      y: (curve.p0.y + 3 * curve.c0.y + 3 * curve.c1.y + curve.p1.y) / 8,
    };
    const arc = arcFromThreePoints(start, middle, end);
    if (!arc || deviationFromArc(arc, samples) > tolerance) throw new Error('在给公差内无法简化曲线');
    edge.type = 'arc';
    edge.arc = arc;
    dropUnusedHandles(pattern, [edge.startPointId, edge.endPointId]);
  }

  /** Writes the fitted spans back as the chain's replacement edges and rewires the references. */
  private rebuild(
    pattern: Pattern, chain: string[], dense: Vec2[], anchors: number[], spans: CurveSpan[], closed: boolean,
  ): void {
    const from = chainFractions(pattern, chain);
    const anchorPoints = anchorPointIds(pattern, chain, dense, anchors, closed);
    const ids: string[] = [];
    for (let j = 0; j < spans.length; j++) {
      const startPointId = anchorPoints[j];
      const endPointId = anchorPoints[j + 1] ?? anchorPoints[0];
      const id = j < chain.length ? chain[j] : newEdge(pattern, 'bezier', startPointId, endPointId);
      const edge = pattern.edges[id];
      edge.type = 'bezier';
      delete edge.arc;
      edge.startPointId = startPointId;
      edge.endPointId = endPointId;
      if (edge.semantic === undefined) edge.semantic = pattern.edges[chain[0]].semantic;
      const curve = spans[j].curve;
      pattern.points[startPointId].handleOut = { ...curve.c0 };
      pattern.points[endPointId].handleIn = { ...curve.c1 };
      ids.push(id);
    }
    // Anchors keep a kink where the source turns more than a few degrees between the spans.
    anchorPoints.forEach((pointId, j) => {
      if (!closed && (j === 0 || j === anchorPoints.length - 1)) return;
      const incoming = spans[(j - 1 + spans.length) % spans.length];
      const outgoing = spans[j % spans.length];
      const turn = Math.abs(Math.atan2(
        incoming.tangentEnd.x * outgoing.tangentStart.y - incoming.tangentEnd.y * outgoing.tangentStart.x,
        dot(incoming.tangentEnd, outgoing.tangentStart),
      ));
      pattern.points[pointId].kind = turn > 0.14 ? 'corner' : 'smooth';
    });
    for (const id of chain) {
      if (ids.includes(id)) continue;
      dropUnusedHandles(pattern, [pattern.edges[id].startPointId, pattern.edges[id].endPointId]);
      delete pattern.edges[id];
    }
    for (const array of edgeArrays(pattern)) {
      if (!array.some(id => chain.includes(id))) continue;
      const spliced = spliceSequence(array, chain, ids);
      if (spliced.some(id => chain.includes(id) && !ids.includes(id))) throw new Error('所选边在轮廓中不连续，无法简化');
      array.splice(0, array.length, ...spliced);
    }
    remapChainReferences(pattern, chain, from, ids);
    prunePattern(pattern);
  }
}

/**
 * Chain samples in traversal order, densified so a fit cannot slip between two vertices;
 * the repeated closing vertex of a closed chain is dropped.
 */
function denseSamples(pattern: Pattern, chain: string[], tolerance: number, closed: boolean): Vec2[] {
  const raw: Vec2[] = [];
  for (const id of chain) {
    const edge = pattern.edges[id];
    const curve = edgeCurve(pattern, edge);
    const pts = curve ? adaptiveSampleBezier(curve, Math.min(0.02, tolerance / 4)) : sampleEdge(pattern, id);
    for (let i = raw.length === 0 ? 0 : 1; i < pts.length; i++) raw.push({ x: pts[i].x, y: pts[i].y });
  }
  if (closed && raw.length > 1) raw.pop();
  const step = Math.max(0.05, tolerance * 2);
  const dense: Vec2[] = [];
  raw.forEach((point, i) => {
    dense.push(point);
    const next = i + 1 < raw.length ? raw[i + 1] : closed ? raw[0] : null;
    if (!next) return;
    const runs = Math.max(1, Math.ceil(distance(point, next) / step));
    for (let k = 1; k < runs; k++) {
      const f = k / runs;
      dense.push({ x: point.x + (next.x - point.x) * f, y: point.y + (next.y - point.y) * f });
    }
  });
  if (dense.length < 3) throw new Error('曲线采样点不足，无法简化');
  return dense;
}

/** Cubic fit of every anchor span of the chain, the last one wrapping around when closed. */
function fitSpans(dense: Vec2[], anchors: number[], closed: boolean): CurveSpan[] {
  const pairs: [number, number][] = [];
  for (let j = 0; j + 1 < anchors.length; j++) pairs.push([anchors[j], anchors[j + 1]]);
  if (closed) pairs.push([anchors[anchors.length - 1], anchors[0]]);
  const spanIndices = (from: number, to: number): number[] => {
    const run = (lo: number, hi: number): number[] => {
      const out: number[] = [];
      for (let i = lo; i <= hi; i++) out.push(i);
      return out;
    };
    if (to > from) return run(from, to);
    if (to === from && !closed) return [from];
    return [...run(from, dense.length - 1), ...run(0, to)];
  };
  return pairs.map(([from, to]) => {
    const sampleIndices = spanIndices(from, to);
    const samples = sampleIndices.map(i => dense[i]);
    const tangentStart = spanDirection(dense, from, true, closed);
    const tangentEnd = spanDirection(dense, to, false, closed);
    const input = { samples, start: samples[0], end: samples[samples.length - 1], startTangent: tangentStart, endTangent: tangentEnd };
    return {
      samples, sampleIndices, tangentStart, tangentEnd,
      curve: bezierFromFit(input, fitBezierHandles(input)),
    };
  }).filter(span => span.samples.length >= 2);
}

/** Travel direction at one end of a span, taken from the neighbouring sample on the span's side. */
function spanDirection(dense: Vec2[], index: number, forwards: boolean, closed: boolean): Vec2 {
  const n = dense.length;
  const other = closed
    ? (index + (forwards ? 1 : n - 1)) % n
    : Math.max(0, Math.min(n - 1, index + (forwards ? 1 : -1)));
  const delta = forwards ? sub(dense[other], dense[index]) : sub(dense[index], dense[other]);
  if (Math.hypot(delta.x, delta.y) < 1e-9) return { x: 1, y: 0 };
  return normalize(delta);
}

/**
 * Largest deviation among the fitted spans, with the offending dense index. A non-finite
 * distance counts as failure so a broken fit is never accepted.
 */
function worstSpanDeviation(spans: CurveSpan[]): { deviation: number; sampleIndex: number } {
  let deviation = 0;
  let sampleIndex = spans[0]?.sampleIndices[0] ?? 0;
  for (const span of spans) {
    const curve = sampleCubic(span.curve);
    for (let k = 0; k < span.samples.length; k++) {
      const d = distanceToPolyline(span.samples[k], curve);
      if (!Number.isFinite(d)) return { deviation: Infinity, sampleIndex: span.sampleIndices[k] };
      if (d > deviation) {
        deviation = d;
        sampleIndex = span.sampleIndices[k];
      }
    }
  }
  return { deviation, sampleIndex };
}

/** Uniform samples of a cubic, used as the deviation reference for its span samples. */
function sampleCubic(curve: CubicBezier2): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i <= 128; i++) out.push(evalBezier(curve, i / 128));
  return out;
}

/** Pattern point id for each anchor: an existing chain vertex when the position matches. */
function anchorPointIds(pattern: Pattern, chain: string[], dense: Vec2[], anchors: number[], closed: boolean): string[] {
  const existing = new Set<string>();
  for (const id of chain) {
    existing.add(pattern.edges[id].startPointId);
    existing.add(pattern.edges[id].endPointId);
  }
  return anchors.map((index, j) => {
    const pos = dense[index];
    for (const id of existing) {
      const point = pattern.points[id];
      if (point && distance(point.pos, pos) <= 1e-6) return id;
    }
    const outerEnd = !closed && (j === 0 || j === anchors.length - 1);
    return newPoint(pattern, pos, outerEnd ? undefined : 'smooth');
  });
}

// ============ FR-4.3 parallel internal lines ============

/** Options for `OffsetInternalLineCommand`. */
export interface OffsetInternalLineOptions {
  /** Kind written to the created internal lines; defaults to 'decor'. */
  kind?: InternalLine['kind'];
}

/** Copies a panel outline edge inward at each distance and stores the parallel lines. */
export class OffsetInternalLineCommand extends SnapshotCommand {
  readonly label = '生成等距内部线';

  constructor(
    private edgeId: string,
    private distancesCm: number[],
    private opts: OffsetInternalLineOptions = {},
  ) { super(); }

  protected apply(pattern: Pattern, _ctx: ProjectContext): void {
    if (!pattern.edges[this.edgeId]) throw new Error('边不存在，无法生成等距线');
    if (this.distancesCm.length === 0) throw new Error('至少需要一个等距距离');
    for (const d of this.distancesCm) if (!(d > 0)) throw new Error('等距距离需为正数');

    const graph = buildPatternGraph(pattern);
    const panelId = (graph.edgeLocations.get(this.edgeId) ?? [])[0]?.panelId;
    const panel = panelId ? pattern.panels[panelId] : undefined;
    if (!panel) throw new Error('边不属于任何版片，无法生成等距线');

    const outline = samplePanelOutline(pattern, panel);
    if (outline.length < 3) throw new Error('版片轮廓无效，无法生成等距线');
    const source = sampleEdge(pattern, this.edgeId);
    const kind = this.opts.kind ?? 'decor';
    for (const distanceCm of this.distancesCm) {
      const forward = offsetPolyline(source, distanceCm);
      const inward = forward.every(p => insideOrOnRing(outline, p))
        ? forward
        : offsetPolyline(source, -distanceCm);
      if (!inward.every(p => insideOrOnRing(outline, p))) throw new Error('等距线超出版片轮廓');
      const id = genId('line');
      pattern.internalLines[id] = { id, kind, points: inward.map(p => ({ x: p.x, y: p.y })) };
      panel.internalLineIds.push(id);
    }
  }
}

// ============ FR-1.4 / FR-4.4 panel from internal loop ============

/** Options for `PanelFromInternalLoopCommand`. */
export interface PanelFromInternalLoopOptions {
  /** Name of the created panel; defaults to the source panel name with the inset suffix. */
  name?: string;
}

/**
 * Turns a closed internal line into a hole in its panel plus a new panel placed beside it,
 * stitched to the hole boundary edge by edge.
 */
export class PanelFromInternalLoopCommand extends SnapshotCommand {
  readonly label = '内部线成片';

  /** Id of the created panel, readable after execute. */
  newPanelId = '';

  constructor(
    private panelId: string,
    private internalLineId: string,
    private opts: PanelFromInternalLoopOptions = {},
  ) { super(); }

  protected apply(pattern: Pattern, ctx: ProjectContext): void {
    const panel = pattern.panels[this.panelId];
    if (!panel) throw new Error('版片不存在');
    const line = pattern.internalLines[this.internalLineId];
    if (!line) throw new Error('内部线不存在，无法成片');
    if (!panel.internalLineIds.includes(this.internalLineId)) throw new Error('内部线不属于该版片');

    const ring = loopRing(line.points);
    if (!ring) throw new Error('内部线不是闭合环，无法成片');
    if (hasSelfIntersection(ring)) throw new Error('内部线环自相交，无法成片');
    const outline = samplePanelOutline(pattern, panel);
    if (!ring.every(p => insidePolygon(outline, p))) throw new Error('内部线环需完全位于版片轮廓内');

    const ccw = ensureCCW(ring);
    const holeIds = addClosedLineOutline(pattern, [...ccw].reverse());
    panel.holes = [...(panel.holes ?? []), holeIds];

    const bbox = computeBBox(ccw);
    const shift = placeRight(pattern, bbox.min, bbox.max);
    const outlineIds = addClosedLineOutline(pattern, ccw.map(p => add(p, shift)));
    const created = makePanel(pattern, ctx, {
      name: this.opts.name ?? `${panel.name}内片`, seamAllowanceCm: panel.seamAllowanceCm,
    }, outlineIds);
    created.fabricId = panel.fabricId;
    created.meshResolutionCm = panel.meshResolutionCm;
    created.grainAngleDeg = panel.grainAngleDeg;
    created.grainOffset = panel.grainOffset ? { ...panel.grainOffset } : undefined;
    created.grainLengthCm = panel.grainLengthCm;
    this.newPanelId = created.id;

    const n = ccw.length;
    for (let m = 0; m < outlineIds.length; m++) {
      const seamId = genId('seam');
      pattern.seams[seamId] = {
        id: seamId,
        type: 'normal',
        a: { edgeId: outlineIds[m], t0: 0, t1: 1 },
        b: { edgeId: holeIds[(n - 2 - m + n * 2) % n], t0: 0, t1: 1 },
        flip: true,
        strength: 0.8,
        threadColor: '#ff4444',
        stitchVisible: true,
      };
    }
    line.kind = 'split';
  }
}

/** Distinct vertices of a closed polyline, or null when it does not close or is too short. */
function loopRing(points: Vec2[]): Vec2[] | null {
  if (points.length < 4) return null;
  if (distance(points[0], points[points.length - 1]) > 1e-6) return null;
  const ring = points.slice(0, points.length - 1);
  return ring.length >= 3 ? ring : null;
}

// ============ FR-5.2 rhombus dart ============

/**
 * Adds a diamond dart inside a panel: the outline detours through the inward tip while a
 * fourth closing vertex keeps the base open, drawn with two internal lines.
 */
export class RhombusDartCommand extends SnapshotCommand {
  readonly label = '创建菱形省';

  /** Id of the created dart, readable after execute. */
  dartId = '';

  /** @param t arc-length fraction along the outline edge where the dart base sits */
  constructor(
    private panelId: string,
    private edgeId: string,
    private t: number,
    private intakeCm: number,
    private lengthCm: number,
  ) { super(); }

  protected apply(pattern: Pattern, _ctx: ProjectContext): void {
    const panel = pattern.panels[this.panelId];
    if (!panel) throw new Error('版片不存在');
    if (!panel.outlineEdgeIds.includes(this.edgeId)) throw new Error('菱形省需在版片的轮廓边上创建');
    const edge = pattern.edges[this.edgeId];
    if (edge.type !== 'line') throw new Error('菱形省暂仅支持直线轮廓边');
    if (!(this.intakeCm > 0)) throw new Error('省量需为正数');
    if (!(this.lengthCm > 0)) throw new Error('省长需为正数');
    if (!(this.t >= 0 && this.t <= 1)) throw new Error('省位需在边的 0 到 1 之间');

    const span = edgeLength(pattern, this.edgeId);
    const centre = this.t * span;
    const half = this.intakeCm / 2;
    if (centre - half < 0 || centre + half > span) throw new Error('省量超出边长，无法布置菱形省');

    const baseA = pointAtT(pattern, this.edgeId, (centre - half) / span)!;
    const baseB = pointAtT(pattern, this.edgeId, (centre + half) / span)!;
    const [, onward] = splitLineEdge(pattern, this.edgeId, baseA);
    const [baseEdge] = splitLineEdge(pattern, onward, baseB);
    const baseStartId = pattern.edges[baseEdge].startPointId;
    const baseEndId = pattern.edges[baseEdge].endPointId;
    const baseStart = pattern.points[baseStartId]!.pos;
    const baseEnd = pattern.points[baseEndId]!.pos;

    const outline = samplePanelOutline(pattern, panel);
    const middle = { x: (baseStart.x + baseEnd.x) / 2, y: (baseStart.y + baseEnd.y) / 2 };
    const normal = inwardDirection(outline, middle, normalize(sub(baseEnd, baseStart)));
    const bbox = computeBBox(outline);
    const reach = Math.hypot(bbox.max.x - bbox.min.x, bbox.max.y - bbox.min.y) + 1;
    if (inwardDepth(outline, middle, normal, reach) < this.lengthCm + 0.2) throw new Error('省长超出版片范围，无法创建菱形省');

    const tip = add(middle, scale(normal, this.lengthCm));
    const closing = add(middle, scale(normal, this.lengthCm / 2));
    const tipId = newPoint(pattern, tip, 'corner');
    const leg1 = newEdge(pattern, 'line', baseStartId, tipId);
    const leg2 = newEdge(pattern, 'line', tipId, baseEndId);

    const index = panel.outlineEdgeIds.indexOf(baseEdge);
    panel.outlineEdgeIds.splice(index, 1, leg1, leg2);
    delete pattern.edges[baseEdge];
    // The diamond's two closing sides live as internal lines: the model owns no free points.
    for (const pair of [[baseEnd, closing], [closing, baseStart]] as [Vec2, Vec2][]) {
      const id = genId('line');
      pattern.internalLines[id] = { id, kind: 'split', points: pair.map(p => ({ x: p.x, y: p.y })) };
      panel.internalLineIds.push(id);
    }

    const dartId = genId('dart');
    pattern.darts[dartId] = { id: dartId, tipId, edge1Id: leg1, edge2Id: leg2, intakeCm: this.intakeCm };
    panel.dartIds.push(dartId);
    this.dartId = dartId;

    if (hasSelfIntersection(sampleOutline(pattern, panel.outlineEdgeIds))) throw new Error('菱形省导致轮廓自相交');
    prunePattern(pattern);
  }
}

/** Rounds both corners where one seam end joins, removing the point in the sewn joint. */
export class BlendSeamJointCommand extends SnapshotCommand {
  readonly label = '接角圆顺';

  /** Fabric angle of the joint before rounding, in degrees. */
  angleDeg = 0;

  /** @param end which end of the seam interval carries the joint */
  constructor(private seamId: string, private end: SeamJointEnd, private radiusCm: number) { super(); }

  protected apply(pattern: Pattern, _ctx: ProjectContext): void {
    const joint = seamJoint(pattern, this.seamId, this.end);
    if (!joint) throw new Error('接角圆顺需要缝合两端落在版片轮廓角点上');
    if (!(this.radiusCm > 0)) throw new Error('圆顺半径需为正数');
    this.angleDeg = joint.angleDeg;
    applyFillets(pattern, jointCornerIds(joint), this.radiusCm);
  }
}
