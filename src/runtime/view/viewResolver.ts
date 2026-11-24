import type { Project } from '@/model/types';
import type {
  CameraState, DisplayOverride, SurfaceMode, RenderMode, TraceSettings, ViewSettings, WireMode,
} from '@/render/common';
import type { RenderView } from '@/render/renderer';

import { normalizeRayTracing } from '@/model';
import { CHANNEL_ALL, CHANNEL_RASTER } from '@/render/common';

export interface ViewInputs {
  project: Project;
  camera: CameraState;
  width: number;
  height: number;
  fill: SurfaceMode;
  wire: WireMode;
  mode: RenderMode;
  hideModel: boolean;
  overrides: readonly DisplayOverride[];
  frame: number;
}

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

export function liveViewSettings(
  project: Project, fill: SurfaceMode, wire: WireMode, mode: RenderMode,
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

export function resolveView(inputs: ViewInputs): RenderView {
  const settings = liveViewSettings(inputs.project, inputs.fill, inputs.wire, inputs.mode);
  return {
    camera: inputs.camera,
    viewport: { width: inputs.width, height: inputs.height },
    layers: ['underlay', 'subject', 'overlay', 'gizmo'],
    channels: inputs.mode === 'pathtrace' && !inputs.hideModel ? CHANNEL_ALL : CHANNEL_RASTER,
    settings,
    overrides: inputs.overrides,
    ...(inputs.hideModel ? { hideTags: ['avatar'] } : {}),
    frame: inputs.frame,
  };
}
