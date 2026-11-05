import type { Pattern, Vec2 } from '../../core/model/types';
import { resolveSize } from '../../core/command/gradingCommands';
import { panelGrainLine, panelOutlineWithAllowance } from '../panel/panelBuilder';
import { computeBBox } from '../geom/vec2';
import { packPanels, type PackItem, type Placement } from './packing';

/** One size nested onto the marker; labels become part of each piece name. */
export interface MarkerSize {
  id: string;
  label: string;
}

/** Options shared by every marker export. */
export interface MarkerLayoutOptions {
  /** Fabric width across the marker, in centimetres; default 150. */
  fabricWidthCm?: number;
  /** Gap kept between pieces, in centimetres; default 0.5. */
  gapCm?: number;
  /** Fabric shrinkage percentage; each piece is enlarged by it before packing. Default 0. */
  shrinkPercent?: number;
  /** Whether a piece may be turned 90° to fit the width; default true. */
  allowRotate?: boolean;
  /** Rotation angles tried per piece, degrees counter-clockwise; overrides `allowRotate`. */
  angles?: number[];
  /** Mirrors every piece across its own vertical axis; default false. */
  flip?: boolean;
  /** Sizes to nest together; absent packs the pattern's current geometry only. */
  sizes?: MarkerSize[];
  /** Size the stored pattern geometry represents; defaults to base geometry. */
  fromSizeId?: string;
}

/** One panel's cutting outline, normalized to its own bottom-left corner. */
export interface MarkerPiece {
  panelId: string;
  name: string;
  /** Bounding box width across the fabric, in centimetres. */
  width: number;
  /** Bounding box length along the fabric, in centimetres. */
  height: number;
  /** Cutting outline in piece-local coordinates, Y-up. */
  outline: Vec2[];
  /** Grainline endpoints in piece-local coordinates. */
  grain: Vec2[] | null;
}

/** One piece together with its position on the marker. */
export interface MarkerPlacement {
  piece: MarkerPiece;
  place: Placement;
}

/** A packed marker: pieces, placements and the fabric roll they sit on. */
export interface MarkerLayout {
  fabricWidthCm: number;
  /** Marker length consumed along the fabric, in centimetres. */
  usedLengthCm: number;
  /** Piece area divided by the used marker area, in [0, 1]. */
  utilization: number;
  placements: MarkerPlacement[];
}


/**
 * Packs the visible panels' cutting outlines onto the fabric roll. Single geometry source
 * for every marker export, so image and DXF唛架 share the same placements and dimensions.
 */
export function buildMarkerLayout(pattern: Pattern, options: MarkerLayoutOptions = {}): MarkerLayout {
  const fabricWidthCm = options.fabricWidthCm ?? 150;
  const shrink = 1 + (options.shrinkPercent ?? 0) / 100;

  const pieces = new Map<string, MarkerPiece>();
  const items: PackItem[] = [];
  const scopes = options.sizes?.length ? options.sizes : [null];
  for (const scope of scopes) {
    const scopedPattern = scope ? resolveSize(pattern, options.fromSizeId, scope.id) : pattern;
    for (const panel of Object.values(scopedPattern.panels)) {
      if (!panel.visible) continue;
      const cut = panelOutlineWithAllowance(scopedPattern, panel).map(p => ({ x: p.x * shrink, y: p.y * shrink }));
      if (cut.length < 3) continue;
      const box = computeBBox(cut);
      const width = box.max.x - box.min.x;
      const height = box.max.y - box.min.y;
      if (!(width > 0) || !(height > 0)) continue;
      const grain = panelGrainLine(panel, cut);
      const pieceId = scope ? `${panel.id}@${scope.id}` : panel.id;
      const name = scope ? `${panel.name} ${scope.label}` : panel.name;
      items.push({ id: pieceId, width, height, qty: 1 });
      pieces.set(pieceId, {
        panelId: pieceId,
        name,
        width,
        height,
        outline: cut.map(p => ({ x: p.x - box.min.x, y: p.y - box.min.y })),
        grain: grain?.map(p => ({ x: p.x - box.min.x, y: p.y - box.min.y })) ?? null,
      });
    }
  }
  if (items.length === 0) throw new Error('没有可排料的版片');

  const packed = packPanels(items, fabricWidthCm, {
    gapCm: options.gapCm,
    allowRotate: options.allowRotate ?? true,
    ...(options.angles ? { angles: options.angles } : {}),
    ...(options.flip ? { flip: true } : {}),
  });
  return {
    fabricWidthCm,
    usedLengthCm: packed.usedLengthCm,
    utilization: packed.utilization,
    placements: packed.placements
      .map(place => ({ place, piece: pieces.get(place.itemId) }))
      .filter((entry): entry is MarkerPlacement => entry.piece !== undefined),
  };
}

/** Maps one piece-local point into marker coordinates, mirrored and rotated by the placed angle. */
export function placePoint(piece: MarkerPiece, place: Placement, p: Vec2): Vec2 {
  const localX = place.flipped ? piece.width - p.x : p.x;
  const rad = place.angleDeg * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const corners = [
    { x: 0, y: 0 },
    { x: piece.width, y: 0 },
    { x: piece.width, y: piece.height },
    { x: 0, y: piece.height },
  ];
  let minX = Infinity;
  let minY = Infinity;
  for (const corner of corners) {
    const rx = corner.x * cos - corner.y * sin;
    const ry = corner.x * sin + corner.y * cos;
    if (rx < minX) minX = rx;
    if (ry < minY) minY = ry;
  }
  return {
    x: localX * cos - p.y * sin - minX + place.x,
    y: localX * sin + p.y * cos - minY + place.y,
  };
}

/** Marker coordinates of one placed piece's outline. */
export function placedOutline(entry: MarkerPlacement): Vec2[] {
  return entry.piece.outline.map(p => placePoint(entry.piece, entry.place, p));
}

/** Marker coordinates of the piece name anchor: the placement's centre. */
export function placedLabel(entry: MarkerPlacement): Vec2 {
  return { x: entry.place.x + entry.place.width / 2, y: entry.place.y + entry.place.height / 2 };
}
