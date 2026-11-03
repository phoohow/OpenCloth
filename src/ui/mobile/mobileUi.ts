/** Screen surface the application shell lays out for. */
export type UiMode = 'desktop' | 'mobile';

/** Longest screen short side, in CSS pixels, still treated as a phone. */
export const PHONE_SHORT_SIDE_MAX = 560;

/** Pointer travel a touch may cover and still count as a tap, in CSS pixels. */
export const TAP_MOVE_SLOP_PX = 10;

/** Longest touch that still counts as a tap, in milliseconds. */
export const TAP_MAX_MS = 350;

export interface UiModeInput {
  /** Viewport width in CSS pixels. */
  width: number;
  /** Viewport height in CSS pixels. */
  height: number;
  /** Whether the primary pointing device is a finger. */
  coarsePointer: boolean;
  /** `?ui=mobile|desktop`, which overrides the measurements. */
  forced?: string | null;
}

/**
 * Which shell to run. The short side is used so rotating the phone keeps the choice,
 * and a coarse primary pointer so a narrow desktop window keeps the desktop shell.
 */
export function resolveUiMode({ width, height, coarsePointer, forced }: UiModeInput): UiMode {
  if (forced === 'mobile' || forced === 'desktop') return forced;
  const shortSide = Math.min(width, height);
  return coarsePointer && shortSide <= PHONE_SHORT_SIDE_MAX ? 'mobile' : 'desktop';
}

/** Whether a touch began and ended close enough together, and fast enough, to be a tap. */
export function isTapGesture(dx: number, dy: number, elapsedMs: number): boolean {
  return elapsedMs >= 0
    && elapsedMs <= TAP_MAX_MS
    && Math.abs(dx) <= TAP_MOVE_SLOP_PX
    && Math.abs(dy) <= TAP_MOVE_SLOP_PX;
}

/** Touch gestures the phone shell supports, shown as the 3D viewport hint. */
export const MOBILE_VIEWPORT_HINT = '3D 试衣 · 单指拖拽旋转 · 双指捏合缩放 · 双指拖拽平移 · 轻点选片 · 轻点空白取消';

let cachedUiMode: UiMode | null = null;

/**
 * Shell chosen for this page load, resolved on first use. It stays fixed afterwards so
 * rotating the phone or dragging a desktop window cannot rebuild the WebGPU viewport.
 */
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

/** Whether this page load uses the phone shell. */
export function isMobileUi(): boolean {
  return uiMode() === 'mobile';
}
