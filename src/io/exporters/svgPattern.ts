import type { Pattern, Vec2 } from '@/model/types';
import { panelGrainLine, panelOutlineWithAllowance, sampleOutline, samplePanelOutline } from '@/pattern/panel';
import { computeBBox } from '@/common/geom';
import { pointAtT, sampleEdge } from '@/pattern/geom';
import {
  buildMarkerLayout, placePoint, placedLabel, placedOutline,
  type MarkerLayoutOptions,
} from '@/pattern/marker';

/** Options for `exportPatternSvg`. */
export interface SvgPatternOptions {
  /** Draw each panel's offset cutting outline on the seam-allowance layer. */
  includeSeamAllowance?: boolean;
}

/** Options for `exportMarkerSvg`. */
export type MarkerSvgOptions = MarkerLayoutOptions;

/** Margin kept around the drawing, in centimetres. */
const PAD_CM = 2;

/** Canvas bounds that map pattern centimetres (Y-up) to SVG centimetres (Y-down). */
interface View { minX: number; maxY: number; width: number; height: number; }

function makeView(points: Vec2[]): View {
  if (points.length === 0) return { minX: 0, maxY: 0, width: PAD_CM * 2, height: PAD_CM * 2 };
  const bbox = computeBBox(points);
  return {
    minX: bbox.min.x,
    maxY: bbox.max.y,
    width: bbox.max.x - bbox.min.x + PAD_CM * 2,
    height: bbox.max.y - bbox.min.y + PAD_CM * 2,
  };
}

/** Flips one Y-up centimetre point into Y-down canvas coordinates. */
function toSvg(view: View, p: Vec2): Vec2 {
  return { x: p.x - view.minX + PAD_CM, y: view.maxY - p.y + PAD_CM };
}

/** Coordinate text rounded to 0.01cm; minus zero normalized. */
function num(n: number): string {
  const r = Math.round(n * 100) / 100;
  return String(Object.is(r, -0) ? 0 : r);
}

/** Escapes characters that are illegal in SVG text and attributes. */
function esc(s: string): string {
  const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
  return s.replace(/[&<>"']/g, c => entities[c] ?? c);
}

function pointsAttr(view: View, pts: Vec2[]): string {
  return pts.map(p => { const s = toSvg(view, p); return `${num(s.x)},${num(s.y)}`; }).join(' ');
}

function polygon(view: View, pts: Vec2[], attrs = ''): string {
  return `<polygon points="${pointsAttr(view, pts)}"${attrs}/>`;
}

function polyline(view: View, pts: Vec2[], attrs = ''): string {
  return `<polyline points="${pointsAttr(view, pts)}"${attrs}/>`;
}

function line(view: View, a: Vec2, b: Vec2, attrs = ''): string {
  const s = toSvg(view, a);
  const t = toSvg(view, b);
  return `<line x1="${num(s.x)}" y1="${num(s.y)}" x2="${num(t.x)}" y2="${num(t.y)}"${attrs}/>`;
}

function circle(view: View, c: Vec2, r: number, attrs = ''): string {
  const s = toSvg(view, c);
  return `<circle cx="${num(s.x)}" cy="${num(s.y)}" r="${num(r)}"${attrs}/>`;
}

/** Upright text at a pattern point; rotation cancels the Y flip. */
function textElement(view: View, p: Vec2, sizeCm: number, content: string, angleDeg = 0): string {
  const s = toSvg(view, p);
  if (!angleDeg) {
    return `<text x="${num(s.x)}" y="${num(s.y)}" font-size="${num(sizeCm)}" text-anchor="middle">${esc(content)}</text>`;
  }
  return `<text x="0" y="0" font-size="${num(sizeCm)}" text-anchor="middle" transform="translate(${num(s.x)} ${num(s.y)}) rotate(${num(-angleDeg)})">${esc(content)}</text>`;
}

/** One named layer; emitted as a `<g>` when it holds content. */
interface Layer { id: string; attrs: string; content: string[]; }

function layer(id: string, attrs: string): Layer {
  return { id, attrs, content: [] };
}

function renderLayers(view: View, title: string, layers: Layer[]): string {
  const body = layers
    .filter(l => l.content.length > 0)
    .map(l => `<g id="${l.id}" ${l.attrs}>\n${l.content.join('\n')}\n</g>`)
    .join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${num(view.width)}cm" height="${num(view.height)}cm" viewBox="0 0 ${num(view.width)} ${num(view.height)}">\n`
    + `<title>${esc(title)}</title>\n<rect width="100%" height="100%" fill="#ffffff"/>\n${body}\n</svg>\n`;
}

/** Inward unit normal at a sampled edge point; outlines run CCW so the right-hand normal faces outward. */
function edgeFrame(pattern: Pattern, edgeId: string, t: number): { p: Vec2; nx: number; ny: number } | null {
  const pts = sampleEdge(pattern, edgeId);
  const p = pointAtT(pattern, edgeId, t);
  if (pts.length < 2 || !p) return null;
  const idx = Math.min(pts.length - 1, Math.max(0, Math.round(t * (pts.length - 1))));
  const prev = pts[Math.max(0, idx - 1)];
  const next = pts[Math.min(pts.length - 1, idx + 1)];
  let tx = next.x - prev.x;
  let ty = next.y - prev.y;
  const len = Math.hypot(tx, ty) || 1;
  tx /= len;
  ty /= len;
  return { p, nx: ty, ny: -tx };
}

/** Renders the whole pattern as a standalone centimetre SVG: outlines, optional seam allowance, holes, internal lines, darts, notches, grainlines and annotations, one `<g>` per layer. */
export function exportPatternSvg(pattern: Pattern, options: SvgPatternOptions = {}): string {
  const panels = Object.values(pattern.panels);
  const outlines = new Map<string, Vec2[]>();
  const samples: Vec2[] = [];
  for (const panel of panels) {
    const pts = samplePanelOutline(pattern, panel);
    if (pts.length < 3) continue;
    outlines.set(panel.id, pts);
    samples.push(...pts);
  }

  const allowances = new Map<string, Vec2[]>();
  if (options.includeSeamAllowance) {
    for (const panelId of outlines.keys()) {
      const panel = pattern.panels[panelId];
      if (!panel) continue;
      const cut = panelOutlineWithAllowance(pattern, panel);
      if (cut.length >= 3) {
        allowances.set(panelId, cut);
        samples.push(...cut);
      }
    }
  }

  for (const lineEntry of Object.values(pattern.internalLines)) samples.push(...lineEntry.points);
  for (const dart of Object.values(pattern.darts)) {
    const tip = pattern.points[dart.tipId];
    if (tip) samples.push(tip.pos);
  }
  for (const annotation of Object.values(pattern.annotations)) samples.push(annotation.pos);

  const view = makeView(samples);
  const lOutlines = layer('outlines', 'fill="none" stroke="#1f1f28" stroke-width="0.25"');
  const lAllowance = layer('seam-allowance', 'fill="none" stroke="#8a5cf0" stroke-width="0.15" stroke-dasharray="1.5 1"');
  const lHoles = layer('holes', 'fill="none" stroke="#1f1f28" stroke-width="0.2"');
  const lInternal = layer('internal-lines', 'fill="none" stroke="#2f6fd0" stroke-width="0.15"');
  const lDarts = layer('darts', 'fill="none" stroke="#d9822b" stroke-width="0.15"');
  const lNotches = layer('notches', 'fill="none" stroke="#c8a400" stroke-width="0.15"');
  const lGrain = layer('grain-lines', 'fill="none" stroke="#2f9e5f" stroke-width="0.15"');
  const lAnno = layer('annotations', 'fill="#333333" stroke="none"');

  for (const panel of panels) {
    const pts = outlines.get(panel.id);
    if (pts) lOutlines.content.push(`<g data-panel-id="${esc(panel.id)}">\n${polygon(view, pts)}\n</g>`);
    const allow = allowances.get(panel.id);
    if (allow) lAllowance.content.push(polygon(view, allow));

    for (const loop of panel.holes ?? []) {
      const hole = sampleOutline(pattern, loop);
      if (hole.length >= 3) lHoles.content.push(polygon(view, hole));
    }

    for (const id of panel.internalLineIds) {
      const entry = pattern.internalLines[id];
      if (!entry || entry.points.length < 2) continue;
      const dash = entry.kind === 'fold' ? ' stroke-dasharray="1.5 1"' : entry.kind === 'split' ? ' stroke-dasharray="0.8 0.6"' : '';
      lInternal.content.push(polyline(view, entry.points, dash));
    }

    for (const id of panel.dartIds) {
      const dart = pattern.darts[id];
      const tip = dart && pattern.points[dart.tipId];
      if (!dart || !tip) continue;
      for (const legId of [dart.edge1Id, dart.edge2Id]) {
        const edge = pattern.edges[legId];
        if (!edge) continue;
        for (const pointId of [edge.startPointId, edge.endPointId]) {
          const p = pattern.points[pointId];
          if (p) lDarts.content.push(line(view, p.pos, tip.pos, ' stroke-dasharray="1.2 0.8"'));
        }
      }
      lDarts.content.push(circle(view, tip.pos, 0.15, ' fill="#d9822b" stroke="none"'));
    }

    const grain = panelGrainLine(panel, outlines.get(panel.id) ?? []);
    if (grain) {
      const [a, b] = grain;
      const ul = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const dx = (b.x - a.x) / ul;
      const dy = (b.y - a.y) / ul;
      lGrain.content.push(line(view, a, b));
      const head = 0.8;
      const half = 0.35;
      for (const [end, hx, hy] of [[a, dx, dy], [b, -dx, -dy]] as const) {
        // Arrow barbs: the unit normal of the grain direction folded back at each end.
        const px = -dy;
        const py = dx;
        lGrain.content.push(line(view, end, { x: end.x + hx * head + px * half, y: end.y + hy * head + py * half }));
        lGrain.content.push(line(view, end, { x: end.x + hx * head - px * half, y: end.y + hy * head - py * half }));
      }
    }
  }

  for (const notch of Object.values(pattern.notches)) {
    const frame = edgeFrame(pattern, notch.edgeId, notch.t);
    if (!frame) continue;
    if (notch.style === 'drill') {
      const r = Math.max(0.05, (notch.widthMm ?? 3) / 20);
      const c = { x: frame.p.x - frame.nx * (r + 0.3), y: frame.p.y - frame.ny * (r + 0.3) };
      lNotches.content.push(circle(view, c, r));
    } else {
      const inner = { x: frame.p.x - frame.nx * 0.6, y: frame.p.y - frame.ny * 0.6 };
      lNotches.content.push(line(view, frame.p, inner));
      if (notch.style === 't') {
        const px = -frame.ny;
        const py = frame.nx;
        lNotches.content.push(line(view,
          { x: inner.x - px * 0.3, y: inner.y - py * 0.3 },
          { x: inner.x + px * 0.3, y: inner.y + py * 0.3 }));
      }
    }
  }

  for (const annotation of Object.values(pattern.annotations)) {
    const sizeCm = Math.max(0.35, (annotation.sizeMm ?? 10) / 10);
    lAnno.content.push(textElement(view, annotation.pos, sizeCm, annotation.text, annotation.angleDeg ?? 0));
  }

  return renderLayers(view, '版型平面图', [lOutlines, lAllowance, lHoles, lInternal, lDarts, lNotches, lGrain, lAnno]);
}

/** Packs the visible panels' cutting outlines onto the fabric roll and renders the marker as a standalone centimetre SVG, each placement labelled with its panel name. */
export function exportMarkerSvg(pattern: Pattern, options: MarkerSvgOptions = {}): string {
  const layout = buildMarkerLayout(pattern, options);

  const view = makeView([{ x: 0, y: 0 }, { x: layout.fabricWidthCm, y: layout.usedLengthCm }]);
  const lFabric = layer('fabric', 'fill="none" stroke="#1f1f28" stroke-width="0.2"');
  lFabric.content.push(polygon(view, [
    { x: 0, y: 0 }, { x: layout.fabricWidthCm, y: 0 },
    { x: layout.fabricWidthCm, y: layout.usedLengthCm }, { x: 0, y: layout.usedLengthCm },
  ]));
  const lPieces = layer('pieces', 'fill="none" stroke="#33507a" stroke-width="0.18"');
  const lGrain = layer('grain-lines', 'fill="none" stroke="#2f9e5f" stroke-width="0.15"');
  const lLabels = layer('labels', 'fill="#333333" stroke="none"');

  for (const entry of layout.placements) {
    lPieces.content.push(`<g data-panel-id="${esc(entry.piece.panelId)}">\n${polygon(view, placedOutline(entry))}\n</g>`);
    if (entry.piece.grain) lGrain.content.push(polyline(view, entry.piece.grain.map(p => placePoint(entry.piece, entry.place, p))));
    lLabels.content.push(textElement(view, placedLabel(entry), 1, entry.piece.name));
  }

  return renderLayers(view,
    `排料图 幅宽${num(layout.fabricWidthCm)}cm 用料${num(layout.usedLengthCm)}cm 利用率${num(layout.utilization * 100)}%`,
    [lFabric, lPieces, lGrain, lLabels]);
}
