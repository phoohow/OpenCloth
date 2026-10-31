/** One panel shape to place on the fabric. */
export interface PackItem {
  id: string;
  /** Piece width across the fabric, in centimeters. */
  width: number;
  /** Piece length along the fabric, in centimeters. */
  height: number;
  /** How many copies to cut. */
  qty: number;
}

/** Where one copy sits on the marker: origin at the bottom-left of the fabric roll. */
export interface Placement {
  itemId: string;
  x: number;
  y: number;
  /** Axis-aligned bounding width of the placed piece, in centimeters. */
  width: number;
  /** Axis-aligned bounding height of the placed piece, in centimeters. */
  height: number;
  /** Rotation applied to the piece outline, degrees counter-clockwise. */
  angleDeg: number;
}

/** Result of `packPanels`. */
export interface PackResult {
  placements: Placement[];
  /** Marker length consumed along the fabric, in centimeters. */
  usedLengthCm: number;
  /** Sum of item areas divided by fabricWidth x usedLengthCm, in [0, 1]. */
  utilization: number;
}

/** Options for `packPanels`. */
export interface PackOptions {
  /** Gap kept between pieces and between shelves, in centimeters; default 0.5. */
  gapCm?: number;
  /** Allow turning pieces 90 degrees when they otherwise cannot fit; default false. */
  allowRotate?: boolean;
  /** Rotation angles tried per piece, degrees counter-clockwise; includes 0. Defaults from `allowRotate`. */
  angles?: number[];
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

const DEG = Math.PI / 180;

/** Axis-aligned bounding box of a `width` x `height` rectangle rotated by `angleDeg`. */
function rotatedBounds(width: number, height: number, angleDeg: number): { width: number; height: number } {
  const rad = angleDeg * DEG;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  return { width: width * cos + height * sin, height: width * sin + height * cos };
}

/**
 * Shelf packing (next-fit-decreasing): pieces are sorted tallest-first and laid left to
 * right across the fabric width; a new shelf starts above when a piece no longer fits.
 * Deterministic: identical input always yields identical placements.
 */
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
    });
    cursorX += orientation.width + gapCm;
    shelfHeight = Math.max(shelfHeight, orientation.height);
    usedLength = Math.max(usedLength, shelfTop + shelfHeight);
  }

  const totalArea = pieces.reduce((acc, p) => acc + p.width * p.height, 0);
  const utilization = fabricWidthCm > 0 && usedLength > 0 ? totalArea / (fabricWidthCm * usedLength) : 0;
  return { placements, usedLengthCm: usedLength, utilization };
}

/** Allowed orientations of one piece, widest-fit first; empty when none fits the width. */
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