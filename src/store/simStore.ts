import { create } from 'zustand';
import type { FitStats } from '@/analysis';
import type { PressureStats } from '@/analysis';
import type { StrainStats } from '@/analysis';

/** Body animation state mirrored from the engine. */
export interface AnimationInfo {
  /** Clip names the current body carries. */
  clips: string[];
  /** Index of the clip selected in the panels; -1 when none is. */
  clipIndex: number;
  playing: boolean;
  timeMs: number;
  durationMs: number;
}

interface SimStore {
  isPlaying: boolean;
  currentFrame: number;
  /** Frame at which playback pauses by itself; null plays until paused manually. */
  stopFrame: number | null;
  /** Wall-clock milliseconds spent playing since the last reset. */
  playedMs: number;
  isDressed: boolean;
  /** True while the sew → glide → settle dressing animation is playing. */
  isDressing: boolean;
  /** Incremented to request one physics step. */
  stepToken: number;
  /** Incremented to request a restore of the initial positions. */
  resetToken: number;
  /** Incremented whenever the pinned-particle set changed, so the toolbars re-read it. */
  pinsVersion: number;
  /** Latest body-clearance summary while the fit check is on. */
  fitStats: FitStats | null;
  /** Latest strain summary while the strain heatmap is on. */
  strainStats: StrainStats | null;
  /** Latest contact-pressure summary while the pressure heatmap is on. */
  pressureStats: PressureStats | null;
  /** Body animation clips, playback and time. */
  animation: AnimationInfo;
  /** Number of pressure samples recorded during the last dynamic-fit run. */
  dynamicSamples: number;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  step: () => void;
  reset: () => void;
  bumpPins: () => void;
  setFitStats: (stats: FitStats | null) => void;
  setStrainStats: (stats: StrainStats | null) => void;
  setPressureStats: (stats: PressureStats | null) => void;
  setAnimationInfo: (info: AnimationInfo) => void;
  setDynamicSamples: (count: number) => void;
  /** Sets the auto-pause frame, never below the current frame; null clears it. */
  setStopFrame: (frame: number | null) => void;
  incrementFrame: () => void;
  /** Adds playback wall-clock time, driven by the 3D view's playback loop. */
  addPlayedMs: (ms: number) => void;
  setDressed: (v: boolean) => void;
  setDressing: (v: boolean) => void;
}

/** Playback state for the cloth simulation, driven by the timeline and the 3D viewport. */
export const useSimStore = create<SimStore>((set, get) => ({
  isPlaying: false,
  currentFrame: 0,
  stopFrame: null,
  playedMs: 0,
  isDressed: false,
  isDressing: false,
  stepToken: 0,
  resetToken: 0,
  pinsVersion: 0,
  fitStats: null,
  strainStats: null,
  pressureStats: null,
  animation: { clips: [], clipIndex: -1, playing: false, timeMs: 0, durationMs: 0 },
  dynamicSamples: 0,

  play: () => set({ isPlaying: true }),
  pause: () => set({ isPlaying: false }),
  togglePlay: () => set({ isPlaying: !get().isPlaying }),
  step: () => set(s => ({ isPlaying: false, stepToken: s.stepToken + 1 })),
  reset: () => set(s => ({ isPlaying: false, currentFrame: 0, playedMs: 0, resetToken: s.resetToken + 1 })),
  bumpPins: () => set(s => ({ pinsVersion: s.pinsVersion + 1 })),
  setFitStats: (stats) => set({ fitStats: stats }),
  setStrainStats: (stats) => set({ strainStats: stats }),
  setPressureStats: (stats) => set({ pressureStats: stats }),
  setAnimationInfo: (info) => set({ animation: info }),
  setDynamicSamples: (count) => set({ dynamicSamples: count }),
  setStopFrame: (frame) => set(s => ({
    stopFrame: frame === null ? null : Math.max(s.currentFrame, Math.round(frame)),
  })),
  incrementFrame: () => set(s => ({ currentFrame: s.currentFrame + 1 })),
  addPlayedMs: (ms) => set(s => ({ playedMs: s.playedMs + Math.max(0, ms) })),
  setDressed: (v) => set({ isDressed: v }),
  setDressing: (v) => set({ isDressing: v }),
}));
