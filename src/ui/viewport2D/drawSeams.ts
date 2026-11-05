import type { Pattern, Seam, Vec2 } from '@/model/types';
import { sampleEdge, sampleEdgeInterval } from '@/pattern/panel';
import { pointAtT } from '@/pattern/geom';
import { seamJoint, sewnOutline } from '@/pattern/seam';
import { idsOfKind } from '@/model';
import type { SceneState } from '@/ui/viewport2D/renderTypes';

/** Colour of the seam side already armed, and of the side under the cursor. */
const SEAM_PICK_COLOR = '#ffd75e';
const SEAM_HOVER_COLOR = '#4da6ff';

/** Strokes one edge interval, shared by the armed side, the dragged interval and the hover preview. */
function drawSeamInterval(
  ctx: CanvasRenderingContext2D, pattern: Pattern,
  pick: { edgeId: string; t0: number; t1: number },
  screen: (p: Vec2) => Vec2, color: string, width: number, dash: number[] = [],
): void {
  const pts = sampleEdgeInterval(pattern, pick.edgeId, pick.t0, pick.t1);
  if (pts.length < 2) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(dash);
  ctx.beginPath();
  pts.forEach((p, i) => {
    const s = screen(p);
    if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
  });
  ctx.stroke();
  ctx.restore();
}

/** Arc length in centimetres of one edge interval. */
function intervalLengthCm(pattern: Pattern, pick: { edgeId: string; t0: number; t1: number }): number {
  const pts = sampleEdgeInterval(pattern, pick.edgeId, pick.t0, pick.t1);
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
  }
  return total;
}

/** Arc-length middle of one edge interval, where the seam tag sits. */
function intervalMid(pattern: Pattern, pick: { edgeId: string; t0: number; t1: number }): Vec2 | null {
  return pointAtT(pattern, pick.edgeId, (pick.t0 + pick.t1) / 2);
}

/** Radius of a seam tag in pixels, and the length of the direction arrow that follows it. */
const SEAM_TAG_RADIUS = 7;
const SEAM_ARROW_LENGTH = 22;
const SEAM_ARROW_HEAD = 6;

/** Unit vector of the stitching direction along one interval, in screen space. */
function intervalDirection(
  pattern: Pattern, pick: { edgeId: string; t0: number; t1: number },
  screen: (p: Vec2) => Vec2, dir: 1 | -1,
): Vec2 | null {
  const mid = (pick.t0 + pick.t1) / 2;
  const step = Math.min((pick.t1 - pick.t0) / 4, 0.02);
  const from = pointAtT(pattern, pick.edgeId, mid);
  const to = pointAtT(pattern, pick.edgeId, mid + dir * step);
  if (!from || !to) return null;
  const a = screen(from), b = screen(to);
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 0.01) return null;
  return { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
}

/**
 * Tag at the middle of one seam side, with an arrow along the stitching direction when the
 * direction is known. The tag is drawn last so the arrow appears to leave from behind it.
 */
function drawSeamTag(
  ctx: CanvasRenderingContext2D, pattern: Pattern,
  pick: { edgeId: string; t0: number; t1: number },
  screen: (p: Vec2) => Vec2, text: string, color: string, dir: 0 | 1 | -1 = 0,
): void {
  const mid = intervalMid(pattern, pick);
  if (!mid) return;
  const s = screen(mid);
  const unit = dir === 0 ? null : intervalDirection(pattern, pick, screen, dir);

  ctx.save();
  if (unit) {
    const startX = s.x + unit.x * (SEAM_TAG_RADIUS + 1);
    const startY = s.y + unit.y * (SEAM_TAG_RADIUS + 1);
    const endX = startX + unit.x * SEAM_ARROW_LENGTH;
    const endY = startY + unit.y * SEAM_ARROW_LENGTH;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    const angle = Math.atan2(unit.y, unit.x);
    ctx.beginPath();
    for (const side of [0.78, -0.78]) {
      ctx.moveTo(endX, endY);
      ctx.lineTo(endX + Math.cos(angle + Math.PI * side) * SEAM_ARROW_HEAD, endY + Math.sin(angle + Math.PI * side) * SEAM_ARROW_HEAD);
    }
    ctx.stroke();
  }

  ctx.fillStyle = color;
  ctx.strokeStyle = '#202024';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(s.x, s.y, SEAM_TAG_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#202024';
  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, s.x, s.y);
  ctx.restore();
}

/** Ring on an interval end that can be picked as the stitching start. */
function drawSeamEndRing(ctx: CanvasRenderingContext2D, s: Vec2, color: string): void {
  ctx.save();
  ctx.fillStyle = '#202024';
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(s.x, s.y, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(s.x, s.y, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * Seam draft: each picked side with its direction, rings on the ends still to be answered, the
 * dragged interval, and the pairing link with both lengths once two sides exist.
 */
export function drawSeamDraft(
  ctx: CanvasRenderingContext2D, scene: SceneState, screen: (p: Vec2) => Vec2,
): void {
  const current = scene.draft;
  const draft = current?.tool === 'seam' ? current : null;
  const hover = scene.seamHover;
  const drag = draft?.drag ?? null;
  const last = draft?.sides[draft.sides.length - 1];
  const awaitingStart = !!last && last.startLow === undefined;

  // Highlight the side about to be picked, before a seam and between picks.
  if (hover && !drag && !awaitingStart && !draft?.sides.some(side => side.edgeId === hover.edgeId)) {
    drawSeamInterval(ctx, scene.pattern, hover, screen, SEAM_HOVER_COLOR, 3, [5, 3]);
  }
  if (!draft) return;

  if (drag) {
    const pick = {
      edgeId: drag.edgeId,
      t0: Math.min(arcT(scene.pattern, drag.edgeId, drag.start), arcT(scene.pattern, drag.edgeId, drag.current)),
      t1: Math.max(arcT(scene.pattern, drag.edgeId, drag.start), arcT(scene.pattern, drag.edgeId, drag.current)),
    };
    drawSeamInterval(ctx, scene.pattern, pick, screen, SEAM_HOVER_COLOR, 3, [6, 3]);
  }

  const sideColors = [SEAM_PICK_COLOR, SEAM_HOVER_COLOR];
  const sideTags = ['A', 'B'];
  draft.sides.forEach((side, i) => {
    const color = sideColors[Math.min(i, 1)]!;
    const tag = sideTags[Math.min(i, 1)]!;
    strokeSeamSide(ctx, scene.pattern, side, screen, color);
    if (side.startLow === undefined) {
      for (const t of [side.t0, side.t1]) {
        const p = pointAtT(scene.pattern, side.edgeId, t);
        if (p) drawSeamEndRing(ctx, screen(p), color);
      }
      drawSeamTag(ctx, scene.pattern, side, screen, tag, color);
      return;
    }
    drawSeamTag(ctx, scene.pattern, side, screen, tag, color, side.startLow ? 1 : -1);
  });

  const first = draft.sides[0];
  if (!first) return;
  const target = draft.sides[1]
    ?? (hover && hover.edgeId !== first.edgeId ? hover : null);
  const aMid = intervalMid(scene.pattern, first);
  const bMid = target ? intervalMid(scene.pattern, target) : null;
  if (!aMid || !target || !bMid) return;
  const sA = screen(aMid), sB = screen(bMid);

  ctx.save();
  ctx.strokeStyle = 'rgba(77,166,255,0.65)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(sA.x, sA.y);
  ctx.lineTo(sB.x, sB.y);
  ctx.stroke();

  // Lengths of both sides; a gap past the easing range turns the readout orange.
  const lenA = intervalLengthCm(scene.pattern, first);
  const lenB = intervalLengthCm(scene.pattern, target);
  const off = lenA > 0 ? Math.abs(lenB - lenA) / lenA : 0;
  ctx.setLineDash([]);
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = off > 0.1 ? '#ffa94d' : '#8a93a3';
  ctx.fillText(`${lenA.toFixed(1)} / ${lenB.toFixed(1)} cm`, (sA.x + sB.x) / 2 + 6, (sA.y + sB.y) / 2 - 4);
  ctx.restore();
}

/** Nearest arc-length fraction of a world position on an edge. */
function arcT(pattern: Pattern, edgeId: string, p: Vec2): number {
  const pts = sampleEdge(pattern, edgeId);
  if (pts.length < 2) return 0;
  let acc = 0;
  const total = pts.reduce((sum, q, i) => i === 0 ? sum : sum + Math.hypot(q.x - pts[i - 1].x, q.y - pts[i - 1].y), 0) || 1;
  let bestT = 0;
  let bestD = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - p.x, pts[i].y - p.y);
    if (d < bestD) { bestD = d; bestT = acc; }
    if (i + 1 < pts.length) acc += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
  }
  return bestT / total;
}

/** Spacing between the slanted dashes of a seam side, and half their tick length, in pixels. */
const SEAM_TICK_STEP = 6;
const SEAM_TICK_HALF = 3;

/** Draws one seam side as slanted dashes leaning 45° off the edge, the usual sewing mark. */
function strokeSeamSide(
  ctx: CanvasRenderingContext2D, pattern: Pattern,
  pick: { edgeId: string; t0: number; t1: number },
  screen: (p: Vec2) => Vec2, color: string,
): void {
  const pts = sampleEdgeInterval(pattern, pick.edgeId, pick.t0, pick.t1).map(p => screen(p));
  if (pts.length < 2) return;

  const lean = Math.SQRT1_2;
  const tick = (x: number, y: number, tx: number, ty: number) => {
    const nx = (tx - ty) * lean;
    const ny = (tx + ty) * lean;
    ctx.moveTo(x - nx * SEAM_TICK_HALF, y - ny * SEAM_TICK_HALF);
    ctx.lineTo(x + nx * SEAM_TICK_HALF, y + ny * SEAM_TICK_HALF);
  };

  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
  }

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2;
  ctx.setLineDash([]);
  ctx.beginPath();

  if (total < SEAM_TICK_STEP) {
    const a = pts[0]!, b = pts[pts.length - 1]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    tick((a.x + b.x) / 2, (a.y + b.y) / 2, (b.x - a.x) / len, (b.y - a.y) / len);
    ctx.stroke();
    ctx.restore();
    return;
  }

  let next = SEAM_TICK_STEP / 2;
  let travelled = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!;
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (seg < 1e-6) continue;
    const tx = (b.x - a.x) / seg;
    const ty = (b.y - a.y) / seg;
    while (next <= travelled + seg) {
      const at = (next - travelled) / seg;
      tick(a.x + (b.x - a.x) * at, a.y + (b.y - a.y) * at, tx, ty);
      next += SEAM_TICK_STEP;
    }
    travelled += seg;
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * Draws one seam as a coloured pair: both sides carry the same hue and number, plus the stitching
 * direction arrow, so pairs stay readable without a long connector across the pane.
 */
export function drawSeam(
  ctx: CanvasRenderingContext2D, pattern: Pattern, seam: Seam,
  screen: (p: Vec2) => Vec2, color: string, index?: number,
): void {
  // A highlighted seam (no number) is stroked solid so it reads over the slanted dashes.
  if (index === undefined) {
    for (const side of [seam.a, seam.b]) {
      drawSeamInterval(ctx, pattern, side, screen, color, 3);
    }
  } else {
    strokeSeamSide(ctx, pattern, seam.a, screen, color);
    strokeSeamSide(ctx, pattern, seam.b, screen, color);
  }

  ctx.save();
  drawSeamAnchors(ctx, pattern, seam, screen, color);
  ctx.restore();

  if (index === undefined) return;
  drawSeamTag(ctx, pattern, seam.a, screen, String(index), color, 1);
  drawSeamTag(ctx, pattern, seam.b, screen, String(index), color, seam.flip ? -1 : 1);
}

/** Paired ticks at each side's anchor point, joined so a mis-set anchor is visible. */
function drawSeamAnchors(
  ctx: CanvasRenderingContext2D, pattern: Pattern, seam: Seam, screen: (p: Vec2) => Vec2, color: string,
): void {
  if (seam.a.anchorT === undefined || seam.b.anchorT === undefined) return;
  const at = pointAtT(pattern, seam.a.edgeId, seam.a.anchorT);
  const bt = pointAtT(pattern, seam.b.edgeId, seam.b.anchorT);
  if (!at || !bt) return;
  const sa = screen(at), sb = screen(bt);
  ctx.setLineDash([]);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(sa.x, sa.y);
  ctx.lineTo(sb.x, sb.y);
  ctx.stroke();
  for (const s of [sa, sb]) {
    ctx.beginPath();
    ctx.arc(s.x, s.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Sewn-flat preview of each selected seam's end joints, with the join angle as a number. */
export function drawSeamJoints(ctx: CanvasRenderingContext2D, state: SceneState, screen: (p: Vec2) => Vec2): void {
  for (const seamId of idsOfKind(state.selection, 'seam')) {
    for (const end of ['start', 'end'] as const) {
      const joint = seamJoint(state.pattern, seamId, end);
      if (!joint) continue;

      ctx.strokeStyle = 'rgba(120,200,255,0.7)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      for (const [i, p] of sewnOutline(state.pattern, joint).entries()) {
        const s = screen(p);
        if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);

      const at = screen(joint.pos);
      const flush = joint.bendDeg < 0.1 && !joint.overlap;
      ctx.fillStyle = flush ? '#57c07a' : joint.overlap ? '#e0655a' : '#e0b341';
      ctx.beginPath();
      ctx.arc(at.x, at.y, 3.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = '11px system-ui';
      const note = flush ? '顺直' : joint.overlap ? `重叠 ${joint.bendDeg.toFixed(1)}°` : `弯折 ${joint.bendDeg.toFixed(1)}°`;
      ctx.fillStyle = '#dcdce6';
      ctx.fillText(`${joint.angleDeg.toFixed(1)}° ${note}`, at.x + 7, at.y - 6);
    }
  }
}
