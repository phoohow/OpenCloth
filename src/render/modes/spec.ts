/** What the active view mode resolves to for one frame: fill, edges, backend and post chain. */

import type {
  FillMode, RenderBackend, ToneMappingMode, ViewConfig, WireMode, WireOptions,
} from '@/model/types';
import { SCENE_LAYERS, TOP_LAYERS, type LayerId } from '@/render/scene/layers';

/** Post effects a mode can ask for, in chain order. */
export type PostEffectId = 'toneMap';

/** Resolved view mode for one frame. */
export interface ViewModeSpec {
  readonly fill: FillMode;
  readonly wire: WireMode;
  readonly backend: RenderBackend;
  readonly wireOptions: WireOptions;
  /** Layers the raster passes draw. */
  readonly layers: readonly LayerId[];
  /** Whether traced samples are denoised before the compositor sees them. */
  readonly denoises: boolean;
  /** Ordered post chain, run after the compositor and before the overlays. */
  readonly postProcess: readonly PostEffectId[];
  /** Curve the post chain resolves the linear image with. */
  readonly toneMapping: ToneMappingMode;
  /** Whether the subject surface is filled at all. */
  readonly fillsSurface: boolean;
  /** Whether the path tracer takes part in the frame. */
  readonly traces: boolean;
}

/** Whether the mode writes subject surfaces at all; `wire: 'only'` draws edges alone. */
function fillsSurface(wire: WireMode): boolean {
  return wire !== 'only';
}

/**
 * Layers every mode draws, taken from the layer table rather than listed again.
 *
 * Diagnostics used to drop the floor so the subject read alone, but the viewport is a working
 * space: the body, the floor and the seam lines must stay put when the user switches mode, or the
 * frame looks like it lost content instead of changing shading.
 */
const DRAW_LAYERS: readonly LayerId[] = [...SCENE_LAYERS, ...TOP_LAYERS];

/** Resolves one frame's settings into everything the frame needs. */
export function resolveViewMode(config: ViewConfig): ViewModeSpec {
  const { fill, wire, backend, wireOptions } = config;
  const traces = backend === 'pathtrace' && wire !== 'only';
  // Denoising only has meaning on traced samples; a raster frame has none.
  const denoises = traces && config.rayTracing?.denoise === true;
  // Diagnostic fills encode data, not radiance; a display curve would wash their colours out.
  const toneMapping: ToneMappingMode = fill === 'physical' ? config.toneMapping : 'none';
  return {
    fill,
    wire,
    backend,
    wireOptions,
    layers: DRAW_LAYERS,
    denoises,
    // The pass always runs: it turns the linear resolve into a display image, with a
    // pass-through curve for diagnostics.
    postProcess: ['toneMap'],
    toneMapping,
    fillsSurface: fillsSurface(wire),
    traces,
  };
}
