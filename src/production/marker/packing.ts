import { degToRad } from '@/base/math';

export interface PackItem {
  id: string;
  width: number;
  height: number;
  qty: number;
}

export interface Placement {
  itemId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angleDeg: number;
  flipped: boolean;
}

export interface PackResult {
  placements: Placement[];
  usedLengthCm: number;
  utilization: number;
}

export interface PackOptions {
  gapCm?: number;
  allowRotate?: boolean;
  angles?: number[];
  flip?: boolean;
}

interface Piece {
  itemId: string;
  width: number;
  height: number;
}

interface Orientation {
  angleDeg: number;
  width: number;
  height: number;
}

function rotatedBounds(width: number, height: number, angleDeg: number): { width: number; height: number } {
  const rad = degToRad(angleDeg);
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  return { width: width * cos + height * sin, height: width * sin + height * cos };
}

export function packPanels(items: PackItem[], fabricWidthCm: number, opts: PackOptions = {}): PackResult {
  const gapCm = opts.gapCm ?? 0.5;
  const angles = opts.angles ?? (opts.allowRotate ? [0, 90] : [0]);

  const pieces: Piece[] = [];
  for (const item of items) {
    if (item.qty <= 0 || item.width <= 0 || item.height <= 0) continue;
    const orientations = orientationsFor(item.width, item.height, angles, fabricWidthCm);
    if (orientations.length === 0) {
      throw new Error(`零件「${item.id}」尺寸 ${item.width}×${item.height}cm 超过幅宽 ${fabricWidthCm}cm，无法排料`);
    }

    for (let i = 0; i < item.qty; i++) pieces.push({ itemId: item.id, width: item.width, height: item.height });
  }

  pieces.sort((a, b) =>
    b.height - a.height || b.width - a.width || a.itemId.localeCompare(b.itemId));

  const placements: Placement[] = [];
  let shelfTop = 0;
  let shelfHeight = 0;
  let cursorX = 0;
  let usedLength = 0;

  const closeShelf = (): void => {
    if (shelfHeight > 0) {
      shelfTop += shelfHeight + gapCm;
      shelfHeight = 0;
      cursorX = 0;
    }
  };

  for (const piece of pieces) {
    const remaining = fabricWidthCm - cursorX - (cursorX > 0 ? gapCm : 0);
    const fitsShelf = orientationsFor(piece.width, piece.height, angles, Math.max(0, remaining))[0];
    let orientation: Orientation;
    if (fitsShelf) {
      orientation = fitsShelf;
    } else {
      closeShelf();
      orientation = orientationsFor(piece.width, piece.height, angles, fabricWidthCm)[0]
        ?? { angleDeg: 0, width: piece.width, height: piece.height };
    }

    if (orientation.width > fabricWidthCm) {
      throw new Error(`零件「${piece.itemId}」无法在幅宽 ${fabricWidthCm}cm 内摆放`);
    }

    placements.push({
      itemId: piece.itemId,
      x: cursorX,
      y: shelfTop,
      width: orientation.width,
      height: orientation.height,
      angleDeg: orientation.angleDeg,
      flipped: opts.flip === true,
    });
    cursorX += orientation.width + gapCm;
    shelfHeight = Math.max(shelfHeight, orientation.height);
    usedLength = Math.max(usedLength, shelfTop + shelfHeight);
  }

  const totalArea = pieces.reduce((acc, p) => acc + p.width * p.height, 0);
  const utilization = fabricWidthCm > 0 && usedLength > 0 ? totalArea / (fabricWidthCm * usedLength) : 0;
  return { placements, usedLengthCm: usedLength, utilization };
}

function orientationsFor(
  width: number,
  height: number,
  angles: number[],
  maxWidth: number,
): Orientation[] {
  const unique = [...new Set(angles)].filter(angle => Number.isFinite(angle));
  const orientations: Orientation[] = [];
  for (const angle of unique) {
    const bounds = rotatedBounds(width, height, angle);
    if (bounds.width <= maxWidth + 1e-9) orientations.push({ angleDeg: angle, ...bounds });
  }

  orientations.sort((a, b) =>
    a.width - b.width || a.height - b.height || a.angleDeg - b.angleDeg);
  return orientations;
}
