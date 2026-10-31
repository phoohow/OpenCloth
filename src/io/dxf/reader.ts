import type { Panel, Pattern, Vec2 } from '../../core/model/types';
import { genId, createEmptyPattern, DEFAULT_MESH_RESOLUTION_CM } from '../../core/model/defaults';
import { normalizePattern } from '../codec';
import { validatePattern } from '../../core/model/validatePattern';
import { sampleEdge } from '../../pattern/geom/edgeSample';
import { adaptiveSampleArc, arcFromThreePoints } from '../../pattern/geom/arc';
import { computeBBox, ensureCCW, polygonArea } from '../../pattern/geom/vec2';
import { parseDxf, expandInserts, type DxfEntity, type DxfVertex } from './dxfParser';
import { layerRole, type DxfConvention, type LayerRole } from './layers';
import { unescapeDxfValue } from './writer';

/** Options for `parsePatternDxf`. */
export interface ParseDxfOptions {
  /** Drawing units of the file; default 'mm'. */
  units?: 'cm' | 'mm' | 'inch';
  /** Layer naming convention; default 'AAMA'. */
  convention?: DxfConvention;
}

const UNIT_TO_CM: Record<NonNullable<ParseDxfOptions['units']>, number> = { mm: 0.1, cm: 1, inch: 2.54 };
const UNIT_TO_MM: Record<NonNullable<ParseDxfOptions['units']>, number> = { mm: 1, cm: 10, inch: 25.4 };

const posKey = (p: Vec2): string => `${Math.round(p.x * 1000)},${Math.round(p.y * 1000)}`;

const samePoint = (a: Vec2, b: Vec2): boolean => Math.hypot(a.x - b.x, a.y - b.y) < 1e-6;

function dedupeChain(pts: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of pts) {
    if (out.length && samePoint(p, out[out.length - 1])) continue;
    out.push(p);
  }
  return out;
}

/** Removes the repeated closing vertex and short degenerate loops; null when not a usable loop. */
function cleanLoop(chain: Vec2[]): Vec2[] | null {
  let pts = dedupeChain(chain);
  if (pts.length > 1 && samePoint(pts[0], pts[pts.length - 1])) pts = pts.slice(0, -1);
  return pts.length >= 3 ? pts : null;
}

/** Midpoint of the arc implied by a polyline bulge: chord middle plus (b/2)·perpRight(d). */
function bulgeMid(a: Vec2, b: Vec2, bulge: number): Vec2 {
  return {
    x: (a.x + b.x) / 2 + (bulge * (b.y - a.y)) / 2,
    y: (a.y + b.y) / 2 - (bulge * (b.x - a.x)) / 2,
  };
}

/** Turns polyline vertices, arcs included, into a densified point chain. */
function verticesToChain(vertices: DxfVertex[], closed: boolean): Vec2[] {
  const pts = vertices.map(v => ({ x: v.x, y: v.y }));
  const chain: Vec2[] = [];
  const segments = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < segments; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    chain.push(a);
    const bulge = vertices[i]?.bulge ?? 0;
    if (Math.abs(bulge) > 1e-6) {
      const mid = bulgeMid(a, b, bulge);
      const arc = arcFromThreePoints(a, mid, b);
      chain.push(...(arc ? adaptiveSampleArc(arc, 0.005).slice(1, -1) : [mid]));
    }
  }
  chain.push(pts[closed ? 0 : pts.length - 1]);
  return chain;
}

/** One entity densified to a cm chain; `closed` marks loops. */
function entityChain(e: DxfEntity, s: number): { pts: Vec2[]; closed: boolean } | null {
  switch (e.kind) {
    case 'line':
      return { pts: scaleChain([e.start, e.end], s), closed: false };
    case 'polyline':
      return { pts: verticesToChain(scaleVertices(e.vertices, s), e.closed), closed: e.closed };
    case 'arc': {
      const arc = {
        center: { x: e.center.x * s, y: e.center.y * s },
        radius: e.radius * s,
        startAngle: (e.startAngleDeg * Math.PI) / 180,
        endAngle: (e.endAngleDeg * Math.PI) / 180,
        ccw: true,
      };
      return { pts: adaptiveSampleArc(arc, 0.005), closed: false };
    }
    case 'circle': {
      const full = Array.from({ length: 49 }, (_, i) => {
        const a = (i / 48) * Math.PI * 2;
        return { x: e.center.x + e.radius * Math.cos(a), y: e.center.y + e.radius * Math.sin(a) };
      });
      return { pts: scaleChain(full, s), closed: true };
    }
    default:
      return null;
  }
}

const scaleVertices = (vertices: DxfVertex[], s: number): DxfVertex[] =>
  vertices.map(v => ({ x: v.x * s, y: v.y * s, bulge: v.bulge }));

const scaleChain = (pts: Vec2[], s: number): Vec2[] => pts.map(p => ({ x: p.x * s, y: p.y * s }));

/** Welds open chains sharing endpoints into closed loops; leftovers are dropped. */
function weldLoops(chains: Vec2[][]): Vec2[][] {
  const starts = new Map<string, number[]>();
  chains.forEach((c, idx) => {
    const key = posKey(c[0]);
    const list = starts.get(key);
    if (list) list.push(idx);
    else starts.set(key, [idx]);
  });
  const used = new Set<number>();
  const loops: Vec2[][] = [];

  for (let i = 0; i < chains.length; i++) {
    if (used.has(i)) continue;
    const loop = [...chains[i]];
    used.add(i);
    let ok = false;
    for (let guard = 0; guard < chains.length + 1; guard++) {
      if (posKey(loop[loop.length - 1]) === posKey(loop[0])) {
        ok = loop.length >= 4;
        break;
      }
      const candidates = (starts.get(posKey(loop[loop.length - 1])) ?? []).filter(idx => !used.has(idx));
      const next = candidates[0];
      if (next === undefined) break;
      used.add(next);
      for (let j = 1; j < chains[next].length; j++) loop.push(chains[next][j]);
    }
    if (ok) {
      const closed = cleanLoop(loop);
      if (closed) loops.push(closed);
    }
  }
  return loops;
}

function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Distance from a point to a point sequence treated as a polyline. */
function distanceToChain(p: Vec2, chain: Vec2[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < chain.length; i++) {
    const a = chain[i], b = chain[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    best = Math.min(best, Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)));
  }
  return best;
}

function chainCenter(chain: Vec2[]): Vec2 {
  const box = computeBBox(chain);
  return { x: (box.min.x + box.max.x) / 2, y: (box.min.y + box.max.y) / 2 };
}

/** Pattern-wide coincidence maps so shared vertices and edges are reused. */
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

function resolveEdge(pattern: Pattern, store: LoopStore, loop: Vec2[]): string[] {
  const ids: string[] = [];
  for (let i = 0; i < loop.length; i++) {
    const a = resolvePoint(pattern, store, loop[i]);
    const b = resolvePoint(pattern, store, loop[(i + 1) % loop.length]);
    const pair = `${a}>${b}`;
    let edgeId = store.edgeByPair.get(pair);
    if (!edgeId) {
      edgeId = genId('edge');
      pattern.edges[edgeId] = { id: edgeId, type: 'line', startPointId: a, endPointId: b, semantic: 'free' };
      store.edgeByPair.set(pair, edgeId);
    }
    ids.push(edgeId);
  }
  return ids;
}

/** Samples a panel's outline (or any edge loop) as a closed cm polygon. */
function loopPoints(pattern: Pattern, edgeIds: string[]): Vec2[] {
  const pts: Vec2[] = [];
  for (const edgeId of edgeIds) {
    for (const p of sampleEdge(pattern, edgeId)) pts.push(p);
  }
  if (pts.length > 1 && samePoint(pts[0], pts[pts.length - 1])) pts.pop();
  return pts;
}

/** Nearest edge-and-fraction position of a point among a panel's edges. */
function nearestOnPanel(pattern: Pattern, panel: Panel, p: Vec2): { edgeId: string; t: number; dist: number } | null {
  let best: { edgeId: string; t: number; dist: number } | null = null;
  for (const edgeId of [...panel.outlineEdgeIds, ...(panel.holes ?? []).flat()]) {
    const pts = sampleEdge(pattern, edgeId);
    let run = 0;
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const dx = b.x - a.x, dy = b.y - a.y;
      const segLen = Math.hypot(dx, dy);
      const len2 = segLen * segLen;
      const k = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
      const dist = Math.hypot(p.x - (a.x + dx * k), p.y - (a.y + dy * k));
      if (!best || dist < best.dist) best = { edgeId, t: total > 0 ? (run + segLen * k) / total : 0, dist };
      run += segLen;
    }
  }
  return best;
}

/** Picks the panel that should own geometry near the given probe points. */
function pickPanel(candidates: { panel: Panel; loop: Vec2[] }[], pts: Vec2[]): Panel | null {
  if (candidates.length === 0) return null;
  const probe = chainCenter(pts);
  const inside = candidates.find(c => pointInPolygon(probe, ensureCCW(c.loop)));
  if (inside) return inside.panel;
  let best: Panel | null = null;
  let bestDist = Infinity;
  for (const c of candidates) {
    const d = distanceToChain(probe, ensureCCW(c.loop));
    if (d < bestDist) {
      bestDist = d;
      best = c.panel;
    }
  }
  return best;
}

interface GroupLine {
  role: LayerRole;
  pts: Vec2[];
  layer: string;
}

/**
 * Parses a garment pattern DXF (R12 ASCII) into the v2 pattern model. `\U+XXXX` escapes in text and
 * block names are decoded, so ASCII files keep their original strings; a multi-size file yields one
 * panel per block, named `<panel>-<size label>`.
 */
export function parsePatternDxf(text: string, opts: ParseDxfOptions = {}): Pattern {
  const units = opts.units ?? 'mm';
  const convention = opts.convention ?? 'AAMA';
  const s = UNIT_TO_CM[units];
  const mmPerUnit = UNIT_TO_MM[units];
  const doc = parseDxf(text);

  // Root INSERT references mean the root layout is authoritative: one group per insert.
  // Files that only define blocks without inserts fall back to the block definitions.
  const groups: { name: string; entities: DxfEntity[] }[] = [];
  const inserts = doc.entities.filter(e => e.kind === 'insert');
  if (inserts.length > 0) {
    for (const insert of inserts) {
      if (!doc.blocks[insert.blockName]) continue;
      groups.push({ name: unescapeDxfValue(insert.blockName), entities: expandInserts([insert], doc) });
    }
    const plainRoot = doc.entities.filter(e => e.kind !== 'insert');
    if (plainRoot.length > 0) groups.push({ name: '', entities: expandInserts(plainRoot, doc) });
  } else {
    for (const block of Object.values(doc.blocks)) {
      groups.push({ name: unescapeDxfValue(block.name), entities: expandInserts(block.entities, doc) });
    }
    const rootEntities = expandInserts(doc.entities, doc);
    if (rootEntities.length > 0 || groups.length === 0) groups.push({ name: '', entities: rootEntities });
  }

  const pattern = createEmptyPattern();
  const store: LoopStore = { pointByKey: new Map(), edgeByPair: new Map() };

  for (const group of groups) {
    const outlineLoops: Vec2[][] = [];
    const looseChains: Vec2[][] = [];
    const saLoops: Vec2[][] = [];
    const lines: GroupLine[] = [];
    const drills: { center: Vec2; radiusMm: number }[] = [];
    const texts: { pos: Vec2; heightMm: number; rotDeg: number; text: string }[] = [];

    for (const e of group.entities) {
      const role = layerRole(e.layer, convention);
      if (role === 'ignore') continue;

      if (e.kind === 'text') {
        if (role === 'annotation' && e.text.trim() !== '') {
          texts.push({ pos: { x: e.pos.x * s, y: e.pos.y * s }, heightMm: e.height * mmPerUnit, rotDeg: e.rotationDeg, text: unescapeDxfValue(e.text.trim()) });
        }
        continue;
      }
      if (e.kind === 'circle' && role === 'drill') {
        drills.push({ center: { x: e.center.x * s, y: e.center.y * s }, radiusMm: e.radius * mmPerUnit });
        continue;
      }

      const chain = entityChain(e, s);
      if (!chain) continue;
      const pts = dedupeChain(chain.pts);
      if (pts.length < 2) continue;

      const loop = cleanLoop(pts);
      if (role === 'outline') {
        if (chain.closed && loop) outlineLoops.push(loop);
        else if (!chain.closed) looseChains.push(pts);
      } else if (role === 'seamAllowance') {
        if (chain.closed && loop) saLoops.push(loop);
        else lines.push({ role: 'internalLine', pts, layer: e.layer });
      } else {
        lines.push({ role, pts, layer: e.layer });
      }
    }
    for (const loop of weldLoops(looseChains)) outlineLoops.push(loop);

    // Largest loop outlines a panel; loops nested inside a panel outline become its holes.
    const candidates: { panel: Panel; loop: Vec2[] }[] = [];
    const bySize = [...outlineLoops].sort((a, b) => Math.abs(polygonArea(b)) - Math.abs(polygonArea(a)));
    let groupPanelCount = 0;
    for (const loop of bySize) {
      const area = Math.abs(polygonArea(loop));
      const parent = candidates.find(c => Math.abs(polygonArea(c.loop)) > area && pointInPolygon(chainCenter(loop), ensureCCW(c.loop)));
      if (parent) {
        parent.panel.holes = parent.panel.holes ?? [];
        parent.panel.holes.push(resolveEdge(pattern, store, ensureCCW(loop)));
        continue;
      }
      groupPanelCount += 1;
      const fallback = `版片${Object.keys(pattern.panels).length + 1}`;
      const panelName = group.name
        ? (groupPanelCount === 1 ? group.name : `${group.name} ${groupPanelCount}`)
        : fallback;
      const edgeIds = resolveEdge(pattern, store, ensureCCW(loop));
      const panel: Panel = {
        id: genId('panel'),
        name: panelName,
        outlineEdgeIds: edgeIds,
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
    if (candidates.length === 0) continue;

    // Seam allowance loops only measure the offset distance; the net outline stays the panel shape.
    for (const loop of saLoops) {
      const owner = pickPanel(candidates, loop);
      if (!owner) continue;
      const saChain = [...loop, loop[0]];
      const outlinePts = loopPoints(pattern, owner.outlineEdgeIds);
      if (outlinePts.length < 3) continue;
      const mean = outlinePts.reduce((acc, p) => acc + distanceToChain(p, saChain), 0) / outlinePts.length;
      owner.seamAllowanceCm = Math.max(0, Math.round(mean * 100) / 100);
    }

    for (const { role, pts, layer } of lines) {
      const owner = pickPanel(candidates, pts);
      if (!owner) continue;

      if (role === 'grainline') {
        const a = pts[0], b = pts[pts.length - 1];
        const deg = ((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI + 180) % 180;
        if (owner.grainAngleDeg === undefined) {
          owner.grainAngleDeg = Math.round(deg * 100) / 100;
          const outlinePts = loopPoints(pattern, owner.outlineEdgeIds);
          if (outlinePts.length >= 3) {
            const box = computeBBox(outlinePts);
            const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            const offsetX = Math.round((mid.x - (box.min.x + box.max.x) / 2) * 100) / 100;
            const offsetY = Math.round((mid.y - (box.min.y + box.max.y) / 2) * 100) / 100;
            if (offsetX !== 0 || offsetY !== 0) owner.grainOffset = { x: offsetX, y: offsetY };
            const lengthCm = Math.round(Math.hypot(b.x - a.x, b.y - a.y) * 100) / 100;
            if (lengthCm > 0) owner.grainLengthCm = lengthCm;
          }
        }
        continue;
      }
      if (role === 'notch' || role === 'drill') {
        const mid = { x: (pts[0].x + pts[pts.length - 1].x) / 2, y: (pts[0].y + pts[pts.length - 1].y) / 2 };
        const hit = nearestOnPanel(pattern, owner, mid);
        if (hit && hit.dist < 3) {
          const id = genId('notch');
          pattern.notches[id] = { id, edgeId: hit.edgeId, t: Math.round(hit.t * 10000) / 10000, style: role === 'drill' ? 'drill' : 'v' };
        }
        continue;
      }
      if (role === 'annotation') continue;

      const id = genId('iline');
      const kind = layer.toUpperCase().includes('FOLD') ? 'fold' : role === 'dart' ? 'split' : 'decor';
      pattern.internalLines[id] = { id, points: pts, kind };
      owner.internalLineIds.push(id);
    }

    for (const drill of drills) {
      const owner = pickPanel(candidates, [drill.center]);
      if (!owner) continue;
      const hit = nearestOnPanel(pattern, owner, drill.center);
      if (hit && hit.dist < 3) {
        const id = genId('notch');
        pattern.notches[id] = {
          id, edgeId: hit.edgeId, t: Math.round(hit.t * 10000) / 10000,
          style: 'drill', widthMm: Math.round(drill.radiusMm * 2 * 100) / 100,
        };
      }
    }

    for (const t of texts) {
      const owner = pickPanel(candidates, [t.pos]);
      if (!owner) continue;
      const id = genId('anno');
      pattern.annotations[id] = {
        id, panelId: owner.id, text: t.text, pos: t.pos,
        ...(t.rotDeg !== 0 ? { angleDeg: t.rotDeg } : {}),
        sizeMm: Math.round(t.heightMm * 100) / 100,
      };
    }
  }

  normalizePattern(pattern);
  if (Object.keys(pattern.panels).length === 0) {
    throw new Error('DXF 导入失败：文件中未找到有效的版片轮廓');
  }
  const issues = validatePattern(pattern);
  if (issues.length > 0) {
    const invalidNames = new Set<string>();
    for (const issue of issues) {
      const direct = pattern.panels[issue.targetId];
      if (direct) {
        invalidNames.add(direct.name);
        continue;
      }
      const owner = Object.values(pattern.panels).find(
        p => p.outlineEdgeIds.includes(issue.targetId) || (p.holes ?? []).flat().includes(issue.targetId),
      );
      invalidNames.add(owner?.name ?? issue.targetId);
    }
    throw new Error(`DXF 导入校验失败，无效版片：${[...invalidNames].join('、')}（${issues.map(i => i.message).join('；')}）`);
  }
  return pattern;
}
