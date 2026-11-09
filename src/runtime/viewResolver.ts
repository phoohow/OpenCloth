/** Resolves one frame's view from the project and the display state the UI owns. */

import type { Project } from '@/model/types';
import { normalizeRayTracing } from '@/model';
import type {
  CameraState, DisplayOverride, FillMode, RenderMode, TraceSettings,
  ViewSettings, WireMode,
} from '@/render/common';
import { CHANNEL_ALL, CHANNEL_RASTER } from '@/render/common';
import type { RenderView } from '@/render/renderer';

/** Inputs the viewport hands the resolver. */
export interface ViewInputs {
  project: Project;
  camera: CameraState;
  width: number;
  height: number;
  fill: FillMode;
  wire: WireMode;
  mode: RenderMode;
  overrides: readonly DisplayOverride[];
  frame: number;
}

/** Path-tracing settings of a project, defaults filled in. */
export function traceSettings(project: Project): TraceSettings {
  const config = normalizeRayTracing(project.scene.render.rayTracing);
  return {
    maxBounces: config.maxBounces,
    frameBudget: config.frameBudget,
    maxSamples: config.maxSamples,
    renderScale: config.renderScale,
    denoise: config.denoise,
    denoiseModel: config.denoiseModel,
    filterGlossyFactor: config.filterGlossyFactor,
    clampDirect: config.clampDirect,
    clampIndirect: config.clampIndirect,
  };
}

/** Project render settings plus the display axes the viewport controls own. */
export function liveViewSettings(
  project: Project, fill: FillMode, wire: WireMode, mode: RenderMode,
): ViewSettings {
  return {
    fill,
    wire,
    mode,
    wireOptions: project.scene.render.wireOptions,
    toneMapping: project.scene.render.toneMapping,
    exposure: 1,
    trace: traceSettings(project),
  };
}

/** One frame: camera, viewport size, settings, overrides and the channels the backend makes drawable. */
export function resolveView(inputs: ViewInputs): RenderView {
  const settings = liveViewSettings(inputs.project, inputs.fill, inputs.wire, inputs.mode);
  return {
    camera: inputs.camera,
    viewport: { width: inputs.width, height: inputs.height },
    layers: ['underlay', 'subject', 'overlay', 'gizmo'],
    channels: inputs.mode === 'pathtrace' ? CHANNEL_ALL : CHANNEL_RASTER,
    settings,
    overrides: inputs.overrides,
    frame: inputs.frame,
  };
}
