import type { Pattern, Vec2 } from '@/model/types';

import { computeBBox, placeInSlot, slotCenter } from '@/base/geom';
import { resolveSize } from '@/pattern/grading';
import { panelGrainLine, panelOutlineWithAllowance } from '@/pattern/panel';
import { packPanels, type PackItem, type Placement } from '@/production/marker/packing';

export interface MarkerSize {
  id: string;
  label: string;
}

export interface MarkerLayoutOptions {
  fabricWidthCm?: number;
  gapCm?: number;
  shrinkPercent?: number;
  allowRotate?: boolean;
  angles?: number[];
  flip?: boolean;
  sizes?: MarkerSize[];
  fromSizeId?: string;
}

export interface MarkerPiece {
  panelId: string;
  name: string;
  width: number;
  height: number;
  outline: Vec2[];
  grain: Vec2[] | null;
}

export interface MarkerPlacement {
  piece: MarkerPiece;
  place: Placement;
}

export interface MarkerLayout {
  fabricWidthCm: number;
  usedLengthCm: number;
  utilization: number;
  placements: MarkerPlacement[];
}

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

export function placePoint(piece: MarkerPiece, place: Placement, p: Vec2): Vec2 {
  return placeInSlot(p, piece, place);
}

export function placedOutline(entry: MarkerPlacement): Vec2[] {
  return entry.piece.outline.map(p => placePoint(entry.piece, entry.place, p));
}

export function placedLabel(entry: MarkerPlacement): Vec2 {
  return slotCenter(entry.place);
}
