import type { Panel, PanelDrape, Pattern, Vec2 } from '@/model/types';
import { samplePanelOutline } from '@/pattern/panel/panelBuilder';
import { computeBBox } from '@/common/geom';
import { inferDrape } from '@/pattern/drape/drapeInfer';
import { layoutRows } from '@/pattern/template/patternLayout';

/** Where a panel should move on the 2D table, in centimeters. */
export interface PanelOffset {
  panelId: string;
  dx: number;
  dy: number;
}

/** Options for `placePanelsAuto`. */
export interface PlaceOptions {
  /** Gap kept between panels and between rows, in centimeters; default 4. */
  gapCm?: number;
}

const REGION_ORDER: PanelDrape['region'][] = ['torso', 'neck', 'arm', 'leg'];

/**
 * Auto-positions all panels (FR-1.6): grouped into rows by inferred drape region,
 * laid out left to right without overlap through `layoutRows`, and returns the
 * per-panel offsets the layout produced.
 */
export function placePanelsAuto(pattern: Pattern, opts: PlaceOptions = {}): PanelOffset[] {
  const panels = Object.values(pattern.panels).filter(panel => panel.outlineEdgeIds.length >= 3);
  if (panels.length === 0) return [];

  const before = new Map<string, Vec2>();
  for (const panel of panels) {
    before.set(panel.id, computeBBox(samplePanelOutline(pattern, panel)).min);
  }

  const rows: Record<string, Panel[]> = {};
  for (const panel of panels) {
    const region = panel.drape ? panel.drape.region : inferDrape(panel.name).region;
    (rows[region] ??= []).push(panel);
  }
  const rowList = REGION_ORDER
    .filter(region => rows[region]?.length)
    .map(region => rows[region]);

  layoutRows(pattern, rowList, opts.gapCm ?? 4);

  const offsets: PanelOffset[] = [];
  for (const panel of panels) {
    const after = computeBBox(samplePanelOutline(pattern, panel)).min;
    const p = before.get(panel.id)!;
    offsets.push({
      panelId: panel.id,
      dx: Math.round((after.x - p.x) * 100) / 100,
      dy: Math.round((after.y - p.y) * 100) / 100,
    });
  }
  return offsets;
}
