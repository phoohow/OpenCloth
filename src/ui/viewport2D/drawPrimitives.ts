import {
  gridStepCm, rulerLabel, rulerMinorTicks, rulerStepCm, rulerTicks, toScreen, toWorld,
  type ViewTransform,
} from '@/ui/viewport2D/viewMath';

/** Grid lines at `gridCm` plus the two origin axes. */
export function drawGrid(
  ctx: CanvasRenderingContext2D, w: number, h: number, view: ViewTransform, gridCm: number,
): void {
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
export function drawRuler(ctx: CanvasRenderingContext2D, w: number, h: number, view: ViewTransform): void {
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

/** Grid spacing in centimetres for the view; re-exported so the background layer stays local. */
export { gridStepCm };
