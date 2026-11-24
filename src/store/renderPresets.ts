import type { SurfaceMode, RenderBackend } from '@/model/types';

export const RENDER_PRESETS: readonly RenderPreset[] = [
  { id: 'rasterized', label: '光栅化', fill: 'material', backend: 'raster' },
  { id: 'raytraced', label: '光线追踪', fill: 'material', backend: 'pathtrace' },
  { id: 'uvVis', label: 'UV可视化', fill: 'uv', backend: 'raster' },
  { id: 'normalVis', label: 'Normal可视化', fill: 'normal', backend: 'raster' },
];

export interface RenderPreset {
  readonly id: string;
  readonly label: string;
  readonly fill: SurfaceMode;
  readonly backend: RenderBackend;
}

export function presetOf(fill: SurfaceMode, backend: RenderBackend): RenderPreset {
  return RENDER_PRESETS.find(preset => preset.fill === fill && preset.backend === backend)
    ?? RENDER_PRESETS.find(preset => preset.fill === fill)
    ?? RENDER_PRESETS[0]!;
}
