import { genId } from '@/common/id';
import type { Panel, Pattern, Vec2 } from '@/model/types';
import { createEmptyPattern, DEFAULT_MESH_RESOLUTION_CM } from '@/model';
import { ensureCCW, polygonArea } from '@/common/geom';

/** One imported drawing as point chains, in centimetres; open chains are welded into loops. */
export interface ImportedGroup {
  name?: string;
  chains: Vec2[][];
}

/** Quantized coordinate key; imported chains meet within a fraction of a millimetre. */
const posKey = (p: Vec2): string => `${Math.round(p.x * 1000)},${Math.round(p.y * 1000)}`;

const samePoint = (a: Vec2, b: Vec2): boolean => Math.hypot(a.x - b.x, a.y - b.y) < 1e-3;

/** Drops consecutive duplicate points. */
function dedupe(chain: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of chain) {
    if (out.length > 0 && samePoint(out[out.length - 1]!, p)) continue;
    out.push({ x: p.x, y: p.y });
  }
  return out;
}

/** Welds open chains that share endpoints into closed loops; leftovers are dropped. */
export function weldChains(chains: Vec2[][]): Vec2[][] {
  const starts = new Map<string, number[]>();
  chains.forEach((chain, index) => {
    const list = starts.get(posKey(chain[0]!));
    if (list) list.push(index);
    else starts.set(posKey(chain[0]!), [index]);
  });
  const used = new Set<number>();
  const loops: Vec2[][] = [];

  for (let i = 0; i < chains.length; i++) {
    if (used.has(i)) continue;
    const loop = [...chains[i]!];
    used.add(i);
    let closed = false;
    for (let guard = 0; guard < chains.length + 1; guard++) {
      if (posKey(loop[loop.length - 1]!) === posKey(loop[0]!)) {
        closed = loop.length >= 4;
        break;
      }
      const next = (starts.get(posKey(loop[loop.length - 1]!)) ?? []).find(index => !used.has(index));
      if (next === undefined) break;
      used.add(next);
      loop.push(...chains[next]!.slice(1));
    }
    if (!closed) continue;
    const trimmed = dedupe(loop.slice(0, -1));
    if (trimmed.length >= 3) loops.push(trimmed);
  }
  return loops;
}

/** Splits chains into closed loops and welded open chains. */
export function closedLoops(chains: Vec2[][]): Vec2[][] {
  const closed: Vec2[][] = [];
  const open: Vec2[][] = [];
  for (const chain of chains) {
    const points = dedupe(chain);
    if (points.length < 2) continue;
    if (points.length >= 3 && samePoint(points[0]!, points[points.length - 1]!)) {
      const loop = dedupe(points.slice(0, -1));
      if (loop.length >= 3) closed.push(loop);
    } else {
      open.push(points);
    }
  }
  return [...closed, ...weldChains(open)];
}

/** Point and edge lookup so loops sharing vertices reuse the same pattern records. */
interface LoopStore {
  pointByKey: Map<string, string>;
  edgeByPair: Map<string, string>;
}

function resolvePoint(pattern: Pattern, store: LoopStore, p: Vec2): string {
  const key = posKey(p);
  const existing = store.pointByKey.get(key);
  if (existing) return existing;
  const id = genId('pt');
  pattern.points[id] = { id, pos: { x: p.x, y: p.y }, kind: 'corner' };
  store.pointByKey.set(key, id);
  return id;
}

function resolveLoop(pattern: Pattern, store: LoopStore, loop: Vec2[]): string[] {
  const ids = loop.map(p => resolvePoint(pattern, store, p));
  const edgeIds: string[] = [];
  for (let i = 0; i < ids.length; i++) {
    const a = ids[i]!;
    const b = ids[(i + 1) % ids.length]!;
    const pair = `${a}>${b}`;
    let edgeId = store.edgeByPair.get(pair);
    if (!edgeId) {
      edgeId = genId('edge');
      pattern.edges[edgeId] = { id: edgeId, type: 'line', startPointId: a, endPointId: b, semantic: 'free' };
      store.edgeByPair.set(pair, edgeId);
    }
    edgeIds.push(edgeId);
  }
  return edgeIds;
}

function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function chainCenter(chain: Vec2[]): Vec2 {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of chain) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

/**
 * Builds a pattern from imported loops: the largest loop of each group becomes a panel,
 * loops nested inside it become holes, and the rest are separate panels sharing vertices.
 */
export function patternFromGroups(groups: ImportedGroup[]): Pattern {
  const pattern = createEmptyPattern();
  const store: LoopStore = { pointByKey: new Map(), edgeByPair: new Map() };
  let created = 0;

  for (const group of groups) {
    const loops = closedLoops(group.chains)
      .map(loop => ensureCCW(loop))
      .filter(loop => Math.abs(polygonArea(loop)) > 0.01);
    if (loops.length === 0) continue;

    const candidates: { panel: Panel; loop: Vec2[] }[] = [];
    const byArea = [...loops].sort((a, b) => Math.abs(polygonArea(b)) - Math.abs(polygonArea(a)));
    for (const loop of byArea) {
      const area = Math.abs(polygonArea(loop));
      const parent = candidates.find(candidate =>
        Math.abs(polygonArea(candidate.loop)) > area && pointInPolygon(chainCenter(loop), candidate.loop));
      if (parent) {
        parent.panel.holes = parent.panel.holes ?? [];
        parent.panel.holes.push(resolveLoop(pattern, store, loop));
        continue;
      }
      created += 1;
      const baseName = group.name?.trim();
      const name = baseName ? (byArea.length > 1 ? `${baseName} ${created}` : baseName) : `版片${created}`;
      const panel: Panel = {
        id: genId('panel'),
        name,
        outlineEdgeIds: resolveLoop(pattern, store, loop),
        dartIds: [],
        internalLineIds: [],
        holes: [],
        seamAllowanceCm: 0,
        fabricId: 'fabric_default',
        meshResolutionCm: DEFAULT_MESH_RESOLUTION_CM,
        visible: true,
        locked: false,
      };
      pattern.panels[panel.id] = panel;
      candidates.push({ panel, loop });
    }
  }

  if (created === 0) throw new Error('文件里没有闭合轮廓');
  return pattern;
}
