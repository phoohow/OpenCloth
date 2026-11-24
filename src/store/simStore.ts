import type { FitStats } from '@/analysis';
import type { PressureStats } from '@/analysis';
import type { StrainStats } from '@/analysis';

import { create } from 'zustand';

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
  animation: { clips: [], clipDurationsMs: [], clipIndex: -1, playing: false, timeMs: 0 },
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

export interface AnimationInfo {
  clips: string[];
  clipDurationsMs: number[];
  clipIndex: number;
  playing: boolean;
  timeMs: number;
}

interface SimStore {
  isPlaying: boolean;
  currentFrame: number;
  stopFrame: number | null;
  playedMs: number;
  isDressed: boolean;
  isDressing: boolean;
  stepToken: number;
  resetToken: number;
  pinsVersion: number;
  fitStats: FitStats | null;
  strainStats: StrainStats | null;
  pressureStats: PressureStats | null;
  animation: AnimationInfo;
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
  setStopFrame: (frame: number | null) => void;
  incrementFrame: () => void;
  addPlayedMs: (ms: number) => void;
  setDressed: (v: boolean) => void;
  setDressing: (v: boolean) => void;
}
