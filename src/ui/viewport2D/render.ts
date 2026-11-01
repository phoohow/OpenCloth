import type { Measurement, Pattern, Print, Seam, Topstitch, Trim, Vec2 } from '../../core/model/types';
import { panelGrainLine, panelOutlineWithAllowance, sampleEdge, sampleEdgeInterval, samplePanelOutline } from '../../pattern/panel/panelBuilder';
import { measurementValue, pointAtT } from '../../pattern/geom/edgeSample';
import { edgeCurve } from '../../pattern/geom/bezier';
import { computeBBox } from '../../pattern/geom/vec2';
import { seamJoint, sewnOutline } from '../../pattern/seam/joinBlend';
import {
  gridStepCm, rulerLabel, rulerMinorTicks, rulerStepCm, rulerTicks, toScreen, toWorld,
  type ViewTransform,
} from './viewMath';
import { elementNodeId, parseElementNodeId, idsOfKind } from '../elementSelection';
import { panelFrame, printCenter, printFrame, shapeFrame, topstitchRows, trimRadiusCm, type DraftState } from './tools';
import type { SnapCandidate } from './snap';

const NEAR = 1e-6;

/** In-flight drag shown without committing to the model. */
export interface PreviewDrag {
  /** Dry-run copy of the pattern with the drag translation already applied. */
  pattern: Pattern;
  /** Snapped target marker, null when snapping is off. */
  ghost: Vec2 | null;
}

/** Layer switches for drafting-only visuals; toggles never rebuild geometry. */
export interface DisplayOptions {
  internal: boolean;
  darts: boolean;
  seamAllowance: boolean;
  notches: boolean;
  grain: boolean;
  annotations: boolean;
  measurements: boolean;
  gradingOverlay: boolean;
  /** Sewn-flat preview of the selected seams' end joints. */
  seamJoin: boolean;
  /** Print artwork rectangles. */
  prints: boolean;
  /** Topstitch rows. */
  topstitches: boolean;
  /** Trim symbols. */
  trims: boolean;
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
  /** In-progress tool stroke drawn as a preview layer. */
  draft?: DraftState;
  /** Active snap marker highlighted under the cursor. */
  snapHint?: SnapCandidate | null;
  display?: DisplayOptions;
  /** Extra size-chart patterns drawn faintly behind the active one. */
  gradingOutlines?: Array<{ label: string; polygons: Vec2[][] }>;
  /** Called once a print image finishes decoding; the pane repaints to drop the placeholder. */
  onPrintImageReady?: () => void;
}

/** Full frame: background, grid, panels, point handles, seams, hover, ghost and rubber band. */
export function drawScene(ctx: CanvasRenderingContext2D, w: number, h: number, scene: SceneState): void {
  const state = scene.preview ? { ...scene, pattern: scene.preview.pattern } : scene;
  const { pattern, view } = state;
  const display: DisplayOptions = state.display ?? {
    internal: true, darts: true, seamAllowance: false, notches: true, grain: true, annotations: true, measurements: true, gradingOverlay: false, seamJoin: false,
    prints: true, topstitches: true, trims: true,
  };
  const screen = (p: Vec2): Vec2 => toScreen(p, view, w, h);

  ctx.fillStyle = '#252528';
  ctx.fillRect(0, 0, w, h);

  drawGrid(ctx, w, h, view, gridStepCm(view.scale));

  if (display.gradingOverlay) {
    for (const size of state.gradingOutlines ?? []) {
      ctx.strokeStyle = 'rgba(160,160,180,0.4)';
      ctx.lineWidth = 1;
      for (const poly of size.polygons) {
        ctx.beginPath();
        poly.forEach((p, i) => {
          const s = screen(p);
          if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
        });
        ctx.closePath();
        ctx.stroke();
      }
    }
  }

  for (const panel of Object.values(pattern.panels)) {
    drawPanel(ctx, state, panel.id, screen, display);
  }

  if (display.prints) {
    for (const print of Object.values(pattern.prints ?? {})) {
      drawPrint(ctx, state, print, screen, view.scale);
    }
  }

  if (display.internal) {
    for (const panel of Object.values(pattern.panels)) {
      for (const lineId of panel.internalLineIds) {
        drawInternalLine(ctx, pattern, lineId, screen);
      }
    }
  }
  if (display.darts) {
    for (const panel of Object.values(pattern.panels)) {
      for (const dartId of panel.dartIds) {
        drawDart(ctx, state, pattern, dartId, screen);
      }
    }
  }
  if (display.notches) {
    for (const notch of Object.values(pattern.notches ?? {})) {
      drawNotch(ctx, pattern, notch, screen);
    }
  }
  if (display.grain) {
    for (const panel of Object.values(pattern.panels)) {
      drawGrain(ctx, state, panel.id, screen);
    }
  }
  if (display.topstitches) {
    for (const stitch of Object.values(pattern.topstitches ?? {})) {
      drawTopstitch(ctx, pattern, stitch, screen, view.scale);
    }
  }
  if (display.trims) {
    for (const trim of Object.values(pattern.trims ?? {})) {
      drawTrim(ctx, pattern, trim, screen, view.scale);
    }
  }
  if (display.annotations) {
    for (const note of Object.values(pattern.annotations ?? {})) {
      drawAnnotation(ctx, note.pos, note.text, note.angleDeg ?? 0, screen);
    }
  }
  if (display.measurements) {
    for (const measurement of Object.values(pattern.measurements ?? {})) {
      drawMeasurement(ctx, pattern, measurement, screen);
    }
  }

  if (state.showSeams) {
    for (const seam of Object.values(pattern.seams)) {
      if (seam.stitchVisible === false) continue;
      drawSeam(ctx, pattern, seam, screen, seam.threadColor);
    }
  }

  if (display.seamJoin) drawSeamJoints(ctx, state, screen);

  drawElementSelection(ctx, state, screen, view.scale);
  drawDraft(ctx, state, screen);
  drawSnapHint(ctx, state, screen);
  drawHover(ctx, state, screen);
  drawGhost(ctx, state, screen);
  drawRubberBand(ctx, state, screen);
  drawRuler(ctx, w, h, view);
}

/** Grid lines at `gridCm` plus the two origin axes. */
function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number, view: ViewTransform, gridCm: number): void {
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

/** Pixel width of the ruler bands along the top and left canvas edges. */
const RULER_BAND = 18;

/** Tick lengths measured inward from the band edge; the labels fill the space left before them. */
const RULER_MAJOR_TICK = 7;
const RULER_MINOR_TICK = 4;

/** Ruler bands along the canvas edges, graduated in pattern centimetres. */
function drawRuler(ctx: CanvasRenderingContext2D, w: number, h: number, view: ViewTransform): void {
  const stepCm = rulerStepCm(view.scale);
  const left = toWorld({ x: RULER_BAND, y: 0 }, view, w, h);
  const right = toWorld({ x: w, y: 0 }, view, w, h);
  const top = toWorld({ x: 0, y: RULER_BAND }, view, w, h);
  const bottom = toWorld({ x: 0, y: h }, view, w, h);

  ctx.fillStyle = '#2b2b31';
  ctx.fillRect(0, 0, w, RULER_BAND);
  ctx.fillRect(0, 0, RULER_BAND, h);

  ctx.font = '9px sans-serif';
  ctx.fillStyle = '#98a1b3';
  ctx.strokeStyle = '#98a1b3';
  ctx.lineWidth = 1;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  // Value labels sit above their tick, resting on the line just below them.
  const labelBaseline = RULER_BAND - RULER_MAJOR_TICK - 2;
  for (const x of rulerTicks(left.x, right.x, stepCm)) {
    const sx = Math.round(toScreen({ x, y: 0 }, view, w, h).x) + 0.5;
    if (sx < RULER_BAND + 2) continue;
    tick(ctx, sx, RULER_BAND, sx, RULER_BAND - RULER_MAJOR_TICK);
    const label = rulerLabel(x, stepCm);
    // Skip a label the corner square would bite into.
    if (sx - ctx.measureText(label).width / 2 >= RULER_BAND) ctx.fillText(label, sx, labelBaseline);
  }
  for (const x of rulerMinorTicks(left.x, right.x, stepCm)) {
    const sx = Math.round(toScreen({ x, y: 0 }, view, w, h).x) + 0.5;
    if (sx < RULER_BAND + 2) continue;
    tick(ctx, sx, RULER_BAND, sx, RULER_BAND - RULER_MINOR_TICK);
  }

  for (const y of rulerTicks(bottom.y, top.y, stepCm)) {
    const sy = Math.round(toScreen({ x: 0, y }, view, w, h).y) + 0.5;
    if (sy < RULER_BAND + 2) continue;
    tick(ctx, RULER_BAND, sy, RULER_BAND - RULER_MAJOR_TICK, sy);
    const label = rulerLabel(y, stepCm);
    if (sy - ctx.measureText(label).width / 2 < RULER_BAND) continue;
    // Rotated to read upwards and centred on the tick, left of it inside the band.
    ctx.save();
    ctx.translate(9, sy);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(label, 0, 0);
    ctx.restore();
  }
  for (const y of rulerMinorTicks(bottom.y, top.y, stepCm)) {
    const sy = Math.round(toScreen({ x: 0, y }, view, w, h).y) + 0.5;
    if (sy < RULER_BAND + 2) continue;
    tick(ctx, RULER_BAND, sy, RULER_BAND - RULER_MINOR_TICK, sy);
  }

  ctx.strokeStyle = '#3a3a42';
  ctx.beginPath();
  ctx.moveTo(0, RULER_BAND + 0.5); ctx.lineTo(w, RULER_BAND + 0.5);
  ctx.moveTo(RULER_BAND + 0.5, 0); ctx.lineTo(RULER_BAND + 0.5, h);
  ctx.stroke();
  ctx.fillStyle = '#2b2b31';
  ctx.fillRect(0, 0, RULER_BAND, RULER_BAND);
}

/** One ruler tick line. */
function tick(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number): void {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function drawPanel(
  ctx: CanvasRenderingContext2D, scene: SceneState, panelId: string,
  screen: (p: Vec2) => Vec2, display: DisplayOptions,
): void {
  const { pattern, selection } = scene;
  const panel = pattern.panels[panelId];
  if (!panel || !panel.visible) return;
  const selectedEdges = new Set(idsOfKind(selection, 'edge'));
  const selectedPoints = new Set(idsOfKind(selection, 'point'));
  const isSelected = selection.includes(panel.id) || scene.gradingOutlines === undefined
    && ([...selectedEdges].some(id => panel.outlineEdgeIds.includes(id))
      || [...selectedPoints].some(id => panel.outlineEdgeIds.some(eid => {
        const e = pattern.edges[eid];
        return e && (e.startPointId === id || e.endPointId === id);
      })));

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

  // 毛边: the cutting outline the offset kernel produces, corner joins and per-edge amounts included.
  if (display.seamAllowance && (panel.seamAllowanceCm > 0 || panel.outlineEdgeIds.some(id => pattern.edges[id]?.seamAllowanceCm !== undefined))) {
    const rough = panelOutlineWithAllowance(pattern, panel);
    if (rough.length >= 3) {
      ctx.save();
      ctx.strokeStyle = 'rgba(190,150,90,0.9)';
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      rough.forEach((p, i) => {
        const s = screen(p);
        if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
      });
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }
  }

  for (const loop of panel.holes ?? []) {
    ctx.beginPath();
    let first = true;
    for (const edgeId of loop) {
      for (const p of sampleEdge(pattern, edgeId)) {
        const s = screen(p);
        if (first) { ctx.moveTo(s.x, s.y); first = false; } else ctx.lineTo(s.x, s.y);
      }
    }
    ctx.closePath();
    ctx.strokeStyle = '#9aa0b0';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // Per-edge highlight while edges are selectable.
  if (selectedEdges.size > 0 || scene.draft?.tool === 'seam') {
    ctx.save();
    ctx.lineWidth = 4;
    for (const edgeId of panel.outlineEdgeIds) {
      if (!selectedEdges.has(edgeId)) continue;
      ctx.strokeStyle = '#ffd75e';
      ctx.beginPath();
      sampleEdge(pattern, edgeId).forEach((p, i) => {
        const s = screen(p);
        if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
      });
      ctx.stroke();
    }
    ctx.restore();
  }

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
      const picked = selectedPoints.has(pointId);
      ctx.beginPath();
      ctx.arc(s.x, s.y, picked ? 5 : isSelected ? 4 : 3, 0, Math.PI * 2);
      ctx.fillStyle = picked ? '#ffd75e' : isSelected ? '#4da6ff' : '#ccc';
      ctx.fill();
    }
  }

  // Curve handles of picked points, editable in the select tool.
  if (isSelected || selectedPoints.size > 0) {
    for (const edgeId of panel.outlineEdgeIds) {
      const edge = pattern.edges[edgeId];
      if (!edge) continue;
      const curve = edgeCurve(pattern, edge);
      if (!curve) continue;
      const showStart = selectedPoints.has(edge.startPointId) || isSelected;
      const showEnd = selectedPoints.has(edge.endPointId) || isSelected;
      for (const [show, handle, anchor] of [
        [showStart, curve.c0, curve.p0], [showEnd, curve.c1, curve.p1],
      ] as const) {
        if (!show) continue;
        const hs = screen(handle);
        const as = screen(anchor);
        ctx.strokeStyle = 'rgba(255,215,94,0.6)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(as.x, as.y); ctx.lineTo(hs.x, hs.y);
        ctx.stroke();
        ctx.fillStyle = '#ffd75e';
        ctx.beginPath();
        ctx.rect(hs.x - 3, hs.y - 3, 6, 6);
        ctx.fill();
      }
    }
  }
}

function drawInternalLine(
  ctx: CanvasRenderingContext2D, pattern: Pattern, lineId: string, screen: (p: Vec2) => Vec2,
): void {
  const line = pattern.internalLines[lineId];
  if (!line || line.points.length < 2) return;
  const closed = Math.hypot(line.points[0].x - line.points[line.points.length - 1].x,
    line.points[0].y - line.points[line.points.length - 1].y) < NEAR;
  ctx.save();
  ctx.strokeStyle = line.kind === 'fold' ? '#8ec7ff' : line.kind === 'split' ? '#c7a5ff' : '#9aa0b0';
  ctx.lineWidth = 1.5;
  if (line.kind !== 'split') ctx.setLineDash([5, 4]);
  ctx.beginPath();
  line.points.forEach((p, i) => {
    const s = screen(p);
    if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
  });
  if (closed) ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

function drawDart(
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

function drawNotch(
  ctx: CanvasRenderingContext2D, pattern: Pattern, notch: { edgeId: string; t: number; style?: string },
  screen: (p: Vec2) => Vec2,
): void {
  const pts = sampleEdge(pattern, notch.edgeId);
  if (pts.length < 2) return;
  const idx = Math.min(pts.length - 1, Math.max(0, Math.round(notch.t * (pts.length - 1))));
  const p = pts[idx];
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

function drawGrain(
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



/** Decoded print artworks, keyed by their data URL. */
const printImageCache = new Map<string, HTMLImageElement>();
const printImageLoading = new Set<string>();
const printImageFailed = new Set<string>();

/** Decoded image for a data URL; starts the decode on first use and reports completion once. */
function loadPrintImage(url: string, onReady?: () => void): HTMLImageElement | null {
  if (!url || printImageFailed.has(url)) return null;
  const cached = printImageCache.get(url);
  if (cached) return cached.complete ? cached : null;
  if (printImageLoading.has(url)) return null;
  printImageLoading.add(url);
  const image = new Image();
  image.onload = () => {
    printImageCache.set(url, image);
    printImageLoading.delete(url);
    onReady?.();
  };
  image.onerror = () => {
    printImageLoading.delete(url);
    printImageFailed.add(url);
    onReady?.();
  };
  image.src = url;
  return null;
}

/** Print artwork clipped to its rotated rectangle, tiled by `repeat`, plus its frame. */
function drawPrint(
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

  const image = loadPrintImage(print.imageUrl, scene.onPrintImageReady);
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
function drawPrintOutline(ctx: CanvasRenderingContext2D, corners: Vec2[], selected: boolean): void {
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
function drawTopstitch(
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
function drawTrim(
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
function drawMeasurement(
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

function drawAnnotation(
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

function drawElementSelection(
  ctx: CanvasRenderingContext2D, scene: SceneState, screen: (p: Vec2) => Vec2, scale: number,
): void {
  const { pattern } = scene;
  for (const row of scene.selection) {
    const el = parseElementNodeId(row);
    if (el?.kind === 'seam') {
      const seam = pattern.seams[el.id];
      if (seam && seam.stitchVisible !== false) drawSeam(ctx, pattern, seam, screen, '#ffd75e');
    }
    if (el?.kind === 'internal') drawInternalLine(ctx, pattern, el.id, screen);
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
      if (note) {
        const s = screen(note.pos);
        ctx.strokeStyle = '#ffd75e';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(s.x - 24, s.y - 10, 48, 16);
      }
    }
    if (el?.kind === 'measurement') {
      const measurement = pattern.measurements?.[el.id];
      if (measurement) drawMeasurement(ctx, pattern, measurement, screen);
    }
  }
}

function drawDraft(
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
      pts.forEach((p, i) => {
        const s = screen(p);
        if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
      });
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
      ctx.beginPath();
      if (draft.shape === 'rect') ctx.rect(a.x, a.y, b.x - a.x, b.y - a.y);
      else ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.max(1, (b.x - a.x) / 2), Math.max(1, (b.y - a.y) / 2), 0, 0, Math.PI * 2);
      ctx.stroke();
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
    case 'seam': {
      const highlighted = [draft.pickA, draft.drag ? { edgeId: draft.drag.edgeId, t0: Math.min(arcT(scene.pattern, draft.drag.edgeId, draft.drag.start), arcT(scene.pattern, draft.drag.edgeId, draft.drag.current)), t1: Math.max(arcT(scene.pattern, draft.drag.edgeId, draft.drag.start), arcT(scene.pattern, draft.drag.edgeId, draft.drag.current)) } : null]
        .flatMap(pick => (pick ? [pick] : []));
      ctx.setLineDash([]);
      ctx.lineWidth = 4;
      for (const pick of highlighted) {
        const pts = sampleEdgeInterval(scene.pattern, pick.edgeId, pick.t0, pick.t1);
        ctx.beginPath();
        pts.forEach((p, i) => {
          const s = screen(p);
          if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
        });
        ctx.stroke();
      }
      break;
    }
    default:
      break;
  }
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

function drawSnapHint(
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

function drawSeam(
  ctx: CanvasRenderingContext2D, pattern: Pattern, seam: Seam,
  screen: (p: Vec2) => Vec2, color: string,
): void {
  const ptsA = sampleEdgeInterval(pattern, seam.a.edgeId, seam.a.t0, seam.a.t1);
  const ptsB = sampleEdgeInterval(pattern, seam.b.edgeId, seam.b.t0, seam.b.t1, seam.flip);
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
  drawSeamAnchors(ctx, pattern, seam, screen);
  ctx.restore();
}

/** Paired ticks at each side's anchor point, joined so a mis-set anchor is visible. */
function drawSeamAnchors(
  ctx: CanvasRenderingContext2D, pattern: Pattern, seam: Seam, screen: (p: Vec2) => Vec2,
): void {
  if (seam.a.anchorT === undefined || seam.b.anchorT === undefined) return;
  const at = pointAtT(pattern, seam.a.edgeId, seam.a.anchorT);
  const bt = pointAtT(pattern, seam.b.edgeId, seam.b.anchorT);
  if (!at || !bt) return;
  const sa = screen(at), sb = screen(bt);
  ctx.setLineDash([]);
  ctx.strokeStyle = '#ffd75e';
  ctx.fillStyle = '#ffd75e';
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

/** Sewn-flat preview of each selected seam's end joints, with the join angle as a number. */
function drawSeamJoints(ctx: CanvasRenderingContext2D, state: SceneState, screen: (p: Vec2) => Vec2): void {
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
