import type { Vec2 } from '@/model/types';

import { placeInSlot, slotCenter } from '@/base/geom';

export interface MarkerSheetPiece {
  panelId: string;
  name: string;
  width: number;
  height: number;
  outline: readonly Vec2[];
  grain: readonly Vec2[] | null;
}

export interface MarkerSheetSlot {
  x: number;
  y: number;
  width: number;
  height: number;
  angleDeg: number;
  flipped: boolean;
}

export interface MarkerSheetPlacement {
  piece: MarkerSheetPiece;
  place: MarkerSheetSlot;
}

export interface MarkerSheet {
  fabricWidthCm: number;
  usedLengthCm: number;
  utilization: number;
  placements: readonly MarkerSheetPlacement[];
}

export function sheetPoint(entry: MarkerSheetPlacement, p: Vec2): Vec2 {
  return placeInSlot(p, entry.piece, entry.place);
}

export function sheetOutline(entry: MarkerSheetPlacement): Vec2[] {
  return entry.piece.outline.map(p => sheetPoint(entry, p));
}

export function sheetLabel(entry: MarkerSheetPlacement): Vec2 {
  return slotCenter(entry.place);
}
