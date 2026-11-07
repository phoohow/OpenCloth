import type { Measurement, Pattern, Print, Topstitch, Trim, Vec2 } from '@/model/types';
import { panelGrainLine, samplePanelOutline, sampleEdge } from '@/pattern/panel';
import { measurementValue, pointAtT } from '@/pattern/geom';
import { elementNodeId } from '@/model';
import { panelFrame, printCenter, printFrame, topstitchRows, trimRadiusCm } from '@/ui/viewport2D/tools';
import { imageAt } from '@/common/platform';
import { NEAR, type SceneState } from '@/ui/viewport2D/renderTypes';

/** One internal line in its usage colour, or highlighted with vertex markers when selected. */
export function drawInternalLine(
  ctx: CanvasRenderingContext2D, pattern: Pattern, lineId: string,
  screen: (p: Vec2) => Vec2, selected = false,
): void {
  const line = pattern.internalLines[lineId];
  if (!line || line.points.length < 2) return;
  const closed = Math.hypot(line.points[0].x - line.points[line.points.length - 1].x,
    line.points[0].y - line.points[line.points.length - 1].y) < NEAR;
  ctx.save();
  ctx.setLineDash(selected || line.kind === 'split' ? [] : [5, 4]);
  ctx.beginPath();
  line.points.forEach((p, i) => {
    const s = screen(p);
    if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
  });
  if (closed) ctx.closePath();
  if (selected) {
    ctx.strokeStyle = 'rgba(255,215,94,0.25)';
    ctx.lineWidth = 8;
    ctx.stroke();
  }
  ctx.strokeStyle = selected ? '#ffd75e'
    : line.kind === 'fold' ? '#8ec7ff' : line.kind === 'split' ? '#c7a5ff' : '#9aa0b0';
  ctx.lineWidth = selected ? 3 : 1.5;
  ctx.stroke();
  if (selected) {
    ctx.setLineDash([]);
    ctx.fillStyle = '#ffd75e';
    for (const p of closed ? line.points.slice(0, -1) : line.points) {
      const s = screen(p);
      ctx.beginPath();
      ctx.arc(s.x, s.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

export function drawDart(
  ctx: CanvasRenderingContext2D, _scene: SceneState, pattern: Pattern, dartId: string, screen: (p: Vec2) => Vec2,
): void {
  const dart = pattern.darts[dartId];
  if (!dart) return;
  const tip = pattern.points[dart.tipId];
  if (!tip) return;
  const ts = screen(tip.pos);
  ctx.save();
  ctx.strokeStyle = '#ffb26b';
  ctx.lineWidth = 1.5;
  for (const legId of [dart.edge1Id, dart.edge2Id]) {
    const edge = pattern.edges[legId];
    if (!edge) continue;
    for (const id of [edge.startPointId, edge.endPointId]) {
      const p = pattern.points[id];
      if (!p) continue;
      const s = screen(p.pos);
      ctx.beginPath();
      ctx.setLineDash([4, 3]);
      ctx.moveTo(s.x, s.y); ctx.lineTo(ts.x, ts.y);
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);
  ctx.fillStyle = '#ffb26b';
  ctx.beginPath();
  ctx.arc(ts.x, ts.y, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawNotch(
  ctx: CanvasRenderingContext2D, pattern: Pattern, notch: { edgeId: string; t: number; style?: string },
  screen: (p: Vec2) => Vec2,
): void {
  const p = pointAtT(pattern, notch.edgeId, notch.t);
  if (!p) return;
  const s = screen(p);
  ctx.save();
  ctx.strokeStyle = '#ffd75e';
  ctx.lineWidth = 1.5;
  if (notch.style === 'drill') {
    ctx.beginPath();
    ctx.arc(s.x, s.y, 2.5, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(s.x - 4, s.y - 4); ctx.lineTo(s.x, s.y); ctx.lineTo(s.x + 4, s.y - 4);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawGrain(
  ctx: CanvasRenderingContext2D, scene: SceneState, panelId: string, screen: (p: Vec2) => Vec2,
): void {
  const panel = scene.pattern.panels[panelId];
  if (!panel) return;
  const grain = panelGrainLine(panel, samplePanelOutline(scene.pattern, panel));
  if (!grain) return;
  const a = screen(grain[0]);
  const b = screen(grain[1]);
  ctx.save();
  ctx.strokeStyle = '#7fdc9a';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
  ctx.stroke();
  for (const [from, to] of [[a, b], [b, a]] as const) {
    const dx = to.x - from.x, dy = to.y - from.y;
    const l = Math.hypot(dx, dy) || 1;
    const ux = dx / l, uy = dy / l;
    ctx.beginPath();
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(to.x - ux * 6 - uy * 3, to.y - uy * 6 + ux * 3);
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(to.x - ux * 6 + uy * 3, to.y - uy * 6 - ux * 3);
    ctx.stroke();
  }
  ctx.restore();
}

/** Print artwork clipped to its rotated rectangle, tiled by `repeat`, plus its frame. */
export function drawPrint(
  ctx: CanvasRenderingContext2D, scene: SceneState, print: Print,
  screen: (p: Vec2) => Vec2, scale: number,
): void {
  const panel = scene.pattern.panels[print.panelId];
  if (!panel?.visible || !print.visible) return;
  const frame = printFrame(scene.pattern, print);
  const center = printCenter(scene.pattern, print);
  if (!frame || !center) return;

  const corners = frame.map(screen);
  const selected = scene.selection.includes(elementNodeId('print', print.id));
  const opacity = Math.min(1, Math.max(0, print.opacity));

  // The owning panel's bounding box, so artwork running past the outline is still attributable.
  const owner = panelFrame(scene.pattern, print.panelId);
  if (owner) {
    const a = screen(owner.min), b = screen(owner.max);
    ctx.save();
    ctx.strokeStyle = 'rgba(160,160,180,0.28)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    ctx.restore();
  }

  ctx.save();
  ctx.beginPath();
  corners.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
  ctx.clip();
  ctx.globalAlpha = opacity;

  const image = imageAt(print.imageUrl, scene.onPrintImageReady);
  if (!image) {
    ctx.fillStyle = 'rgba(140,145,170,0.22)';
    ctx.fill();
  } else {
    const cols = Math.max(1, Math.round(print.repeat.x));
    const rows = Math.max(1, Math.round(print.repeat.y));
    const cellW = print.widthCm / cols;
    const cellH = print.heightCm / rows;
    const rad = (print.angleDeg * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    // Pattern centimetres (y up) to screen pixels (y down), rotated counter-clockwise on screen.
    const a = scale * cos, b = -scale * sin, c = scale * sin, d = scale * cos;
    const s = screen(center);
    ctx.translate(s.x, s.y);
    ctx.transform(a, b, c, d, 0, 0);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        ctx.drawImage(image, -print.widthCm / 2 + col * cellW, -print.heightCm / 2 + row * cellH, cellW, cellH);
      }
    }
  }
  ctx.restore();

  drawPrintOutline(ctx, corners, selected);
}

/** Print frame; the selected state adds corner handles for scaling. */
export function drawPrintOutline(ctx: CanvasRenderingContext2D, corners: Vec2[], selected: boolean): void {
  ctx.save();
  ctx.strokeStyle = selected ? '#ffd75e' : 'rgba(140,190,255,0.8)';
  ctx.lineWidth = selected ? 2 : 1;
  ctx.setLineDash(selected ? [] : [4, 3]);
  ctx.beginPath();
  corners.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
  ctx.stroke();
  if (selected) {
    ctx.setLineDash([]);
    ctx.fillStyle = '#ffd75e';
    for (const p of corners) ctx.fillRect(p.x - 3, p.y - 3, 6, 6);
  }
  ctx.restore();
}

/** Topstitch rows drawn as dashes at the stitch length and gap of the record. */
export function drawTopstitch(
  ctx: CanvasRenderingContext2D, pattern: Pattern, stitch: Topstitch,
  screen: (p: Vec2) => Vec2, scale: number,
): void {
  const panel = pattern.panels[stitch.panelId];
  if (!panel?.visible || !stitch.visible) return;
  const rows = topstitchRows(pattern, stitch);
  if (rows.length === 0) return;
  ctx.save();
  ctx.strokeStyle = stitch.color;
  ctx.lineWidth = 1.2;
  ctx.setLineDash([Math.max(1, (stitch.stitchMm / 10) * scale), Math.max(0.5, (stitch.gapMm / 10) * scale)]);
  for (const line of rows) {
    ctx.beginPath();
    line.forEach((p, i) => {
      const s = screen(p);
      if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
    });
    ctx.stroke();
  }
  ctx.restore();
}

/** Trim symbol at its record position; the diameter follows `sizeMm`. */
export function drawTrim(
  ctx: CanvasRenderingContext2D, pattern: Pattern, trim: Trim,
  screen: (p: Vec2) => Vec2, scale: number,
): void {
  const panel = pattern.panels[trim.panelId];
  if (!panel?.visible || !trim.visible) return;
  const s = screen(trim.pos);
  const r = Math.max(2, trimRadiusCm(trim) * scale);
  ctx.save();
  ctx.strokeStyle = trim.color;
  ctx.fillStyle = trim.color;
  ctx.lineWidth = 1.2;
  if (trim.kind === 'rivet') {
    ctx.fillRect(s.x - r, s.y - r, r * 2, r * 2);
  } else {
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    if (trim.kind === 'eyelet') ctx.stroke();
    else ctx.fill();
  }
  ctx.restore();
}

/** Dimension line with its measured value; the value is read from the geometry, not stored. */
export function drawMeasurement(
  ctx: CanvasRenderingContext2D, pattern: Pattern, measurement: Measurement, screen: (p: Vec2) => Vec2,
): void {
  const a = measurement.refs.pointAId ? pattern.points[measurement.refs.pointAId]?.pos : null;
  const b = measurement.refs.pointBId ? pattern.points[measurement.refs.pointBId]?.pos : null;
  const raw = measurementValue(pattern, measurement);
  if (raw === null) return;
  const value = measurement.kind === 'angle' ? `${raw.toFixed(1)}°` : `${raw.toFixed(2)} cm`;
  ctx.save();
  ctx.strokeStyle = '#8ab4f8';
  ctx.fillStyle = '#8ab4f8';
  ctx.lineWidth = 1;
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'center';

  let mid: Vec2 | null = null;
  if (measurement.kind === 'edgeLength' && measurement.refs.edgeId) {
    const pts = sampleEdge(pattern, measurement.refs.edgeId);
    mid = pts[Math.floor(pts.length / 2)] ?? null;
    ctx.beginPath();
    pts.forEach((p, i) => {
      const s = screen(p);
      if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
    });
    ctx.stroke();
  } else if (a && b) {
    const sa = screen(a);
    const sb = screen(b);
    ctx.beginPath();
    ctx.moveTo(sa.x, sa.y);
    ctx.lineTo(sb.x, sb.y);
    ctx.stroke();
    for (const s of [sa, sb]) {
      ctx.beginPath();
      ctx.arc(s.x, s.y, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
  if (mid) {
    const s = screen(mid);
    ctx.fillText(value, s.x, s.y - 6);
  }
  ctx.restore();
}

export function drawAnnotation(
  ctx: CanvasRenderingContext2D, pos: Vec2, text: string, angleDeg: number, screen: (p: Vec2) => Vec2,
): void {
  const s = screen(pos);
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.rotate((-angleDeg * Math.PI) / 180);
  ctx.fillStyle = '#cfd3dd';
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

/** Screen-space frame around an annotation's text, shared by hover and selection highlights. */
export function drawAnnotationFrame(
  ctx: CanvasRenderingContext2D, s: Vec2, color: string, lineWidth: number,
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.strokeRect(s.x - 24, s.y - 10, 48, 16);
  ctx.restore();
}
