import type { Vec2 } from '@/base/math';

import { readFileAsDataUrl } from '@/io/serialization/codec';

export const MATERIAL_IMAGE_MAX_EDGE = 1024;

export interface ScaledImage {
  url: string;
  pixelSize: Vec2;
  sourceSize: Vec2;
}

export async function readImageAsPngDataUrl(file: File, maxEdge = MATERIAL_IMAGE_MAX_EDGE): Promise<string> {
  const original = await readFileAsDataUrl(file);
  try {
    return (await downscaleToPng(original, maxEdge)).url;
  } catch {
    return original;
  }
}

export async function readPrintImage(file: File, maxEdge = MATERIAL_IMAGE_MAX_EDGE): Promise<ScaledImage> {
  return downscaleToPng(await readFileAsDataUrl(file), maxEdge);
}

async function downscaleToPng(url: string, maxEdge: number): Promise<ScaledImage> {
  const image = await loadImage(url);
  const sourceSize: Vec2 = { x: image.naturalWidth, y: image.naturalHeight };
  const longest = Math.max(sourceSize.x, sourceSize.y);
  if (!(longest > 0)) throw new Error('无法解码图片');
  if (longest <= maxEdge) return { url, pixelSize: { ...sourceSize }, sourceSize };

  const scale = maxEdge / longest;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sourceSize.x * scale));
  canvas.height = Math.max(1, Math.round(sourceSize.y * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('没有可用的 2D 画布');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return {
    url: canvas.toDataURL('image/png'),
    pixelSize: { x: canvas.width, y: canvas.height },
    sourceSize,
  };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('无法解码图片'));
    image.src = url;
  });
}
