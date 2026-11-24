import type {
  PaintCommand, PrintPlacement, TextureOptions, TexturePort,
} from '@/render/common';

import { retainImage, imageAt } from '@/base/platform';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import * as THREE from 'three/webgpu';

const MAX_MAP_TILES = 32;

export class TextureCache implements TexturePort {
  private readonly entries = new Map<string, THREE.Texture>();
  private readonly urls = new Map<string, string>();
  private readonly leases = new Map<string, { release(): void; ready: Promise<unknown> }>();
  private versionValue = 0;

  get version(): number {
    return this.versionValue;
  }

  set(key: string, texture: THREE.Texture): void {
    const previous = this.entries.get(key);
    if (previous && previous !== texture) previous.dispose();
    this.entries.set(key, texture);
    this.versionValue += 1;
  }

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
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    applyTransform(texture, command.uv?.repeat, command.uv?.offset);
    texture.needsUpdate = true;
    this.set(key, texture);
    const repaint = (): void => {
      if (this.entries.get(key) !== texture) return;
      paintComposite(canvas, command, repaint);
      texture.needsUpdate = true;
      this.versionValue += 1;
    };
    repaint();
  }

  transform(key: string, tiling?: { x: number; y: number }, offset?: { x: number; y: number }): void {
    const texture = this.entries.get(key);
    if (!texture) return;
    applyTransform(texture, tiling, offset);
    texture.needsUpdate = true;
  }

  get(key: string): THREE.Texture | null {
    return this.entries.get(key) ?? null;
  }

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

  dispose(): void {
    for (const lease of this.leases.values()) lease.release();
    this.leases.clear();
    this.urls.clear();
    for (const texture of this.entries.values()) texture.dispose();
    this.entries.clear();
    this.versionValue += 1;
  }

  private loadHdr(key: string, url: string): void {
    const loader = /\.exr(\?|$)/i.test(url)
      ? new EXRLoader().setDataType(THREE.HalfFloatType)
      : new RGBELoader().setDataType(THREE.HalfFloatType);
    loader.load(url, texture => {
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

function applyTransform(
  texture: THREE.Texture,
  tiling?: { x: number; y: number },
  offset?: { x: number; y: number },
): void {
  if (tiling) texture.repeat.set(tiling.x, tiling.y);
  if (offset) texture.offset.set(offset.x, offset.y);
}
