import * as THREE from 'three/webgpu';
import type { FabricAppearance, Pattern, Print, Vec2 } from '@/model/types';
import { computeBBox } from '@/common/geom';
import { samplePanelOutline } from '@/pattern/panel';
import { imageAt } from '@/render/imageStore';

/** Longest canvas side of a composed panel texture, in pixels. */
const COMPOSITE_MAX_SIDE = 1024;
/** Shortest canvas side of a composed panel texture, in pixels. */
const COMPOSITE_MIN_SIDE = 64;
/** Tiles drawn per axis, so an extreme fabric tiling cannot stall a repaint. */
const MAX_MAP_TILES = 32;

/** Placement of one print rectangle in a panel's normalised UV square. */
export interface PrintPlacement {
  /** Rectangle centre, u right and v up, in 0..1. */
  center: Vec2;
  /** Rectangle size as a fraction of the panel's UV box. */
  width: number;
  height: number;
  angleDeg: number;
  opacity: number;
  repeat: Vec2;
  imageUrl: string;
}

/** Panel bounds a print mapping reads: the print origin and the box the UVs normalise over. */
export interface PanelPrintFrame {
  /** Outline bounding-box centre; `Print.center` offsets from here. */
  center: Vec2;
  /** Mesh bounding box the panel UVs normalise over. */
  min: Vec2;
  max: Vec2;
}

/** Composed panel texture plus the means to repaint it when appearance or prints change. */
export interface CompositeTextureHandle {
  readonly texture: THREE.CanvasTexture;
  /** Repaints the canvas and flags the texture for upload. */
  redraw(app: FabricAppearance, placements: PrintPlacement[]): void;
  dispose(): void;
}

/** Panel frame for print mapping; null when the panel has no outline or mesh. */
export function panelPrintFrame(pattern: Pattern, panelId: string, positions2D: Float32Array): PanelPrintFrame | null {
  const panel = pattern.panels[panelId];
  if (!panel || positions2D.length < 6) return null;
  const outline = samplePanelOutline(pattern, panel);
  if (outline.length < 3) return null;
  const outlineBox = computeBBox(outline);
  const min = { x: Infinity, y: Infinity };
  const max = { x: -Infinity, y: -Infinity };
  for (let i = 0; i < positions2D.length; i += 2) {
    min.x = Math.min(min.x, positions2D[i]);
    min.y = Math.min(min.y, positions2D[i + 1]);
    max.x = Math.max(max.x, positions2D[i]);
    max.y = Math.max(max.y, positions2D[i + 1]);
  }
  if (!Number.isFinite(min.x) || !Number.isFinite(min.y)) return null;
  return {
    center: { x: (outlineBox.min.x + outlineBox.max.x) / 2, y: (outlineBox.min.y + outlineBox.max.y) / 2 },
    min,
    max,
  };
}

/** Places one print rectangle into the panel UV square the mesh samples. */
export function printPlacement(print: Print, frame: PanelPrintFrame): PrintPlacement {
  const w = frame.max.x - frame.min.x || 1;
  const h = frame.max.y - frame.min.y || 1;
  const center = { x: frame.center.x + print.center.x, y: frame.center.y + print.center.y };
  return {
    center: { x: (center.x - frame.min.x) / w, y: (center.y - frame.min.y) / h },
    width: print.widthCm / w,
    height: print.heightCm / h,
    angleDeg: print.angleDeg,
    opacity: Math.min(1, Math.max(0, print.opacity)),
    repeat: { x: Math.max(1, print.repeat.x), y: Math.max(1, print.repeat.y) },
    imageUrl: print.imageUrl,
  };
}

/** Creates a canvas texture holding the fabric colour, its base map and a panel's prints. */
export function createCompositeTexture(
  app: FabricAppearance, placements: PrintPlacement[], panelSizeCm: Vec2,
): CompositeTextureHandle {
  const canvas = document.createElement('canvas');
  const size = canvasSize(panelSizeCm);
  canvas.width = size.width;
  canvas.height = size.height;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;

  const ctx = canvas.getContext('2d');
  // Latest values a delayed repaint reads, so the canvas catches up to the newest state.
  let currentApp = app;
  let currentPlacements = placements;

  /** Repaints the canvas from the current values, arming `onImageReady` for images still decoding. */
  function paint(): void {
    if (ctx) drawComposite(ctx, canvas.width, canvas.height, panelSizeCm, currentApp, currentPlacements, onImageReady);
  }

  /** Redraws once a decoded image lands, then uploads the updated canvas. */
  const onImageReady = (): void => {
    paint();
    texture.needsUpdate = true;
  };

  const handle: CompositeTextureHandle = {
    texture,
    redraw(nextApp, nextPlacements) {
      currentApp = nextApp;
      currentPlacements = nextPlacements;
      paint();
      texture.needsUpdate = true;
    },
    dispose() {
      texture.dispose();
    },
  };
  handle.redraw(app, placements);
  return handle;
}

/**
 * Paints the fabric base colour, the base map under the appearance's tiling and offset, and the
 * print rectangles in that order. `onImageReady` repaints once a still-decoding image lands.
 */
export function drawComposite(
  ctx: CanvasRenderingContext2D, width: number, height: number, panelSizeCm: Vec2,
  app: FabricAppearance, placements: PrintPlacement[], onImageReady: () => void,
): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = app.baseColor;
  ctx.fillRect(0, 0, width, height);

  const albedo = app.maps?.albedo;
  if (albedo) {
    const image = imageAt(albedo, onImageReady);
    if (image) drawTiledMap(ctx, image, width, height, app.uvTiling, app.uvOffset);
  }

  for (const placement of placements) {
    const image = imageAt(placement.imageUrl, onImageReady);
    if (image) drawArtwork(ctx, image, width, height, panelSizeCm, placement);
  }
}

/** Repeats the base map across the canvas, matching the appearance's texture tiling. */
function drawTiledMap(
  ctx: CanvasRenderingContext2D, image: HTMLImageElement, width: number, height: number,
  tiling: Vec2, offset: Vec2,
): void {
  const repeatX = Math.max(1e-6, tiling?.x ?? 1);
  const repeatY = Math.max(1e-6, tiling?.y ?? 1);
  const offsetX = offset?.x ?? 0;
  const offsetY = offset?.y ?? 0;
  const tileW = width / repeatX;
  const tileH = height / repeatY;
  if (!(tileW > 0) || !(tileH > 0)) return;

  const firstX = Math.max(-MAX_MAP_TILES, Math.floor(offsetX) - 1);
  const lastX = Math.min(MAX_MAP_TILES, Math.ceil(offsetX + repeatX) + 1);
  const firstY = Math.max(-MAX_MAP_TILES, Math.floor(offsetY) - 1);
  const lastY = Math.min(MAX_MAP_TILES, Math.ceil(offsetY + repeatY) + 1);
  for (let row = firstY; row <= lastY; row++) {
    // Canvas y runs opposite to v, so a tile's top edge sits at the higher v bound.
    const top = height - ((row + 1 - offsetY) / repeatY) * height;
    for (let col = firstX; col <= lastX; col++) {
      const left = (col - offsetX) * tileW;
      ctx.drawImage(image, left, top, tileW, tileH);
    }
  }
}

/** Draws one print rectangle, tiled by its repeat counts and rotated about its centre. */
function drawArtwork(
  ctx: CanvasRenderingContext2D, image: HTMLImageElement, width: number, height: number,
  panelSizeCm: Vec2, placement: PrintPlacement,
): void {
  const scaleX = width / Math.max(1e-6, panelSizeCm.x);
  const scaleY = height / Math.max(1e-6, panelSizeCm.y);
  const printW = placement.width * panelSizeCm.x;
  const printH = placement.height * panelSizeCm.y;
  const cols = Math.max(1, Math.round(placement.repeat.x));
  const rows = Math.max(1, Math.round(placement.repeat.y));
  const cellW = printW / cols;
  const cellH = printH / rows;
  const rad = (placement.angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);

  ctx.save();
  ctx.globalAlpha = placement.opacity;
  ctx.translate(placement.center.x * width, (1 - placement.center.y) * height);
  // Pattern centimetres (y up) to canvas pixels (y down), rotated counter-clockwise.
  ctx.transform(scaleX * cos, -scaleY * sin, scaleX * sin, scaleY * cos, 0, 0);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      ctx.drawImage(image, -printW / 2 + col * cellW, -printH / 2 + row * cellH, cellW, cellH);
    }
  }
  ctx.restore();
}

/** Canvas pixel size matching the panel's centimetre aspect, capped on the long side. */
function canvasSize(sizeCm: Vec2): { width: number; height: number } {
  const w = Math.max(1e-6, sizeCm.x);
  const h = Math.max(1e-6, sizeCm.y);
  const aspect = w / h;
  if (!Number.isFinite(aspect) || aspect <= 0) return { width: COMPOSITE_MAX_SIDE, height: COMPOSITE_MAX_SIDE };
  return aspect >= 1
    ? { width: COMPOSITE_MAX_SIDE, height: Math.max(COMPOSITE_MIN_SIDE, Math.round(COMPOSITE_MAX_SIDE / aspect)) }
    : { width: Math.max(COMPOSITE_MIN_SIDE, Math.round(COMPOSITE_MAX_SIDE * aspect)), height: COMPOSITE_MAX_SIDE };
}
