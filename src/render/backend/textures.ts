/** Texture keys and the decoded textures behind them, including HDR/EXR and print composites. */

import * as THREE from 'three/webgpu';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import { retainImage, imageAt } from '@/base/platform';
import type {
  PaintCommand, PrintPlacement, TextureOptions, TexturePort,
} from '@/render/common';

/** Longest canvas side of a composed panel texture, in pixels. */
const COMPOSITE_MAX_SIDE = 1024;
/** Shortest canvas side of a composed panel texture, in pixels. */
const COMPOSITE_MIN_SIDE = 64;
/** Tiles drawn per axis, so an extreme fabric tiling cannot stall a repaint. */
const MAX_MAP_TILES = 32;

/** Keyed texture store; entities and materials reference keys, never GPU textures. */
export class TextureCache implements TexturePort {
  private readonly entries = new Map<string, THREE.Texture>();
  private readonly urls = new Map<string, string>();
  private readonly leases = new Map<string, { release(): void; ready: Promise<unknown> }>();
  private versionValue = 0;

  /** Increments whenever a texture is added, replaced or removed. */
  get version(): number {
    return this.versionValue;
  }

  /** Registers or replaces a texture under a key; the cache owns the texture. */
  set(key: string, texture: THREE.Texture): void {
    const previous = this.entries.get(key);
    if (previous && previous !== texture) previous.dispose();
    this.entries.set(key, texture);
    this.versionValue += 1;
  }

  /** Loads an image, HDR or EXR url into the cache. */
  load(key: string, url: string, options: TextureOptions = {}): void {
    if (this.urls.get(key) === url) {
      this.transform(key, options.tiling, options.offset);
      return;
    }
    this.release(key);
    this.urls.set(key, url);
    const ext = url.split('?')[0]!.toLowerCase();
    if (ext.endsWith('.hdr') || ext.endsWith('.exr')) {
      this.loadHdr(key, url);
      return;
    }
    const lease = retainImage(url);
    this.leases.set(key, lease as { release(): void; ready: Promise<unknown> });
    void lease.ready.then(image => {
      if (!image || this.leases.get(key) !== lease) return;
      const texture = new THREE.Texture(image);
      texture.colorSpace = options.colorSpace === 'linear' ? THREE.NoColorSpace : THREE.SRGBColorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      applyTransform(texture, options.tiling, options.offset);
      texture.needsUpdate = true;
      this.set(key, texture);
    });
  }

  /** Paints a composed panel texture and registers it under a key. */
  paint(key: string, commands: readonly PaintCommand[]): void {
    const command = commands[0];
    if (!command) return;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(command.width));
    canvas.height = Math.max(1, Math.round(command.height));
    const existing = this.entries.get(key);
    const texture = existing instanceof THREE.CanvasTexture ? existing : new THREE.CanvasTexture(canvas);
    texture.image = canvas;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    this.set(key, texture);
    paintComposite(canvas, command, () => {
      texture.needsUpdate = true;
      this.versionValue += 1;
    });
  }

  /** Applies a new repeat and offset to a loaded texture. */
  transform(key: string, tiling?: { x: number; y: number }, offset?: { x: number; y: number }): void {
    const texture = this.entries.get(key);
    if (!texture) return;
    applyTransform(texture, tiling, offset);
    texture.needsUpdate = true;
  }

  /** Texture behind a key, or null while it is missing. */
  get(key: string): THREE.Texture | null {
    return this.entries.get(key) ?? null;
  }

  /** Drops and frees one texture. */
  release(key: string): void {
    this.leases.get(key)?.release();
    this.leases.delete(key);
    this.urls.delete(key);
    const texture = this.entries.get(key);
    if (!texture) return;
    this.entries.delete(key);
    texture.dispose();
    this.versionValue += 1;
  }

  /** Frees every texture. */
  dispose(): void {
    for (const lease of this.leases.values()) lease.release();
    this.leases.clear();
    this.urls.clear();
    for (const texture of this.entries.values()) texture.dispose();
    this.entries.clear();
    this.versionValue += 1;
  }

  /** Decodes an equirectangular HDR or EXR image into a linear texture. */
  private loadHdr(key: string, url: string): void {
    const loader = /\.exr(\?|$)/i.test(url)
      ? new EXRLoader().setDataType(THREE.HalfFloatType)
      : new RGBELoader().setDataType(THREE.HalfFloatType);
    loader.load(url, texture => {
      // A replaced url may have released this key while the image decoded.
      if (this.urls.get(key) !== url) {
        texture.dispose();
        return;
      }
      texture.mapping = THREE.EquirectangularReflectionMapping;
      texture.colorSpace = THREE.LinearSRGBColorSpace;
      this.set(key, texture);
    });
  }
}

/** Canvas pixel size matching the panel's centimetre aspect, capped on the long side. */
function canvasSize(size: { x: number; y: number }): { width: number; height: number } {
  const w = Math.max(1e-6, size.x);
  const h = Math.max(1e-6, size.y);
  const aspect = w / h;
  if (!Number.isFinite(aspect) || aspect <= 0) {
    return { width: COMPOSITE_MAX_SIDE, height: COMPOSITE_MAX_SIDE };
  }
  return aspect >= 1
    ? { width: COMPOSITE_MAX_SIDE, height: Math.max(COMPOSITE_MIN_SIDE, Math.round(COMPOSITE_MAX_SIDE / aspect)) }
    : { width: Math.max(COMPOSITE_MIN_SIDE, Math.round(COMPOSITE_MAX_SIDE * aspect)), height: COMPOSITE_MAX_SIDE };
}

/** Paints the base colour, the tiled base map and every print into a canvas. */
function paintComposite(canvas: HTMLCanvasElement, command: PaintCommand, onReady: () => void): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { width, height } = canvas;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = command.baseColor;
  ctx.fillRect(0, 0, width, height);
  if (command.albedo) {
    const image = imageAt(command.albedo.url, onReady);
    if (image) drawTiledMap(ctx, image, width, height, command.albedo.tiling, command.albedo.offset);
  }
  const panelSize = command.panelSizeCm ?? { x: width, y: height };
  for (const placement of command.prints ?? []) {
    const image = imageAt(placement.imageUrl, onReady);
    if (image) drawArtwork(ctx, image, width, height, panelSize, placement);
  }
}

/** Repeats the base map across the canvas, matching the appearance's texture tiling. */
function drawTiledMap(
  ctx: CanvasRenderingContext2D, image: HTMLImageElement, width: number, height: number,
  tiling?: { x: number; y: number }, offset?: { x: number; y: number },
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
  panelSizeCm: { x: number; y: number }, placement: PrintPlacement,
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
  ctx.transform(scaleX * cos, -scaleY * sin, scaleX * sin, scaleY * cos, 0, 0);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      ctx.drawImage(image, -printW / 2 + col * cellW, -printH / 2 + row * cellH, cellW, cellH);
    }
  }
  ctx.restore();
}

/** Writes repeat and offset onto a texture. */
function applyTransform(
  texture: THREE.Texture,
  tiling?: { x: number; y: number },
  offset?: { x: number; y: number },
): void {
  if (tiling) texture.repeat.set(tiling.x, tiling.y);
  if (offset) texture.offset.set(offset.x, offset.y);
}

/** Re-exported so callers can size a composite canvas before painting. */
export { canvasSize };
