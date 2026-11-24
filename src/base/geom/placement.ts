import type { Vec2 } from '@/base/math';

import { degToRad, rotate2 } from '@/base/math';

export interface SlotPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
  angleDeg: number;
  flipped: boolean;
}

export interface SlotSize {
  width: number;
  height: number;
}

export function placeInSlot(local: Vec2, size: SlotSize, slot: SlotPlacement): Vec2 {
  const localX = slot.flipped ? size.width - local.x : local.x;
  const angle = degToRad(slot.angleDeg);
  const rotated = rotate2({ x: localX, y: local.y }, angle);
  const corners = [
    { x: 0, y: 0 },
    { x: size.width, y: 0 },
    { x: size.width, y: size.height },
    { x: 0, y: size.height },
  ].map(corner => rotate2(corner, angle));
  const minX = Math.min(...corners.map(corner => corner.x));
  const minY = Math.min(...corners.map(corner => corner.y));
  return { x: rotated.x - minX + slot.x, y: rotated.y - minY + slot.y };
}

export function slotCenter(slot: SlotPlacement): Vec2 {
  return { x: slot.x + slot.width / 2, y: slot.y + slot.height / 2 };
}
