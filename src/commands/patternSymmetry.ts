import type { Panel, Pattern, Vec2 } from '@/model/types';

import { arcFromThreePoints, evalArc } from '@/base/geom/arc';
import { genId } from '@/base/id';
import { reflectAcrossLine2 } from '@/base/math';
import { prunePattern } from '@/commands/patternPrune';

export type MirrorAxis = 'x' | 'y' | string;

function reflector(pattern: Pattern, axis: MirrorAxis): (p: Vec2) => Vec2 {
  if (axis === 'x') return p => ({ x: p.x, y: -p.y });
  if (axis === 'y') return p => ({ x: -p.x, y: p.y });
  const edge = pattern.edges[axis];
  if (!edge) throw new Error('镜像轴边不存在');
  const a = pattern.points[edge.startPointId]?.pos;
  const b = pattern.points[edge.endPointId]?.pos;
  if (!a || !b) throw new Error('镜像轴边端点缺失');
  return p => reflectAcrossLine2(p, a, b);
}

function mirroredPoint(pattern: Pattern, srcId: string, reflect: (p: Vec2) => Vec2, cache: Map<string, string>): string {
  const existing = cache.get(srcId);
  if (existing) return existing;
  const src = pattern.points[srcId];
  const id = genId('pt');
  const pos = reflect(src.pos);
  const point: Pattern['points'][string] = { id, pos };
  if (src.kind) point.kind = src.kind;
  if (src.handleOut) point.handleIn = reflect(src.handleOut);
  if (src.handleIn) point.handleOut = reflect(src.handleIn);
  pattern.points[id] = point;
  cache.set(srcId, id);
  return id;
}

function mirroredEdge(pattern: Pattern, edgeId: string, reflect: (p: Vec2) => Vec2, cache: Map<string, string>): string {
  const src = pattern.edges[edgeId];
  const startId = mirroredPoint(pattern, src.endPointId, reflect, cache);
  const endId = mirroredPoint(pattern, src.startPointId, reflect, cache);
  const id = genId('edge');
  let arc: Pattern['edges'][string]['arc'];
  if (src.type === 'arc' && src.arc) {
    const s = pattern.points[src.startPointId].pos;
    const e = pattern.points[src.endPointId].pos;
    const mid = evalArc(src.arc, 0.5);
    arc = arcFromThreePoints(reflect(s), reflect(mid), reflect(e)) ?? undefined;
    if (!arc) throw new Error('镜像圆弧无法生成');
  }

  const edge: Pattern['edges'][string] = { id, type: src.type, startPointId: startId, endPointId: endId };
  if (arc) edge.arc = arc;
  pattern.edges[id] = edge;
  return id;
}

export function buildMirrorEdges(pattern: Pattern, source: Panel, axis: MirrorAxis): { edgeIds: string[]; pointIds: string[] } {
  const reflect = reflector(pattern, axis);
  const cache = new Map<string, string>();
  const edgeIds = [...source.outlineEdgeIds].reverse().map(id => mirroredEdge(pattern, id, reflect, cache));
  return { edgeIds, pointIds: [...cache.values()] };
}

function outlineFingerprint(pattern: Pattern, panel: Panel): string {
  const point = (id: string): unknown => {
    const p = pattern.points[id];
    return p ? [p.pos.x, p.pos.y, p.handleIn ?? null, p.handleOut ?? null, p.kind ?? null] : null;
  };
  return JSON.stringify(panel.outlineEdgeIds.map(edgeId => {
    const edge = pattern.edges[edgeId];
    return edge
      ? [edgeId, edge.type, edge.arc ?? null, point(edge.startPointId), point(edge.endPointId)]
      : [edgeId];
  }));
}

export function autoSyncMirrors(pattern: Pattern, before: Pattern): boolean {
  const handled = new Set<string>();
  let changed = false;
  for (const id of Object.keys(pattern.panels).sort()) {
    if (handled.has(id)) continue;
    const panel = pattern.panels[id];
    const linkedId = panel.symmetry?.linkedPanelId;
    if (!linkedId) continue;
    const partner = pattern.panels[linkedId];
    if (!partner || partner.symmetry?.linkedPanelId !== id) continue;
    handled.add(id);
    handled.add(partner.id);

    const beforeA = before.panels[id];
    const beforeB = before.panels[partner.id];
    if (!beforeA || !beforeB) continue;
    if (beforeA.symmetry?.linkedPanelId !== partner.id || beforeB.symmetry?.linkedPanelId !== id) continue;

    const aChanged = outlineFingerprint(pattern, panel) !== outlineFingerprint(before, beforeA);
    const bChanged = outlineFingerprint(pattern, partner) !== outlineFingerprint(before, beforeB);
    if (!aChanged && !bChanged) continue;
    const source = aChanged === bChanged
      ? (panel.id < partner.id ? panel : partner)
      : (aChanged ? panel : partner);
    const target = source === panel ? partner : panel;
    const axis = target.symmetry?.axisEdgeId;
    if (!axis) continue;

    const { edgeIds } = buildMirrorEdges(pattern, source, axis);
    target.outlineEdgeIds = edgeIds;
    prunePattern(pattern);
    changed = true;
  }

  return changed;
}
