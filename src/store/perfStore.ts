import { create } from 'zustand';
import type { PaneId } from './uiStore';

/** Drawn frames are turned into a rate once this much time has passed. */
export const FPS_SAMPLE_MS = 500;

/** Frames counted per pane since the last sample. */
const counted: Record<PaneId, number> = { '2d': 0, '3d': 0 };
let sampleStart = 0;
/** Latest accumulated ray-tracing sample count reported by the 3D viewport. */
let reportedSamples = 0;
/** When the shown sampling pass began and whether the viewport reported it still running. */
let costStart = 0;
let accumulating = false;
/** Cost read at the frame the pass finished; keeps a filled pass from counting idle frames. */
let frozenCostMs = 0;

/** Frames per second for `count` frames drawn within `elapsedMs`; 0 for a non-positive window. */
export function fpsFrom(count: number, elapsedMs: number): number {
  if (elapsedMs <= 0) return 0;
  return Math.round((count * 1000) / elapsedMs);
}

/** Records one frame drawn by a pane. */
export function noteDrawnFrame(pane: PaneId, now: number): void {
  if (sampleStart === 0) sampleStart = now;
  counted[pane] += 1;
}

/**
 * Records the accumulated sample count of the ray-traced 3D view and whether that pass is still
 * adding samples. The cost runs from the first sample of a pass to the frame it reports itself
 * finished, so idle frames after a full pass are not counted. `now` is on the same clock as `sampleFps`.
 */
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

interface PerfStore {
  /** Drawn frames per second for each viewport pane. */
  fps: Record<PaneId, number>;
  /** Accumulated samples in the ray-traced 3D view; 0 while it rasterizes. */
  samples3D: number;
  /** Milliseconds the shown sample count took to accumulate; 0 while it rasterizes. */
  costMs3D: number;
  /** Publishes the rate and sample count of the window gathered so far and opens the next one. */
  sampleFps: (now: number) => void;
}

/** Rates and the accumulated sample count shown in the bottom bar; hidden panes report 0. */
export const usePerfStore = create<PerfStore>((set, get) => ({
  fps: { '2d': 0, '3d': 0 },
  samples3D: 0,
  costMs3D: 0,

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
    const live = accumulating ? now : frozenCostMs + costStart;
    const costMs3D = reportedSamples > 0 ? Math.max(0, live - costStart) : 0;
    const prev = get();
    if (prev.fps['2d'] === fps['2d'] && prev.fps['3d'] === fps['3d']
      && prev.samples3D === reportedSamples && prev.costMs3D === costMs3D) return;
    set({ fps, samples3D: reportedSamples, costMs3D });
  },
}));
