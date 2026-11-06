/** The display modes the viewport offers, as combinations of fill and backend. */

import type { FillMode, RenderBackend } from '@/model/types';

/** One entry of the display-mode picker: what to fill the subject with, and who computes it. */
export interface RenderPreset {
  readonly id: string;
  readonly label: string;
  readonly fill: FillMode;
  readonly backend: RenderBackend;
}

/**
 * Display modes, in picker order.
 *
 * Internally the viewport tracks fill and backend separately, and the wire overlay separately
 * again; the picker only ever shows these named combinations so the UI stays one control per
 * idea. Wire is not a display mode — it composes with any of them.
 */
export const RENDER_PRESETS: readonly RenderPreset[] = [
  { id: 'shaded', label: '实体', fill: 'physical', backend: 'raster' },
  { id: 'raytraced', label: '光线追踪', fill: 'physical', backend: 'pathtrace' },
  { id: 'uvCheck', label: 'UV 检查', fill: 'uvCheck', backend: 'raster' },
  { id: 'normalVis', label: '着色法线', fill: 'normal', backend: 'raster' },
  { id: 'vertexNormalVis', label: '顶点法线', fill: 'vertexNormal', backend: 'raster' },
];

/** Preset matching the current axes; falls back to the closest one when they were set apart. */
export function presetOf(fill: FillMode, backend: RenderBackend): RenderPreset {
  return RENDER_PRESETS.find(preset => preset.fill === fill && preset.backend === backend)
    ?? RENDER_PRESETS.find(preset => preset.fill === fill)
    ?? RENDER_PRESETS[0]!;
}
