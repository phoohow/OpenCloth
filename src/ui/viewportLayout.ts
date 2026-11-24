import type { PaneId, ViewLayout } from '@/store';

import { isSplitLayout, leftPaneOf } from '@/store';

export const DIVIDER_WIDTH = 6;

export const MIN_PANE_RATIO = 0.15;

export const MAX_PANE_RATIO = 1 - MIN_PANE_RATIO;

export const MIN_PANEL_WIDTH = 160;

export const MAX_PANEL_WIDTH = 560;

export const MAX_PANEL_SHARE = 0.4;

export const MIN_SCENE_RATIO = 0.18;

export const MAX_SCENE_RATIO = 0.6;

export function paneFlex(layout: ViewLayout, pane: PaneId, leftShare: number): string {
  if (isSplitLayout(layout)) {
    return pane === leftPaneOf(layout) ? `${leftShare} 1 0%` : `${1 - leftShare} 1 0%`;
  }

  return layout === pane ? '1 1 0%' : '0 0 auto';
}

export function isPaneShown(layout: ViewLayout, pane: PaneId): boolean {
  return isSplitLayout(layout) || layout === pane;
}

export function splitRatioFromPointer(clientX: number, areaLeft: number, areaWidth: number): number {
  return ratioFromPointer(clientX, areaLeft, areaWidth, MIN_PANE_RATIO, MAX_PANE_RATIO);
}

export function sceneRatioFromPointer(clientY: number, panelTop: number, panelHeight: number): number {
  return ratioFromPointer(clientY, panelTop, panelHeight, MIN_SCENE_RATIO, MAX_SCENE_RATIO);
}

export function leftPanelWidthFromPointer(clientX: number, areaLeft: number, areaWidth: number): number {
  return clampPanelWidth(clientX - areaLeft - DIVIDER_WIDTH / 2, areaWidth);
}

export function rightPanelWidthFromPointer(clientX: number, areaRight: number, areaWidth: number): number {
  return clampPanelWidth(areaRight - clientX - DIVIDER_WIDTH / 2, areaWidth);
}

function clampPanelWidth(width: number, areaWidth: number): number {
  const max = Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, areaWidth * MAX_PANEL_SHARE));
  return Math.min(max, Math.max(MIN_PANEL_WIDTH, width));
}

function ratioFromPointer(cursor: number, trackStart: number, trackSize: number, min: number, max: number): number {
  const flexSize = trackSize - DIVIDER_WIDTH;
  if (flexSize <= 0) return min;
  return clampRatio((cursor - trackStart - DIVIDER_WIDTH / 2) / flexSize, min, max);
}

function clampRatio(ratio: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, ratio));
}
