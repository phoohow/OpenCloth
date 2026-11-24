import type { Print, Vec2 } from '@/model/types';

import { clamp } from '@/base/math';

export const PRINT_REFERENCE_DPI = 150;

export const PRINT_MAX_PANEL_FRACTION = 0.6;

export const PRINT_MIN_SIDE_CM = 2;

export const PRINT_IMAGE_MAX_EDGE = 2048;

export const PRINT_SIDE_MIN_CM = 0.1;

export const PRINT_SIDE_MAX_CM = 1000;

export interface PrintSize {
  widthCm: number;
  heightCm: number;
}

export function printSizeFromPixels(pixel: Vec2, panelBox: Vec2): PrintSize {
  const width = Math.max(1, pixel.x) * (2.54 / PRINT_REFERENCE_DPI);
  const height = Math.max(1, pixel.y) * (2.54 / PRINT_REFERENCE_DPI);
  const fit = Math.min(
    1,
    Math.max(PRINT_MIN_SIDE_CM, panelBox.x * PRINT_MAX_PANEL_FRACTION) / width,
    Math.max(PRINT_MIN_SIDE_CM, panelBox.y * PRINT_MAX_PANEL_FRACTION) / height,
  );
  const grow = Math.max(1, PRINT_MIN_SIDE_CM / (Math.min(width, height) * fit));
  return { widthCm: width * fit * grow, heightCm: height * fit * grow };
}

export function printSourceSize(print: Print): Vec2 | null {
  return print.sourceSize ?? print.imageSize ?? null;
}

export function printSizeFromSide(
  side: 'width' | 'height', value: number, current: PrintSize, aspect: number, locked: boolean,
): PrintSize {
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : current.widthCm / Math.max(1e-6, current.heightCm);
  const untouched = side === 'width' ? current.heightCm : current.widthCm;
  const widthCm = side === 'width' ? value : locked ? value * ratio : untouched;
  const heightCm = side === 'height' ? value : locked ? value / ratio : untouched;
  return {
    widthCm: clamp(widthCm, PRINT_SIDE_MIN_CM, PRINT_SIDE_MAX_CM),
    heightCm: clamp(heightCm, PRINT_SIDE_MIN_CM, PRINT_SIDE_MAX_CM),
  };
}

export function printSizeWithAspect(aspect: number, size: PrintSize): PrintSize {
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const area = Math.max(PRINT_SIDE_MIN_CM * PRINT_SIDE_MIN_CM, size.widthCm * size.heightCm);
  const widthCm = Math.sqrt(area * ratio);
  return {
    widthCm: clamp(widthCm, PRINT_SIDE_MIN_CM, PRINT_SIDE_MAX_CM),
    heightCm: clamp(widthCm / ratio, PRINT_SIDE_MIN_CM, PRINT_SIDE_MAX_CM),
  };
}

export function printImageFields(pixelSize: Vec2, sourceSize: Vec2): { imageSize: Vec2; sourceSize?: Vec2 } {
  const same = pixelSize.x === sourceSize.x && pixelSize.y === sourceSize.y;
  return { imageSize: { ...pixelSize }, ...(same ? {} : { sourceSize: { ...sourceSize } }) };
}

export function printResolutionDpi(print: Print): number | null {
  if (!print.imageSize || !(print.widthCm > 0)) return null;
  const widthCm = print.widthCm / Math.max(1, print.repeat.x);
  if (!(widthCm > 0)) return null;
  return (print.imageSize.x / widthCm) * 2.54;
}

export function printAspectLocked(print: Print): boolean {
  return print.lockAspect !== false;
}
