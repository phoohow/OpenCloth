export const PHONE_SHORT_SIDE_MAX = 560;

export const TAP_MOVE_SLOP_PX = 10;

export const TAP_MAX_MS = 350;

export const MOBILE_VIEWPORT_HINT = '3D 试衣 · 单指旋转 · 双指缩放/平移 · 轻点选片';

let cachedUiMode: UiMode | null = null;

export type UiMode = 'desktop' | 'mobile';

export interface UiModeInput {
  width: number;
  height: number;
  coarsePointer: boolean;
  forced?: string | null;
}

export function resolveUiMode({ width, height, coarsePointer, forced }: UiModeInput): UiMode {
  if (forced === 'mobile' || forced === 'desktop') return forced;
  const shortSide = Math.min(width, height);
  return coarsePointer && shortSide <= PHONE_SHORT_SIDE_MAX ? 'mobile' : 'desktop';
}

export function isTapGesture(dx: number, dy: number, elapsedMs: number): boolean {
  return elapsedMs >= 0
    && elapsedMs <= TAP_MAX_MS
    && Math.abs(dx) <= TAP_MOVE_SLOP_PX
    && Math.abs(dy) <= TAP_MOVE_SLOP_PX;
}

export function uiMode(): UiMode {
  if (cachedUiMode) return cachedUiMode;
  cachedUiMode = resolveUiMode({
    width: window.innerWidth,
    height: window.innerHeight,
    coarsePointer: window.matchMedia('(pointer: coarse)').matches,
    forced: new URLSearchParams(window.location.search).get('ui'),
  });
  return cachedUiMode;
}

export function isMobileUi(): boolean {
  return uiMode() === 'mobile';
}
