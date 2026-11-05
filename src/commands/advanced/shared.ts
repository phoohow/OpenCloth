import { genId } from '@/common/id';
import type { Panel, Pattern, PatternEdge, Vec2 } from '@/model/types';
import type { PatternTopology } from '@/model';
import type { ProjectContext } from '@/commands/command';

import { makePanel, newPoint } from '@/commands/patternCreateCommands';
import { edgeLength } from '@/pattern/geom';
import { sampleOutline } from '@/pattern/panel';
import { add, distance, normalize, scale, sub } from '@/common/geom';
import { hasSelfIntersection } from '@/common/geom/offset';
import { distanceToPolyline } from '@/common/geom/polyCurve';
import { insidePolygon } from '@/commands/patternStructureCommands';

export const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

export const rad = (deg: number): number => (deg * Math.PI) / 180;

export const scaleAbout = (center: Vec2, p: Vec2, factor: number): Vec2 => add(center, scale(sub(p, center), factor));

export const rotateAbout = (center: Vec2, p: Vec2, angle: number): Vec2 => {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const dx = p.x - center.x, dy = p.y - center.y;
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos };
};

/** Every panel outline and hole loop edge id list, live so in-place edits reach the panel. */
export function edgeArrays(pattern: Pattern): string[][] {
  const arrays: string[][] = [];
  for (const panel of Object.values(pattern.panels)) {
    arrays.push(panel.outlineEdgeIds);
    for (const loop of panel.holes ?? []) arrays.push(loop);
  }
  return arrays;
}

/** Replaces every contiguous occurrence of `from` with `to` in an edge id list. */
export function spliceSequence(ids: string[], from: string[], to: string[]): string[] {
  let out = ids;
  for (let guard = 0; guard < 16; guard++) {
    const index = out.findIndex((_, i) => from.every((id, k) => out[i + k] === id));
    if (index < 0) return out;
    out = [...out.slice(0, index), ...to, ...out.slice(index + from.length)];
  }
  return out;
}

/** True when `chain` runs contiguously through an edge id list, wrapping at its ends. */
export function arrayContainsChain(ids: string[], chain: string[]): boolean {
  const n = ids.length, m = chain.length;
  if (m === 0 || n < m) return false;
  for (let start = 0; start < n; start++) {
    if (chain.every((id, k) => ids[(start + k) % n] === id)) return true;
  }
  return false;
}

/** Panels whose outline or holes reference any of `edgeIds`. */
export function panelsOwningAny(pattern: Pattern, edgeIds: Iterable<string>): Panel[] {
  const wanted = new Set(edgeIds);
  return Object.values(pattern.panels).filter(panel =>
    [...panel.outlineEdgeIds, ...(panel.holes ?? []).flat()].some(id => wanted.has(id)));
}

/** Outline or hole edges of some panel that end or start at a point. */
export function incidentOutlineEdges(topology: PatternTopology, pointId: string): Set<string> {
  const ids = new Set<string>();
  for (const ref of topology.edgesOf(pointId)) {
    if (topology.isOnLoop(ref.edgeId)) ids.add(ref.edgeId);
  }
  return ids;
}

/** Edge ids of a point that sit on a panel outline or hole. */
export function outlineEdgesOfPoint(topology: PatternTopology, pointId: string): string[] {
  return topology.edgesOf(pointId)
    .map(ref => ref.edgeId)
    .filter(edgeId => topology.isOnLoop(edgeId));
}

/**
 * Maximal closed chains of an outline edge list, or null when a chain stays open or an edge
 * dangles. Splitting a vertex shared by several loops is what makes each loop its own panel.
 */
export function closedChains(pattern: Pattern, ids: string[]): string[][] | null {
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
export function newPanelFromChain(
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
export function assignClosedChains(pattern: Pattern, ctx: ProjectContext, panel: Panel, nameSuffix: string): void {
  const chains = closedChains(pattern, panel.outlineEdgeIds);
  if (!chains) throw new Error(`轮廓断开后无法闭合成片：${panel.name}`);
  panel.outlineEdgeIds = chains[0];
  for (const chain of chains.slice(1)) newPanelFromChain(pattern, ctx, panel, chain, nameSuffix);
}

/** Cumulative arc-length fractions at each chain boundary, running 0 to 1 across the chain. */
export function chainFractions(pattern: Pattern, chain: string[]): number[] {
  const total = chain.reduce((sum, id) => sum + edgeLength(pattern, id), 0) || 1;
  const out = [0];
  for (const id of chain) out.push(out[out.length - 1] + edgeLength(pattern, id) / total);
  out[out.length - 1] = 1;
  return out;
}

/** Seam interval bounds kept strictly ordered and inside one edge. */
export function shrinkInterval(lo: number, hi: number): [number, number] {
  const high = Math.min(1, Math.max(hi, lo + 1e-4));
  const low = Math.max(0, Math.min(lo, high - 1e-4));
  return [low, high];
}

/** Moves seam intervals and notch positions of a replaced chain onto its successor. */
export function remapChainReferences(pattern: Pattern, fromChain: string[], from: number[], toChain: string[]): void {
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
export function dropUnusedHandles(pattern: Pattern, pointIds: Iterable<string>): void {
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
export function assertOwningPanelsSimple(pattern: Pattern, edgeIds: Iterable<string>, message: string): void {
  const wanted = new Set(edgeIds);
  for (const panel of Object.values(pattern.panels)) {
    if (!panel.outlineEdgeIds.some(id => wanted.has(id))) continue;
    if (hasSelfIntersection(sampleOutline(pattern, panel.outlineEdgeIds))) throw new Error(message);
  }
}

/** True when a point lies inside the ring or on it within tolerance. */
export function insideOrOnRing(ring: Vec2[], p: Vec2): boolean {
  return insidePolygon(ring, p) || distanceToPolyline(p, [...ring, ring[0]]) <= 1e-6;
}

/** Unit perpendicular of `direction` whose probe point lies inside `outline`. */
export function inwardDirection(outline: Vec2[], base: Vec2, direction: Vec2): Vec2 {
  const candidates = [normalize({ x: -direction.y, y: direction.x }), normalize({ x: direction.y, y: -direction.x })];
  for (const candidate of candidates) {
    if (insidePolygon(outline, add(base, scale(candidate, 0.05)))) return candidate;
  }
  throw new Error('无法确定版片的内侧方向');
}

/** How far `normal` from `base` stays inside `outline`, in cm. */
export function inwardDepth(outline: Vec2[], base: Vec2, normal: Vec2, reach: number): number {
  const steps = 200;
  for (let i = 1; i <= steps; i++) {
    const depth = (reach * i) / steps;
    if (!insidePolygon(outline, add(base, scale(normal, depth)))) return (reach * (i - 1)) / steps;
  }
  return reach;
}

/** Splits a straight outline edge at a position, rewiring outlines, holes, seams and notches. */
export function splitLineEdge(pattern: Pattern, edgeId: string, at: Vec2): [string, string] {
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

/** The vertex two edges share, preferring the end of the rotating edge as the join point. */
export function sharedVertexOf(edge: PatternEdge, other: PatternEdge): string {
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
export function handleExclusive(
  pattern: Pattern, pointId: string, which: 'handleIn' | 'handleOut', edgeId: string,
): boolean {
  return Object.values(pattern.edges).every(edge => {
    if (edge.type !== 'bezier' || edge.id === edgeId) return true;
    return which === 'handleIn' ? edge.endPointId !== pointId : edge.startPointId !== pointId;
  });
}

/** Vertex ids a chain passes through, excluding both ends. */
export function interiorPointIds(pattern: Pattern, chain: string[]): string[] {
  const out: string[] = [];
  for (let i = 1; i < chain.length; i++) {
    const id = pattern.edges[chain[i]].startPointId;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/** Distinct vertices of a closed polyline, or null when it does not close or is too short. */
export function loopRing(points: Vec2[]): Vec2[] | null {
  if (points.length < 4) return null;
  if (distance(points[0], points[points.length - 1]) > 1e-6) return null;
  const ring = points.slice(0, points.length - 1);
  return ring.length >= 3 ? ring : null;
}
