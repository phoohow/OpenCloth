import type { TraceStatus as RayTraceState, RayTracingCapability } from '@/render/common';
import type { PaneId } from '@/store/types';

import { create } from 'zustand';

export const FPS_SAMPLE_MS = 500;

const counted: Record<PaneId, number> = { '2d': 0, '3d': 0 };

let sampleStart = 0;

let reportedSamples = 0;

let reportedDenoiseCount = 0;

let costStart = 0;

let accumulating = false;

let frozenCostMs = 0;

let rayState: RayTraceState = 'inactive';

let countedSteps = 0;

export const usePerfStore = create<PerfStore>((set, get) => ({
  fps: { '2d': 0, '3d': 0 },
  samples3D: 0,
  costMs3D: 0,
  denoiseCount3D: 0,
  rayState3D: 'inactive',
  rayUnsupported3D: null,
  simRate: 0,

  sampleFps: (now: number) => {
    const elapsed = now - sampleStart;
    if (sampleStart === 0 || elapsed < FPS_SAMPLE_MS) return;
    const fps: Record<PaneId, number> = {
      '2d': fpsFrom(counted['2d'], elapsed),
      '3d': fpsFrom(counted['3d'], elapsed),
    };
    counted['2d'] = 0;
    counted['3d'] = 0;
    sampleStart = now;
    const simRate = fpsFrom(countedSteps, elapsed);
    countedSteps = 0;
    const live = accumulating ? now : frozenCostMs + costStart;
    const costMs3D = reportedSamples > 0 ? Math.max(0, live - costStart) : 0;
    const prev = get();
    if (prev.fps['2d'] === fps['2d'] && prev.fps['3d'] === fps['3d']
      && prev.samples3D === reportedSamples && prev.costMs3D === costMs3D
      && prev.denoiseCount3D === reportedDenoiseCount
      && prev.rayState3D === rayState && prev.simRate === simRate) return;
    set({
      fps, samples3D: reportedSamples, costMs3D, denoiseCount3D: reportedDenoiseCount,
      rayState3D: rayState, simRate,
    });
  },
}));

interface PerfStore {
  fps: Record<PaneId, number>;
  samples3D: number;
  costMs3D: number;
  denoiseCount3D: number;
  rayState3D: RayTraceState;
  simRate: number;
  rayUnsupported3D: RayTracingCapability | null;
  sampleFps: (now: number) => void;
}

export function noteSimSteps(count: number): void {
  countedSteps += count;
}

export function fpsFrom(count: number, elapsedMs: number): number {
  if (elapsedMs <= 0) return 0;
  return Math.round((count * 1000) / elapsedMs);
}

export function noteDrawnFrame(pane: PaneId, now: number): void {
  if (sampleStart === 0) sampleStart = now;
  counted[pane] += 1;
}

export function noteRayTracingSamples(count: number, isAccumulating: boolean, now = performance.now()): void {
  if (count === 0) {
    reportedSamples = 0;
    accumulating = false;
    frozenCostMs = 0;
    return;
  }

  if (reportedSamples === 0) {
    costStart = now;
    accumulating = true;
  }

  if (accumulating && !isAccumulating) {
    accumulating = false;
    frozenCostMs = now - costStart;
  }

  reportedSamples = count;
}

export function noteRayTraceState(state: RayTraceState): void {
  rayState = state;
}

export function noteDenoiseCount(count: number): void {
  reportedDenoiseCount = count;
}

export function noteRayTracingUnsupported(capability: RayTracingCapability | null): void {
  usePerfStore.setState({ rayUnsupported3D: capability });
}
