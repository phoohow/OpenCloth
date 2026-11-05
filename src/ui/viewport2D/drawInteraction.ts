import type { Vec2 } from '@/model/types';
import { sampleEdge, samplePanelOutline } from '@/pattern/panel';
import { pointAtT } from '@/pattern/geom';
import { smoothSplineSegments } from '@/pattern/geom';
import { parseElementNodeId } from '@/model';
import { printFrame, shapeFrame, topstitchRows, trimRadiusCm } from '@/ui/viewport2D/tools';
import { elementHoverPaths } from '@/ui/viewport2D/hitTest';
import type { SnapCandidate } from '@/ui/viewport2D/snap';
import type { SceneState } from '@/ui/viewport2D/renderTypes';
import { drawSeam } from '@/ui/viewport2D/drawSeams';
import {
  drawAnnotationFrame, drawInternalLine, drawMeasurement, drawPrintOutline,
} from '@/ui/viewport2D/drawMarks';

export function drawElementSelection(
  ctx: CanvasRenderingContext2D, scene: SceneState, screen: (p: Vec2) => Vec2, scale: number,
): void {
  const { pattern } = scene;
  for (const row of scene.selection) {
    const el = parseElementNodeId(row);
    if (el?.kind === 'seam') {
      const seam = pattern.seams[el.id];
      if (seam && seam.stitchVisible !== false) drawSeam(ctx, pattern, seam, screen, '#ffd75e');
    }
    if (el?.kind === 'internal') drawInternalLine(ctx, pattern, el.id, screen, true);
    if (el?.kind === 'print') {
      const print = pattern.prints?.[el.id];
      const frame = print?.visible ? printFrame(pattern, print) : null;
      if (frame) drawPrintOutline(ctx, frame.map(screen), true);
    }
    if (el?.kind === 'topstitch') {
      const stitch = pattern.topstitches?.[el.id];
      if (stitch?.visible) {
        for (const line of topstitchRows(pattern, stitch)) {
          const s = screen(line[Math.floor(line.length / 2)] ?? line[0]!);
          ctx.save();
          ctx.strokeStyle = '#ffd75e';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(s.x, s.y, 5, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      }
    }
    if (el?.kind === 'trim') {
      const trim = pattern.trims?.[el.id];
      if (trim?.visible) {
        const s = screen(trim.pos);
        const r = Math.max(4, trimRadiusCm(trim) * scale) + 3;
        ctx.save();
        ctx.strokeStyle = '#ffd75e';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
    if (el?.kind === 'notch') {
      const notch = pattern.notches?.[el.id];
      const p = notch ? pointAtT(pattern, notch.edgeId, notch.t) : null;
      if (p) {
        const s = screen(p);
        ctx.strokeStyle = '#ffd75e';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 6, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    if (el?.kind === 'annotation') {
      const note = pattern.annotations?.[el.id];
      if (note) drawAnnotationFrame(ctx, screen(note.pos), '#ffd75e', 1.5);
    }
    if (el?.kind === 'measurement') {
      const measurement = pattern.measurements?.[el.id];
      if (measurement) drawMeasurement(ctx, pattern, measurement, screen);
    }
  }
}

export function drawDraft(
  ctx: CanvasRenderingContext2D, scene: SceneState, screen: (p: Vec2) => Vec2,
): void {
  const draft = scene.draft;
  if (!draft) return;
  ctx.save();
  ctx.strokeStyle = '#ffd75e';
  ctx.fillStyle = '#ffd75e';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  switch (draft.tool) {
    case 'pen': {
      const pts = [...draft.points, draft.cursor];
      ctx.beginPath();
      if (draft.curve) {
        // Same spline the commit builds, so the stroke reads as a curve while it is drawn.
        const head = screen(pts[0]!);
        ctx.moveTo(head.x, head.y);
        for (const segment of smoothSplineSegments(pts)) {
          const c0 = screen(segment.c0), c1 = screen(segment.c1), end = screen(segment.p1);
          ctx.bezierCurveTo(c0.x, c0.y, c1.x, c1.y, end.x, end.y);
        }
      } else {
        pts.forEach((p, i) => {
          const s = screen(p);
          if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
        });
      }
      ctx.stroke();
      for (const p of draft.points) {
        const s = screen(p);
        ctx.beginPath();
        ctx.arc(s.x, s.y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'polyline': {
      const pts = draft.mode === 'hole' ? [...draft.points, draft.cursor, ...draft.points] : [...draft.points, draft.cursor];
      ctx.beginPath();
      pts.forEach((p, i) => {
        const s = screen(p);
        if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
      });
      if (draft.mode === 'hole') ctx.closePath();
      ctx.stroke();
      for (const p of draft.points) {
        const s = screen(p);
        ctx.beginPath();
        ctx.arc(s.x, s.y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'measure': {
      const a = draft.pointAId ? scene.pattern.points[draft.pointAId]?.pos : null;
      if (a) {
        const s = screen(a);
        const c = screen(draft.cursor);
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(c.x, c.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(s.x, s.y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = '11px sans-serif';
        ctx.fillText(`${Math.hypot(draft.cursor.x - a.x, draft.cursor.y - a.y).toFixed(1)} cm`, c.x + 6, c.y - 6);
      }
      break;
    }
    case 'shape': {
      const frame = shapeFrame(draft.start, draft.current, draft.shape, false);
      const a = screen(frame.min);
      const b = screen(frame.max);
      // Screen Y runs upwards, so `min` sits below `max`: take the box from both ends, not from a to b.
      const left = Math.min(a.x, b.x), top = Math.min(a.y, b.y);
      const width = Math.abs(b.x - a.x), height = Math.abs(b.y - a.y);
      ctx.beginPath();
      if (draft.shape === 'rect') ctx.rect(left, top, width, height);
      else ctx.ellipse(left + width / 2, top + height / 2, Math.max(1, width / 2), Math.max(1, height / 2), 0, 0, Math.PI * 2);
      ctx.stroke();
      if (draft.shape === 'circle') {
        // The press point is the centre of the circle, marked so the radius drag reads clearly.
        const c = screen(draft.start);
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(c.x - 4, c.y);
        ctx.lineTo(c.x + 4, c.y);
        ctx.moveTo(c.x, c.y - 4);
        ctx.lineTo(c.x, c.y + 4);
        ctx.stroke();
      }
      break;
    }
    case 'dart': {
      // The two picked base points and the cursor tip form the dart wedge.
      const feet = [draft.leg1, draft.leg2].flatMap(leg => {
        const p = leg ? pointAtT(scene.pattern, leg.edgeId, leg.t) : null;
        return p ? [p] : [];
      });
      const tip = screen(draft.cursor);
      const legs = feet.map(foot => screen(foot));
      ctx.beginPath();
      if (legs.length > 0) {
        ctx.moveTo(legs[0]!.x, legs[0]!.y);
        for (let i = 1; i < legs.length; i++) ctx.lineTo(legs[i]!.x, legs[i]!.y);
        ctx.lineTo(tip.x, tip.y);
        ctx.closePath();
      }
      ctx.stroke();
      for (const foot of legs) {
        ctx.beginPath();
        ctx.arc(foot.x, foot.y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'seam':
      // Picked sides and their direction rings are drawn by drawSeamDraft.
      break;
    default:
      break;
  }
  ctx.restore();
}

/** Marker where the point tool would insert a vertex: a dashed ring with a plus on the edge. */
export function drawInsertHint(
  ctx: CanvasRenderingContext2D, scene: SceneState, screen: (p: Vec2) => Vec2,
): void {
  const hint = scene.insertHint;
  if (!hint) return;
  const s = screen(hint.pos);
  const radius = 8;
  ctx.save();
  ctx.strokeStyle = '#6ee7a8';
  ctx.fillStyle = 'rgba(110,231,168,0.16)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(s.x, s.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.setLineDash([3, 2]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(s.x - radius + 3, s.y); ctx.lineTo(s.x + radius - 3, s.y);
  ctx.moveTo(s.x, s.y - radius + 3); ctx.lineTo(s.x, s.y + radius - 3);
  ctx.stroke();
  ctx.fillStyle = '#6ee7a8';
  ctx.beginPath();
  ctx.arc(s.x, s.y, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawSnapHint(
  ctx: CanvasRenderingContext2D, scene: SceneState, screen: (p: Vec2) => Vec2,
): void {
  const hint = scene.snapHint;
  if (!hint) return;
  const s = screen(hint.pos);
  ctx.save();
  const colors: Record<SnapCandidate['kind'], string> = {
    endpoint: '#7fdc9a', intersection: '#ffd75e', midpoint: '#8ec7ff',
    perpendicular: '#c58aff', tangent: '#5ad1c5', extension: '#ff9d5c',
    equidistant: '#ff8fa3', grid: '#ffd75e',
  };
  ctx.strokeStyle = colors[hint.kind];
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (hint.kind === 'endpoint') ctx.rect(s.x - 4, s.y - 4, 8, 8);
  else if (hint.kind === 'intersection') { ctx.moveTo(s.x - 5, s.y - 5); ctx.lineTo(s.x + 5, s.y + 5); ctx.moveTo(s.x - 5, s.y + 5); ctx.lineTo(s.x + 5, s.y - 5); }
  else if (hint.kind === 'perpendicular') { ctx.moveTo(s.x - 6, s.y); ctx.lineTo(s.x + 6, s.y); ctx.moveTo(s.x, s.y - 6); ctx.lineTo(s.x, s.y + 6); }
  else if (hint.kind === 'tangent') { ctx.moveTo(s.x, s.y - 5); ctx.lineTo(s.x + 5, s.y); ctx.lineTo(s.x, s.y + 5); ctx.lineTo(s.x - 5, s.y); ctx.closePath(); }
  else if (hint.kind === 'extension') { ctx.moveTo(s.x - 5, s.y); ctx.lineTo(s.x, s.y - 5); ctx.lineTo(s.x + 5, s.y); ctx.closePath(); }
  else if (hint.kind === 'equidistant') { ctx.arc(s.x, s.y, 5, 0, Math.PI * 2); ctx.moveTo(s.x + 2, s.y); ctx.arc(s.x, s.y, 2, 0, Math.PI * 2); }
  else ctx.arc(s.x, s.y, 5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** Yellow preview of the element a press would pick; panels also get a faint tint. */
export function drawHover(
  ctx: CanvasRenderingContext2D, scene: SceneState, screen: (p: Vec2) => Vec2,
): void {
  const hover = scene.hover;
  if (!hover) return;
  const { pattern } = scene;
  if (hover.kind === 'element') {
    if (hover.elementKind === 'annotation') {
      const note = pattern.annotations?.[hover.id];
      if (note) drawAnnotationFrame(ctx, screen(note.pos), 'rgba(255,215,94,0.7)', 2.5);
      return;
    }
    const shape = elementHoverPaths(pattern, hover.elementKind, hover.id);
    if (shape) drawElementHover(ctx, shape, screen, scene.view.scale);
    return;
  }
  const ring = hover.kind === 'point' ? pattern.points[hover.id]?.pos
    : hover.kind === 'internalVertex' ? pattern.internalLines[hover.lineId]?.points[hover.index]
      : null;
  const path = hover.kind === 'edge' ? sampleEdge(pattern, hover.id)
    : hover.kind === 'internal' ? pattern.internalLines[hover.id]?.points ?? []
      : hover.kind === 'panel' && pattern.panels[hover.id]
        ? samplePanelOutline(pattern, pattern.panels[hover.id]!) : [];
  if (!ring && path.length < 2) return;

  ctx.save();
  ctx.strokeStyle = scene.hoverDelete && hover.kind === 'point' ? '#ff6b6b' : 'rgba(255,215,94,0.7)';
  ctx.lineWidth = ring ? 1.5 : 2.5;
  ctx.setLineDash([]);
  if (ring) {
    const s = screen(ring);
    ctx.beginPath();
    ctx.arc(s.x, s.y, 7, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    ctx.beginPath();
    path.forEach((p, i) => {
      const s = screen(p);
      if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
    });
    if (hover.kind === 'panel') {
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,215,94,0.07)';
      ctx.fill();
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** Yellow pre-highlight of one production element's sampled strokes, rings and closed frames. */
function drawElementHover(
  ctx: CanvasRenderingContext2D,
  shape: { paths: Vec2[][]; closed?: boolean; radius?: number },
  screen: (p: Vec2) => Vec2, scale: number,
): void {
  const paths = shape.paths.filter(path => path.length > 0);
  if (paths.length === 0) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(255,215,94,0.7)';
  ctx.fillStyle = 'rgba(255,215,94,0.07)';
  ctx.lineWidth = 2.5;
  ctx.setLineDash([]);
  for (const path of paths) {
    if (path.length === 1) {
      const s = screen(path[0]!);
      ctx.beginPath();
      ctx.arc(s.x, s.y, shape.radius ? Math.max(7, shape.radius * scale) : 7, 0, Math.PI * 2);
      ctx.stroke();
      continue;
    }
    ctx.beginPath();
    path.forEach((p, i) => {
      const s = screen(p);
      if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
    });
    if (shape.closed) {
      ctx.closePath();
      ctx.fill();
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** Ghost of the production mark a mark-tool press would place at the landing point. */
export function drawMarkHint(
  ctx: CanvasRenderingContext2D, scene: SceneState, screen: (p: Vec2) => Vec2,
): void {
  const hint = scene.markHint;
  if (!hint) return;
  const s = screen(hint.pos);
  ctx.save();
  ctx.strokeStyle = 'rgba(255,215,94,0.9)';
  ctx.lineWidth = 1.5;
  if (hint.kind === 'notch') {
    ctx.beginPath();
    ctx.moveTo(s.x - 4, s.y - 4); ctx.lineTo(s.x, s.y); ctx.lineTo(s.x + 4, s.y - 4);
    ctx.stroke();
  } else {
    ctx.setLineDash([3, 2]);
    ctx.beginPath();
    ctx.moveTo(s.x - 12, s.y - 8); ctx.lineTo(s.x + 12, s.y - 8);
    ctx.lineTo(s.x + 12, s.y + 8); ctx.lineTo(s.x - 12, s.y + 8);
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(s.x - 7, s.y); ctx.lineTo(s.x + 7, s.y);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawGhost(
  ctx: CanvasRenderingContext2D, scene: SceneState, screen: (p: Vec2) => Vec2,
): void {
  const ghost = scene.preview?.ghost;
  if (!ghost) return;
  const s = screen(ghost);
  ctx.save();
  ctx.strokeStyle = 'rgba(255,215,94,0.8)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(s.x, s.y, 6, 0, Math.PI * 2);
  ctx.moveTo(s.x - 10, s.y); ctx.lineTo(s.x + 10, s.y);
  ctx.moveTo(s.x, s.y - 10); ctx.lineTo(s.x, s.y + 10);
  ctx.stroke();
  ctx.restore();
}

export function drawRubberBand(
  ctx: CanvasRenderingContext2D, scene: SceneState, screen: (p: Vec2) => Vec2,
): void {
  const rect = scene.rect;
  if (!rect) return;
  const a = screen(rect.a);
  const b = screen(rect.b);
  ctx.save();
  ctx.strokeStyle = '#4da6ff';
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 4]);
  ctx.fillStyle = 'rgba(77,166,255,0.10)';
  ctx.beginPath();
  ctx.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
