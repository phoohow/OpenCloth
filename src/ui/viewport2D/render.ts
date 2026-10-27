import type { Pattern, Vec2 } from '../../core/model/types';
import { sampleEdge } from '../../pattern/panel/panelBuilder';
import { computeBBox } from '../../pattern/geom/vec2';
import { toScreen, type ViewTransform } from './viewMath';

const NEAR = 1e-6;

/** In-flight drag shown without committing to the model. */
export interface PreviewDrag {
  /** Dry-run copy of the pattern with the drag translation already applied. */
  pattern: Pattern;
  /** Snapped target marker, null when snapping is off. */
  ghost: Vec2 | null;
}

/** Everything one 2D frame draws. */
export interface SceneState {
  pattern: Pattern;
  view: ViewTransform;
  selection: string[];
  hoverPointId: string | null;
  preview: PreviewDrag | null;
  /** Rubber-band box in world coordinates. */
  rect: { a: Vec2; b: Vec2 } | null;
  /** Seam links only appear while the seam tool is active or an edge is selected. */
  showSeams: boolean;
}

/** Full frame: background, grid, panels, point handles, seams, hover, ghost and rubber band. */
export function drawScene(ctx: CanvasRenderingContext2D, w: number, h: number, scene: SceneState): void {
  const state = scene.preview ? { ...scene, pattern: scene.preview.pattern } : scene;
  const { pattern, view } = state;
  const screen = (p: Vec2): Vec2 => toScreen(p, view, w, h);

  ctx.fillStyle = '#252528';
  ctx.fillRect(0, 0, w, h);

  drawGrid(ctx, w, h, view);

  for (const panel of Object.values(pattern.panels)) {
    drawPanel(ctx, state, panel.id, screen);
  }

  if (state.showSeams) {
    for (const seam of Object.values(pattern.seams)) {
      drawSeam(ctx, pattern, seam.edgeAId, seam.edgeBId, seam.flipB, screen, seam.threadColor);
    }
  }

  drawHover(ctx, state, screen);
  drawGhost(ctx, state, screen);
  drawRubberBand(ctx, state, screen);
}

function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number, view: ViewTransform): void {
  const gridCm = view.scale > 8 ? 5 : (view.scale > 3 ? 10 : 20);
  const step = gridCm * view.scale;
  ctx.strokeStyle = '#33333a';
  ctx.lineWidth = 1;
  ctx.beginPath();
  const startX = (w / 2 + view.offsetX) % step;
  const startY = (h / 2 - view.offsetY) % step;
  for (let x = startX; x < w; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
  for (let x = startX; x > 0; x -= step) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
  for (let y = startY; y < h; y += step) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
  for (let y = startY; y > 0; y -= step) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
  ctx.stroke();

  ctx.strokeStyle = '#55556a';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(w / 2 + view.offsetX, 0); ctx.lineTo(w / 2 + view.offsetX, h);
  ctx.moveTo(0, h / 2 - view.offsetY); ctx.lineTo(w, h / 2 - view.offsetY);
  ctx.stroke();
}

function drawPanel(
  ctx: CanvasRenderingContext2D, scene: SceneState, panelId: string,
  screen: (p: Vec2) => Vec2,
): void {
  const { pattern, selection } = scene;
  const panel = pattern.panels[panelId];
  if (!panel || !panel.visible) return;
  const isSelected = selection.includes(panel.id);

  const outline: Vec2[] = [];
  for (const edgeId of panel.outlineEdgeIds) {
    const pts = sampleEdge(pattern, edgeId);
    for (let i = 0; i < pts.length; i++) {
      if (i === 0 && outline.length > 0) {
        const last = outline[outline.length - 1];
        if (Math.abs(last.x - pts[i].x) < NEAR && Math.abs(last.y - pts[i].y) < NEAR) continue;
      }
      outline.push(pts[i]);
    }
  }
  if (outline.length < 2) return;

  ctx.beginPath();
  outline.forEach((p, i) => {
    const s = screen(p);
    if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
  });
  ctx.closePath();
  ctx.fillStyle = isSelected ? 'rgba(100,180,255,0.18)' : 'rgba(200,200,210,0.08)';
  ctx.fill();
  ctx.strokeStyle = isSelected ? '#4da6ff' : '#9aa0b0';
  ctx.lineWidth = isSelected ? 2.5 : 1.5;
  ctx.stroke();

  // Panel name label at the outline center
  const bbox = computeBBox(outline);
  const center = screen({ x: (bbox.min.x + bbox.max.x) / 2, y: (bbox.min.y + bbox.max.y) / 2 });
  ctx.fillStyle = isSelected ? '#4da6ff' : '#777';
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(panel.name, center.x, center.y);

  // Outline vertices; larger handles when the panel is selected
  const shown = new Set<string>();
  for (const edgeId of panel.outlineEdgeIds) {
    const edge = pattern.edges[edgeId];
    if (!edge) continue;
    for (const pointId of [edge.startPointId, edge.endPointId]) {
      if (shown.has(pointId)) continue;
      shown.add(pointId);
      const point = pattern.points[pointId];
      if (!point) continue;
      const s = screen(point.pos);
      ctx.beginPath();
      ctx.arc(s.x, s.y, isSelected ? 4 : 3, 0, Math.PI * 2);
      ctx.fillStyle = isSelected ? '#4da6ff' : '#ccc';
      ctx.fill();
    }
  }
}

function drawSeam(
  ctx: CanvasRenderingContext2D, pattern: Pattern,
  edgeAId: string, edgeBId: string, flipB: boolean,
  screen: (p: Vec2) => Vec2, color: string,
): void {
  const ptsA = sampleEdge(pattern, edgeAId);
  const ptsB = sampleEdge(pattern, edgeBId, flipB);
  if (ptsA.length === 0 || ptsB.length === 0) return;

  const midA = ptsA[Math.floor(ptsA.length / 2)];
  const midB = ptsB[Math.floor(ptsB.length / 2)];
  const sA = screen(midA), sB = screen(midB);

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 3]);
  // The paired edges get the same colour as their link.
  for (const pts of [ptsA, ptsB]) {
    ctx.beginPath();
    pts.forEach((p, i) => {
      const s = screen(p);
      if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
    });
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(sA.x, sA.y);
  ctx.lineTo(sB.x, sB.y);
  ctx.stroke();
  ctx.restore();
}

function drawHover(
  ctx: CanvasRenderingContext2D, scene: SceneState, screen: (p: Vec2) => Vec2,
): void {
  const { pattern, hoverPointId } = scene;
  if (!hoverPointId) return;
  const point = pattern.points[hoverPointId];
  if (!point) return;
  const s = screen(point.pos);
  ctx.strokeStyle = '#ffd75e';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(s.x, s.y, 7, 0, Math.PI * 2);
  ctx.stroke();
}

function drawGhost(
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

function drawRubberBand(
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
