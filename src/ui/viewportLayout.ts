import type { PaneId, ViewLayout } from '@/store';
import { isSplitLayout, leftPaneOf } from '@/store';

/** Width of a draggable divider between two panes or panels. */
export const DIVIDER_WIDTH = 6;

/** Smallest share either pane keeps in the split layouts. */
export const MIN_PANE_RATIO = 0.15;

/** Largest share either pane keeps in the split layouts. */
export const MAX_PANE_RATIO = 1 - MIN_PANE_RATIO;

/** Smallest width a side panel can be dragged to, in pixels. */
export const MIN_PANEL_WIDTH = 160;

/** Largest width a side panel can be dragged to, in pixels. */
export const MAX_PANEL_WIDTH = 560;

/** Largest share of the window body one side panel may cover. */
export const MAX_PANEL_SHARE = 0.4;

/** Smallest share of the right panel given to the outliner. */
export const MIN_SCENE_RATIO = 0.18;

/** Largest share of the right panel given to the outliner. */
export const MAX_SCENE_RATIO = 0.6;

/** CSS flex value giving a pane its share of the viewport area. */
export function paneFlex(layout: ViewLayout, pane: PaneId, leftShare: number): string {
  if (isSplitLayout(layout)) {
    return pane === leftPaneOf(layout) ? `${leftShare} 1 0%` : `${1 - leftShare} 1 0%`;
  }
  return layout === pane ? '1 1 0%' : '0 0 auto';
}

/** Whether the pane is visible in the layout. */
export function isPaneShown(layout: ViewLayout, pane: PaneId): boolean {
  return isSplitLayout(layout) || layout === pane;
}

/** Left pane share of the viewport area for a cursor position inside it. */
export function splitRatioFromPointer(clientX: number, areaLeft: number, areaWidth: number): number {
  return ratioFromPointer(clientX, areaLeft, areaWidth, MIN_PANE_RATIO, MAX_PANE_RATIO);
}

/** Scene-tree share of the right panel height for a cursor position inside it. */
export function sceneRatioFromPointer(clientY: number, panelTop: number, panelHeight: number): number {
  return ratioFromPointer(clientY, panelTop, panelHeight, MIN_SCENE_RATIO, MAX_SCENE_RATIO);
}

/** Width of a panel that starts at `areaLeft` when its divider is dragged to the cursor. */
export function leftPanelWidthFromPointer(clientX: number, areaLeft: number, areaWidth: number): number {
  return clampPanelWidth(clientX - areaLeft - DIVIDER_WIDTH / 2, areaWidth);
}

/** Width of a panel that ends at `areaRight` when its divider is dragged to the cursor. */
export function rightPanelWidthFromPointer(clientX: number, areaRight: number, areaWidth: number): number {
  return clampPanelWidth(areaRight - clientX - DIVIDER_WIDTH / 2, areaWidth);
}

/** Panel width in pixels, kept between the bounds and the space the window allows. */
function clampPanelWidth(width: number, areaWidth: number): number {
  const max = Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, areaWidth * MAX_PANEL_SHARE));
  return Math.min(max, Math.max(MIN_PANEL_WIDTH, width));
}

/** Pane share of a track when the divider is dragged to a cursor position. */
function ratioFromPointer(cursor: number, trackStart: number, trackSize: number, min: number, max: number): number {
  const flexSize = trackSize - DIVIDER_WIDTH;
  if (flexSize <= 0) return min;
  return clampRatio((cursor - trackStart - DIVIDER_WIDTH / 2) / flexSize, min, max);
}

function clampRatio(ratio: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, ratio));
}
