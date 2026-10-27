import { describe, expect, it } from 'vitest';
import {
  is2DFocus, is3DFocus, isSplitLayout, leftPaneOf, toolPane,
} from '../../src/store/stores';
import {
  DIVIDER_WIDTH, MAX_PANEL_SHARE, MAX_PANEL_WIDTH, MAX_PANE_RATIO, MIN_PANEL_WIDTH, MIN_PANE_RATIO,
  isPaneShown, leftPanelWidthFromPointer, paneFlex, rightPanelWidthFromPointer,
  sceneRatioFromPointer, splitRatioFromPointer,
} from '../../src/ui/viewportLayout';

describe('paneFlex', () => {
  it('gives the left pane its share in either split order', () => {
    expect(paneFlex('split3d2d', '3d', 0.4)).toBe('0.4 1 0%');
    expect(paneFlex('split3d2d', '2d', 0.4)).toBe('0.6 1 0%');
    expect(paneFlex('split2d3d', '2d', 0.4)).toBe('0.4 1 0%');
    expect(paneFlex('split2d3d', '3d', 0.4)).toBe('0.6 1 0%');
  });

  it('gives the whole area to the visible pane in single layouts', () => {
    expect(paneFlex('2d', '2d', 0.4)).toBe('1 1 0%');
    expect(paneFlex('2d', '3d', 0.4)).toBe('0 0 auto');
    expect(paneFlex('3d', '3d', 0.4)).toBe('1 1 0%');
    expect(paneFlex('3d', '2d', 0.4)).toBe('0 0 auto');
  });
});

describe('isPaneShown', () => {
  it('shows both panes in the split layouts only', () => {
    expect(isPaneShown('split3d2d', '2d')).toBe(true);
    expect(isPaneShown('split3d2d', '3d')).toBe(true);
    expect(isPaneShown('split2d3d', '2d')).toBe(true);
    expect(isPaneShown('split2d3d', '3d')).toBe(true);
    expect(isPaneShown('2d', '3d')).toBe(false);
    expect(isPaneShown('3d', '2d')).toBe(false);
  });
});

describe('pane order', () => {
  it('puts 3D left by default and 2D left in the reversed split', () => {
    expect(leftPaneOf('split3d2d')).toBe('3d');
    expect(leftPaneOf('split2d3d')).toBe('2d');
    expect(leftPaneOf('2d')).toBe('2d');
    expect(leftPaneOf('3d')).toBe('3d');
    expect(isSplitLayout('split2d3d')).toBe(true);
    expect(isSplitLayout('3d')).toBe(false);
  });
});

describe('splitRatioFromPointer', () => {
  const areaWidth = 1000;

  it('puts the divider centre at the proportional share', () => {
    expect(splitRatioFromPointer(500, 0, areaWidth)).toBeCloseTo(0.5, 5);
    expect(splitRatioFromPointer(250, 0, areaWidth)).toBeCloseTo(0.2485, 4);
  });

  it('offsets by the area position', () => {
    expect(splitRatioFromPointer(700, 200, areaWidth)).toBeCloseTo(0.5, 5);
  });

  it('clamps at both edges', () => {
    expect(splitRatioFromPointer(-500, 0, areaWidth)).toBe(MIN_PANE_RATIO);
    expect(splitRatioFromPointer(5000, 0, areaWidth)).toBe(MAX_PANE_RATIO);
  });

  it('falls back to the minimum for an area narrower than the divider', () => {
    expect(splitRatioFromPointer(0, 0, DIVIDER_WIDTH)).toBe(MIN_PANE_RATIO);
  });
});

describe('panel widths', () => {
  const areaWidth = 1600;

  it('reads the left panel width from the cursor', () => {
    expect(leftPanelWidthFromPointer(223, 0, areaWidth)).toBeCloseTo(220, 0);
  });

  it('reads the right panel width from the cursor', () => {
    expect(rightPanelWidthFromPointer(1377, 1600, areaWidth)).toBeCloseTo(220, 0);
  });

  it('keeps both inside the draggable bounds', () => {
    expect(leftPanelWidthFromPointer(10, 0, areaWidth)).toBe(MIN_PANEL_WIDTH);
    expect(leftPanelWidthFromPointer(1500, 0, areaWidth)).toBe(MAX_PANEL_WIDTH);
    expect(rightPanelWidthFromPointer(1590, 1600, areaWidth)).toBe(MIN_PANEL_WIDTH);
    expect(rightPanelWidthFromPointer(100, 1600, areaWidth)).toBe(MAX_PANEL_WIDTH);
  });

  it('never asks for more than the window holds', () => {
    expect(rightPanelWidthFromPointer(0, 600, 600)).toBe(600 * MAX_PANEL_SHARE);
  });
});

describe('sceneRatioFromPointer', () => {
  it('clamps the outliner height share', () => {
    expect(sceneRatioFromPointer(300, 0, 1000)).toBeCloseTo(0.3, 2);
    expect(sceneRatioFromPointer(0, 0, 1000)).toBe(0.18);
    expect(sceneRatioFromPointer(1000, 0, 1000)).toBe(0.6);
  });
});

describe('toolPane', () => {
  it('routes pin tools to 3D and pattern tools to 2D', () => {
    expect(toolPane('pin')).toBe('3d');
    expect(toolPane('unpin')).toBe('3d');
    expect(toolPane('select')).toBe('2d');
    expect(toolPane('seam')).toBe('2d');
  });
});

describe('pane focus', () => {
  it('owns the keyboard in single layouts regardless of focus', () => {
    expect(is3DFocus('3d', '2d')).toBe(true);
    expect(is2DFocus('2d', '3d')).toBe(true);
    expect(is3DFocus('2d', '3d')).toBe(false);
    expect(is2DFocus('3d', '2d')).toBe(false);
  });

  it('follows the focused pane in either split order', () => {
    expect(is3DFocus('split3d2d', '3d')).toBe(true);
    expect(is3DFocus('split3d2d', '2d')).toBe(false);
    expect(is2DFocus('split2d3d', '2d')).toBe(true);
    expect(is2DFocus('split2d3d', '3d')).toBe(false);
  });
});
