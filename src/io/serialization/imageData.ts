import { readFileAsDataUrl } from '@/io/serialization/codec';

/** Longest side cap applied to uploaded material images, in pixels. */
export const MATERIAL_IMAGE_MAX_EDGE = 1024;

/**
 * Reads an image file as a PNG data URL whose longest side is at most `maxEdge`.
 * Images already small enough keep their original encoding; a failed resize falls back to the original data URL.
 */
export async function readImageAsPngDataUrl(file: File, maxEdge = MATERIAL_IMAGE_MAX_EDGE): Promise<string> {
  const original = await readFileAsDataUrl(file);
  try {
    return await downscaleToPng(original, maxEdge);
  } catch {
    return original;
  }
}

/** Decodes the data URL and re-encodes it as PNG when its longest side exceeds the cap. */
async function downscaleToPng(url: string, maxEdge: number): Promise<string> {
  const image = await loadImage(url);
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return url;

  const scale = maxEdge / longest;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('没有可用的 2D 画布');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

/** Loads a data URL into a decoded image element. */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('无法解码图片'));
    image.src = url;
  });
}
