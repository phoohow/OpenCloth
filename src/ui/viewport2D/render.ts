import type { Measurement, Pattern, Print, Seam, Topstitch, Trim, Vec2 } from '../../core/model/types';
import { panelGrainLine, panelOutlineWithAllowance, sampleEdge, sampleEdgeInterval, samplePanelOutline, type PanelMesh } from '../../pattern/panel/panelBuilder';
import { getPanelMesh } from '../../pattern/panel/panelMeshCache';
import type { PanelMeshSettings } from '../../pattern/panel/panelMeshSignature';
import { measurementValue, pointAtT } from '../../pattern/geom/edgeSample';
import { edgeCurve, smoothSplineSegments } from '../../pattern/geom/bezier';
import { computeBBox } from '../../pattern/geom/vec2';
import { seamJoint, sewnOutline } from '../../pattern/seam/joinBlend';
import { seamNumbers } from '../../pattern/seam/seamNumber';
import {
  gridStepCm, rulerLabel, rulerMinorTicks, rulerStepCm, rulerTicks, toScreen, toWorld,
  type ViewTransform,
} from './viewMath';
import { elementNodeId, parseElementNodeId, idsOfKind } from '../elementSelection';
import { panelFrame, printCenter, printFrame, shapeFrame, topstitchRows, trimRadiusCm, type DraftState } from './tools';
import type { SnapCandidate } from './snap';
import { elementHoverPaths, type HoverTarget, type MarkHint } from './hitTest';

const NEAR = 1e-6;

/** Coarse wireframe edge length while a drag is in flight, so the pane stays responsive. */
const WIREFRAME_DRAG_RESOLUTION_CM = 2.5;

/** Factory thread colour; a seam still carrying it is drawn with a palette hue instead. */
const DEFAULT_SEAM_THREAD = '#ff4444';

/** Hues cycled across seams so neighbouring pairs never share a colour. */
const SEAM_PALETTE = [
  '#ff6b8b', '#4da6ff', '#ffb84d', '#5fd6a6', '#b48cff',
  '#ff9a4d', '#5ad1e6', '#e07bff', '#8ad14b', '#ff7ad1',
];

/**
 * Display colour of a seam: the thread colour the user picked, or a palette hue for its display
 * order. Past the palette length the hue keeps stepping by the golden angle, so a long seam list
 * still gets distinct colours instead of repeats.
 */
function seamColor(seam: Seam, index: number): string {
  const custom = seam.threadColor?.toLowerCase();
  if (custom && custom !== DEFAULT_SEAM_THREAD) return seam.threadColor;
  const entry = SEAM_PALETTE[index];
  return entry ?? `hsl(${((index * 137.508) % 360).toFixed(0)} 70% 62%)`;
}

/** In-flight drag shown without committing to the model. */
export interface PreviewDrag {
  /** Dry-run copy of the pattern with the drag translation already applied. */
  pattern: Pattern;
  /**
   * Height offsets of `pattern` when the drag already knows them, so a frame does not resample
   * every draped panel's outline to derive them again. Absent for drags that deform geometry.
   */
  offsets?: ReadonlyMap<string, number>;
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
  /** Triangulated simulation mesh drawn over the cut pieces. */
  wireframe: boolean;
}

/** Everything one 2D frame draws. */
export interface SceneState {
  pattern: Pattern;
  /**
   * Pattern the shared mesh cache keys on, in its own coordinates; the wireframe layer shifts what
   * it returns by the panel's height offset. Defaults to `pattern`.
   */
  meshPattern?: Pattern;
  /** Centimeters each panel is raised from its pattern y to its world height. */
  offsets?: ReadonlyMap<string, number>;
  view: ViewTransform;
  /** Scene settings the shared panel mesh cache keys on; identical to what the 3D engine reads. */
  simulation: PanelMeshSettings;
  selection: string[];
  /** Element a press would pick, drawn as a pre-highlight before the press. */
  hover?: HoverTarget | null;
  /** Landing point of the mark about to be placed, drawn as a ghost. */
  markHint?: MarkHint | null;
  /** The hovered vertex is about to be deleted, so its ring turns red. */
  hoverDelete?: boolean;
  preview: PreviewDrag | null;
  /** Rubber-band box in world coordinates. */
  rect: { a: Vec2; b: Vec2 } | null;
  /** Seam marks only appear while the seam tool is active or a seam is selected. */
  showSeams: boolean;
  /** In-progress tool stroke drawn as a preview layer. */
  draft?: DraftState;
  /** Active snap marker highlighted under the cursor. */
  snapHint?: SnapCandidate | null;
  /** Where the point tool would insert a vertex, drawn as a marker on the edge. */
  insertHint?: { pos: Vec2; edgeId: string } | null;
  /** Edge under the cursor while the seam tool is armed, drawn as the side about to be picked. */
  seamHover?: { edgeId: string; t0: number; t1: number } | null;
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
    prints: true, topstitches: true, trims: true, wireframe: false,
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
    const numbers = seamNumbers(pattern);
    Object.values(pattern.seams).forEach((seam, index) => {
      if (seam.stitchVisible === false) return;
      drawSeam(ctx, pattern, seam, screen, seamColor(seam, index), numbers.get(seam.id) ?? index + 1);
    });
  }

  if (display.seamJoin) drawSeamJoints(ctx, state, screen);

  drawElementSelection(ctx, state, screen, view.scale);
  drawDraft(ctx, state, screen);
  drawSeamDraft(ctx, state, screen);
  drawInsertHint(ctx, state, screen);
  drawSnapHint(ctx, state, screen);
  drawHover(ctx, state, screen);
  drawMarkHint(ctx, state, screen);
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

  // Height 0 is the ground, the same datum the 3D pane stands the body on.
  const groundY = h / 2 - view.offsetY;
  if (groundY > RULER_BAND && groundY < h) {
    ctx.fillStyle = '#7a8194';
    ctx.font = '10px system-ui';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText('地面', RULER_BAND + 6, groundY - 3);
  }
}

/** One ruler tick line. */
function tick(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number): void {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

/** Triangle edges of a panel mesh, drawn over its filled outline. */
function drawWireframe(
  ctx: CanvasRenderingContext2D, mesh: PanelMesh, screen: (p: Vec2) => Vec2, offsetCm: number,
): void {
  const { positions2D, indices, vertexCount } = mesh;
  const sx = new Float32Array(vertexCount);
  const sy = new Float32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    const s = screen({ x: positions2D[i * 2]!, y: positions2D[i * 2 + 1]! + offsetCm });
    sx[i] = s.x;
    sy[i] = s.y;
  }
  ctx.beginPath();
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t]!, b = indices[t + 1]!, c = indices[t + 2]!;
    ctx.moveTo(sx[a]!, sy[a]!); ctx.lineTo(sx[b]!, sy[b]!);
    ctx.moveTo(sx[b]!, sy[b]!); ctx.lineTo(sx[c]!, sy[c]!);
    ctx.moveTo(sx[c]!, sy[c]!); ctx.lineTo(sx[a]!, sy[a]!);
  }
  ctx.strokeStyle = 'rgba(140,200,255,0.35)';
  ctx.lineWidth = 1;
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

  if (display.wireframe) {
    // Coarse while a drag is in flight; otherwise the panel's own edge length, which is the same
    // value the 3D cloth build resolves, so both sides draw one shared mesh instance.
    const resolutionCm = scene.preview ? WIREFRAME_DRAG_RESOLUTION_CM : panel.meshResolutionCm;
    const mesh = getPanelMesh(scene.meshPattern ?? pattern, panel.id, resolutionCm, scene.simulation);
    if (mesh) drawWireframe(ctx, mesh, screen, scene.offsets?.get(panel.id) ?? 0);
  }

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

/** One internal line in its usage colour, or highlighted with vertex markers when selected. */
function drawInternalLine(
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

/** Screen-space frame around an annotation's text, shared by hover and selection highlights. */
function drawAnnotationFrame(
  ctx: CanvasRenderingContext2D, s: Vec2, color: string, lineWidth: number,
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.strokeRect(s.x - 24, s.y - 10, 48, 16);
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
function drawSeamDraft(ctx: CanvasRenderingContext2D, scene: SceneState, screen: (p: Vec2) => Vec2): void {
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

/** Marker where the point tool would insert a vertex: a dashed ring with a plus on the edge. */
function drawInsertHint(
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
function drawSeam(
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

/** Yellow preview of the element a press would pick; panels also get a faint tint. */
function drawHover(
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
function drawMarkHint(
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
